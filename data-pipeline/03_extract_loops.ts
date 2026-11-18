/**
 * Étape 03 : boucles de référence à partir des relations OSM d'itinéraires
 * pédestres (route=hiking|foot|walking). Les boucles générées (plan, 4b) ne
 * sont tentées que si la couverture B1 est insuffisante.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import {
  chainSegments,
  decimate,
  densify,
  difficulty,
  dogAccess,
  provisionalTrailScore,
  surfaceShares,
  trailDogPolicy,
  trailUncertainties,
  waySurface,
  type DogAccess,
} from '../shared/catalog';
import { computeHikeStats, detectKind } from '../shared/gpx';
import { DEFAULT_SETTINGS, type LatLng } from '../shared/schema';
import { DATA_DIR, H3_RESOLUTION, TRAIL_ELEVATION_MAX_KM, TRAIL_ELEVATION_STEP_KM } from './config';
import { rows, sqlString } from './lib/duck';
import type { ElevationService } from './lib/elevation';

type MemberRow = {
  rel_id: number;
  rel_tags: Record<string, string>;
  geojson: string;
  tags: Record<string, string>;
  length_km: number;
};

type StagedTrail = {
  trail_id: string;
  osm_relation_id: number;
  name: string | null;
  network: string | null;
  kind: string;
  distance_m: number;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  estimated_duration_min: number;
  paved_ratio: number;
  surface_unknown_ratio: number;
  gap_km: number;
  dog_policy: DogAccess;
  restricted_ways: number;
  start_lat: number;
  start_lon: number;
  geom_wkt: string;
};

/** Échantillon tous les ~100 m pour moyenner les scores des cellules traversées. */
const SCORE_SAMPLE_KM = 0.1;

const toWkt = (points: LatLng[]) =>
  `LINESTRING(${points.map((p) => `${p.lng.toFixed(6)} ${p.lat.toFixed(6)}`).join(', ')})`;

/** Une MAP DuckDB arrive en JS sous forme de liste `{ key, value }`. */
const mapToRecord = (value: unknown): Record<string, string> => {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries((value as { key: string; value: string }[]).map((e) => [e.key, e.value]));
};

export async function extractTrails(db: DuckDBConnection, elevation: ElevationService): Promise<void> {
  const members = (
    await rows<MemberRow>(
      db,
      `SELECT m.rel_id, r.tags AS rel_tags, ST_AsGeoJSON(m.geom) AS geojson, m.tags, m.length_km
       FROM trail_members m JOIN trail_relations r ON r.id = m.rel_id
       ORDER BY m.rel_id, m.seq`,
    )
  ).map((m) => ({ ...m, rel_tags: mapToRecord(m.rel_tags), tags: mapToRecord(m.tags) }));

  const byRelation = new Map<number, MemberRow[]>();
  for (const member of members) {
    const list = byRelation.get(member.rel_id) ?? [];
    list.push(member);
    byRelation.set(member.rel_id, list);
  }

  const staged: StagedTrail[] = [];
  const samples: string[] = [];
  let elevationPoints = 0;

  for (const [relId, relMembers] of byRelation) {
    const relTags = relMembers[0]!.rel_tags;
    const segments = relMembers.map((m) =>
      (JSON.parse(m.geojson) as { coordinates: [number, number][] }).coordinates.map(([lng, lat]) => ({ lat, lng })),
    );
    const chain = chainSegments(segments);
    if (chain.points.length < 2) continue;

    const dense = densify(chain.points, TRAIL_ELEVATION_STEP_KM);
    const lengthKm = relMembers.reduce((sum, m) => sum + m.length_km, 0);
    const withElevation = lengthKm <= TRAIL_ELEVATION_MAX_KM;
    const altitudes = withElevation ? await elevation.altitudes(dense) : dense.map(() => null);
    if (withElevation) elevationPoints += dense.length;
    const stats = computeHikeStats(
      dense.map((p, i) => ({ ...p, altM: altitudes[i] ?? null })),
      DEFAULT_SETTINGS.pace,
    );

    const shares = surfaceShares(relMembers.map((m) => ({ lengthKm: m.length_km, surface: waySurface(m.tags) })));
    const dogPolicy = trailDogPolicy(
      dogAccess(relTags.dog),
      relMembers.map((m) => dogAccess(m.tags.dog)),
    );
    const restricted = relMembers.filter((m) => ['private', 'no'].includes(m.tags.access ?? '')).length;
    // Une relation `roundtrip=yes` reste une boucle même si son tracé assemblé ne se referme pas.
    const detected = detectKind(chain.points.map((p) => ({ ...p, altM: null })));
    const kind = relTags.roundtrip === 'yes' && detected === 'point-to-point' ? 'loop' : detected;

    const trailId = `osm-rel-${relId}`;
    staged.push({
      trail_id: trailId,
      osm_relation_id: relId,
      name: relTags.name ?? relTags.ref ?? null,
      network: relTags.network ?? null,
      kind,
      distance_m: Math.round(Math.max(0, stats.distanceKm - chain.gapKm) * 1000),
      elevation_gain_m: stats.elevationGainM,
      elevation_loss_m: stats.elevationLossM,
      estimated_duration_min: stats.estimatedDurationMin,
      paved_ratio: shares.paved,
      surface_unknown_ratio: shares.unknown,
      gap_km: chain.gapKm,
      dog_policy: dogPolicy,
      restricted_ways: restricted,
      start_lat: chain.points[0]!.lat,
      start_lon: chain.points[0]!.lng,
      geom_wkt: toWkt(decimate(dense, 5)),
    });
    for (const p of densify(chain.points, SCORE_SAMPLE_KM)) {
      samples.push(JSON.stringify({ trail_id: trailId, lat: p.lat, lng: p.lng }));
    }
  }
  await elevation.save();
  console.log(`  ${staged.length} itinéraires, altitudes de ${elevationPoints} points`);

  // Moyennes des scores, réserves traversées et départ le plus proche, en SQL.
  const stagedFile = path.join(DATA_DIR, 'trails_staged.ndjson');
  const samplesFile = path.join(DATA_DIR, 'trail_samples.ndjson');
  await writeFile(stagedFile, staged.map((t) => JSON.stringify(t)).join('\n'));
  await writeFile(samplesFile, samples.join('\n'));
  await db.run(`
    CREATE OR REPLACE TEMP TABLE staged AS
    SELECT *, ST_GeomFromText(geom_wkt) AS geom FROM read_json_auto(${sqlString(stagedFile)});
    CREATE OR REPLACE TEMP TABLE trail_scores AS
    SELECT s.trail_id,
      avg(c.scenic_score) AS scenic_avg, avg(c.isolation_score) AS isolation_avg, avg(c.heritage_score) AS heritage_avg
    FROM read_json_auto(${sqlString(samplesFile)}) s
    JOIN h3_cells c ON c.h3_index = h3_latlng_to_cell(s.lat, s.lng, ${H3_RESOLUTION})
    GROUP BY s.trail_id;
  `);
  const enriched = await rows<{
    trail_id: string;
    scenic_avg: number | null;
    isolation_avg: number | null;
    heritage_avg: number | null;
    in_reserve: boolean;
    start_place_id: string | null;
  }>(
    db,
    `SELECT t.trail_id, sc.scenic_avg, sc.isolation_avg, sc.heritage_avg,
       EXISTS (SELECT 1 FROM landcover l WHERE l.class = 'reserve' AND ST_Intersects(l.geom, t.geom)) AS in_reserve,
       (SELECT p.place_id FROM places p
         WHERE p.category IN ('trailhead', 'parking')
           AND ST_DWithin_Spheroid(p.geom, ST_Point(t.start_lon, t.start_lat), 500)
         ORDER BY ST_Distance_Spheroid(p.geom, ST_Point(t.start_lon, t.start_lat)) LIMIT 1) AS start_place_id
     FROM staged t LEFT JOIN trail_scores sc USING (trail_id)`,
  );
  const extra = new Map(enriched.map((e) => [e.trail_id, e]));

  const final = staged.map((t) => {
    const e = extra.get(t.trail_id)!;
    const scenicAvg = e.scenic_avg ?? 0;
    const isolationAvg = e.isolation_avg ?? 0;
    const heritageAvg = e.heritage_avg ?? 0;
    const uncertainties = trailUncertainties({
      dogPolicy: t.dog_policy,
      inReserve: e.in_reserve,
      surfaceUnknownShare: t.surface_unknown_ratio,
      gapKm: t.gap_km,
      restrictedWays: t.restricted_ways,
      gainM: t.elevation_gain_m,
    });
    return JSON.stringify({
      ...t,
      start_place_id: e.start_place_id,
      scenic_avg: scenicAvg,
      isolation_avg: isolationAvg,
      heritage_avg: heritageAvg,
      in_reserve: e.in_reserve,
      difficulty: difficulty(t.estimated_duration_min, t.elevation_gain_m),
      uncertainties,
      provisional_score: provisionalTrailScore({
        scenicAvg,
        isolationAvg,
        heritageAvg,
        pavedRatio: t.paved_ratio,
        gapKm: t.gap_km,
      }),
      source_type: 'osm_relation',
    });
  });
  const finalFile = path.join(DATA_DIR, 'reference_trails.ndjson');
  await writeFile(finalFile, final.join('\n'));
  await db.run(`
    CREATE OR REPLACE TABLE reference_trails AS
    SELECT * EXCLUDE (geom_wkt), geom_wkt, ST_GeomFromText(geom_wkt) AS geom,
      ST_XMin(ST_GeomFromText(geom_wkt)) AS bbox_min_lon, ST_YMin(ST_GeomFromText(geom_wkt)) AS bbox_min_lat,
      ST_XMax(ST_GeomFromText(geom_wkt)) AS bbox_max_lon, ST_YMax(ST_GeomFromText(geom_wkt)) AS bbox_max_lat
    FROM read_json_auto(${sqlString(finalFile)});
  `);
}
