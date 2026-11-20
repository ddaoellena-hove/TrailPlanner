/**
 * Étape 03 : boucles de référence.
 * - 4a : relations OSM d'itinéraires pédestres (route=hiking|foot|walking) ;
 * - 4b : boucles générées sur le réseau de chemins OSM dans les secteurs peu couverts
 *        par les relations balisées, marquées `source_type = 'generated_loop'`.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import {
  CATALOG_HYSTERESIS_M,
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
import {
  buildWalkGraph,
  fastDistanceKm,
  findLoopsFromSeed,
  type TrailWayInput,
} from '../shared/loop-generator';
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

type WalkWayRow = {
  id: number;
  tags: unknown;
  geojson: string;
};

type SeedCellRow = {
  stratum: string;
  center_lat: number;
  center_lon: number;
  quality: number;
};

type PlaceRow = {
  name: string | null;
  category: string;
  lat: number;
  lon: number;
};

type StagedTrail = {
  trail_id: string;
  osm_relation_id: number | null;
  source_type: 'osm_relation' | 'generated_loop';
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

/** Paramètres de sélection régionale stratifiée (par tuile H3 rés. 5 ≈ 250 km²) pour l'étape 4b. */
const STRATA_H3_RESOLUTION = 5;
const MAX_SEEDS_PER_STRATUM = 16;
const SEED_MIN_SPACING_KM = 2.2;
const RELATION_EXCLUSION_KM = 1.6;
const GENERATED_MIDPOINT_SPACING_KM = 1.7;

const toWkt = (points: LatLng[]) =>
  `LINESTRING(${points.map((p) => `${p.lng.toFixed(6)} ${p.lat.toFixed(6)}`).join(', ')})`;

/** Une MAP DuckDB arrive en JS sous forme de liste `{ key, value }`. */
const mapToRecord = (value: unknown): Record<string, string> => {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries((value as { key: string; value: string }[]).map((e) => [e.key, e.value]));
};

function formatGeneratedName(placeName: string | null, index: number): string {
  if (!placeName) return `Boucle rurale #${index}`;
  const trimmed = placeName.trim();
  const vowel = /^[aeiouyhàâäéèêëîïôöùûü]/i.test(trimmed);
  return vowel ? `Boucle autour d’${trimmed}` : `Boucle autour de ${trimmed}`;
}

async function generateNetworkLoops(
  db: DuckDBConnection,
  elevation: ElevationService,
  existingLoopCenters: LatLng[],
): Promise<{ staged: StagedTrail[]; samples: string[]; elevationPoints: number }> {
  // 1. Graines stratifiées par tuile H3 rés. 5 : garantit une couverture homogène entre
  //    zones très boisées (Eure) et plateaux / littoral (Pays de Caux) sans sur-représenter un secteur.
  const cells = await rows<SeedCellRow>(
    db,
    `SELECT h3_cell_to_parent(h3_index, ${STRATA_H3_RESOLUTION})::VARCHAR AS stratum,
            center_lat, center_lon,
            0.55 * scenic_score + 0.35 * isolation_score + 0.10 * heritage_score AS quality
     FROM h3_cells
     WHERE (scenic_score >= 0.08 OR heritage_score >= 0.20) AND isolation_score >= 0.12
     ORDER BY quality DESC`,
  );

  const selectedCells: LatLng[] = [];
  const countByStratum = new Map<string, number>();
  for (const cell of cells) {
    const stratumCount = countByStratum.get(cell.stratum) ?? 0;
    if (stratumCount >= MAX_SEEDS_PER_STRATUM) continue;
    const pt = { lat: cell.center_lat, lng: cell.center_lon };
    if (existingLoopCenters.some((c) => fastDistanceKm(pt, c) < RELATION_EXCLUSION_KM)) continue;
    if (selectedCells.some((c) => fastDistanceKm(pt, c) < SEED_MIN_SPACING_KM)) continue;
    selectedCells.push(pt);
    countByStratum.set(cell.stratum, stratumCount + 1);
  }

  if (selectedCells.length === 0) return { staged: [], samples: [], elevationPoints: 0 };

  // 2. Lieux de départ et de nommage (parkings, villages, patrimoine, points de vue).
  const places = await rows<PlaceRow>(
    db,
    `SELECT name, category, lat, lon FROM places
     WHERE category IN ('parking', 'trailhead', 'village', 'heritage', 'viewpoint')`,
  );
  const parkingPlaces = places.filter((p) => p.category === 'parking' || p.category === 'trailhead');
  const namedPlaces = places.filter(
    (p) => p.name && (p.category === 'village' || p.category === 'heritage' || p.category === 'viewpoint'),
  );

  const nearestIn = (pt: LatLng, list: PlaceRow[], maxKm: number): PlaceRow | null => {
    let best: PlaceRow | null = null;
    let bestD = maxKm;
    for (const p of list) {
      const d = fastDistanceKm(pt, { lat: p.lat, lng: p.lon });
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  // 3. Graphe pédestre régional (hors voies privées ou interdites aux piétons).
  const wayRows = await rows<WalkWayRow>(
    db,
    `SELECT id, tags, ST_AsGeoJSON(geom) AS geojson
     FROM ways
     WHERE tags['highway'] IN (
       'path', 'track', 'footway', 'bridleway', 'cycleway', 'steps',
       'pedestrian', 'living_street', 'unclassified', 'residential', 'service'
     )
       AND coalesce(tags['access'], 'yes') NOT IN ('private', 'no')
       AND coalesce(tags['foot'], 'yes') NOT IN ('private', 'no')
       AND coalesce(tags['area'], 'no') <> 'yes'`,
  );

  const wayInputs: TrailWayInput[] = wayRows.map((row) => {
    const tags = mapToRecord(row.tags);
    const coords = (JSON.parse(row.geojson) as { coordinates: [number, number][] }).coordinates.map(
      ([lng, lat]) => ({ lat, lng }),
    );
    return {
      id: Number(row.id),
      coords,
      highway: tags.highway ?? 'path',
      surface: waySurface(tags),
      dog: dogAccess(tags.dog),
    };
  });

  const graph = buildWalkGraph(wayInputs);
  console.log(
    `  étape 4b : graphe ${graph.nodes.length} nœuds (${wayInputs.length} voies), ${selectedCells.length} graines`,
  );

  const accepted: {
    loop: ReturnType<typeof findLoopsFromSeed>[number];
    dense: LatLng[];
    name: string;
    trailId: string;
  }[] = [];
  const acceptedMidpoints: LatLng[] = [];
  let seq = 0;

  for (const cell of selectedCells) {
    const anchor =
      nearestIn(cell, parkingPlaces, 1.5) ?? nearestIn(cell, namedPlaces, 2.0);
    const seedPoint = anchor ? { lat: anchor.lat, lng: anchor.lon } : cell;
    const loops = findLoopsFromSeed(graph, seedPoint, {
      minKm: 5.5,
      maxKm: 14.5,
      targetKm: 9.5,
      maxPavedRatio: 0.48,
      maxOverlapRatio: 0.18,
      maxSnapKm: 0.6,
      maxLoops: 2,
    });
    for (const loop of loops) {
      if (acceptedMidpoints.some((m) => fastDistanceKm(m, loop.midpoint) < GENERATED_MIDPOINT_SPACING_KM)) {
        continue;
      }
      if (existingLoopCenters.some((c) => fastDistanceKm(c, loop.midpoint) < RELATION_EXCLUSION_KM)) {
        continue;
      }
      acceptedMidpoints.push(loop.midpoint);
      seq++;
      const labelPlace =
        nearestIn(loop.points[0]!, namedPlaces, 3.0) ??
        nearestIn(loop.midpoint, namedPlaces, 3.5);
      accepted.push({
        loop,
        dense: densify(loop.points, TRAIL_ELEVATION_STEP_KM),
        name: formatGeneratedName(labelPlace?.name ?? null, seq),
        trailId: `gen-${String(seq).padStart(3, '0')}`,
      });
    }
  }

  // Un seul lot d'appels altimétriques (5 000 pts/requête) pour toutes les boucles générées.
  const allPoints = accepted.flatMap((a) => a.dense);
  console.log(`  étape 4b : ${accepted.length} boucles retenues, altitudes de ${allPoints.length} points…`);
  const allAltitudes = await elevation.altitudes(allPoints);

  const staged: StagedTrail[] = [];
  const samples: string[] = [];
  let offset = 0;
  for (const { loop, dense, name, trailId } of accepted) {
    const altitudes = allAltitudes.slice(offset, offset + dense.length);
    offset += dense.length;
    const stats = computeHikeStats(
      dense.map((p, i) => ({ ...p, altM: altitudes[i] ?? null })),
      DEFAULT_SETTINGS.pace,
      CATALOG_HYSTERESIS_M,
    );
    staged.push({
      trail_id: trailId,
      osm_relation_id: null,
      source_type: 'generated_loop',
      name,
      network: null,
      kind: 'loop',
      distance_m: Math.round(stats.distanceKm * 1000),
      elevation_gain_m: stats.elevationGainM,
      elevation_loss_m: stats.elevationLossM,
      estimated_duration_min: stats.estimatedDurationMin,
      paved_ratio: loop.pavedRatio,
      surface_unknown_ratio: loop.surfaceUnknownRatio,
      gap_km: 0,
      dog_policy: trailDogPolicy('unknown', loop.dogWays),
      restricted_ways: 0,
      start_lat: loop.points[0]!.lat,
      start_lon: loop.points[0]!.lng,
      geom_wkt: toWkt(decimate(dense, 5)),
    });
    for (const p of densify(loop.points, SCORE_SAMPLE_KM)) {
      samples.push(JSON.stringify({ trail_id: trailId, lat: p.lat, lng: p.lng }));
    }
  }

  return { staged, samples, elevationPoints: allPoints.length };
}

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
  const existingLoopCenters: LatLng[] = [];
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
      CATALOG_HYSTERESIS_M,
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
    const distanceM = Math.round(Math.max(0, stats.distanceKm - chain.gapKm) * 1000);

    if (distanceM >= 5000 && distanceM <= 15000) {
      const mid = chain.points[Math.floor(chain.points.length / 2)]!;
      existingLoopCenters.push(chain.points[0]!, mid);
    }

    const trailId = `osm-rel-${relId}`;
    staged.push({
      trail_id: trailId,
      osm_relation_id: relId,
      source_type: 'osm_relation',
      name: relTags.name ?? relTags.ref ?? null,
      network: relTags.network ?? null,
      kind,
      distance_m: distanceM,
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
  console.log(`  étape 4a : ${staged.length} relations OSM, altitudes de ${elevationPoints} points`);

  const generated = await generateNetworkLoops(db, elevation, existingLoopCenters);
  staged.push(...generated.staged);
  samples.push(...generated.samples);
  await elevation.save();

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
