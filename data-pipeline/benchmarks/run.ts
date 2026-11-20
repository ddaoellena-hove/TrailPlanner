/**
 * Benchmarks B1–B5 de la phase 0 (VAGARI-PLAN.md) : `npm run catalog:bench`.
 * Écrit `data/benchmarks.json` et affiche le verdict go / no-go.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRecordedGpx } from '../../server/gpx';
import { CATALOG_HYSTERESIS_M, densify } from '../../shared/catalog';
import { computeHikeStats } from '../../shared/gpx';
import { DEFAULT_SETTINGS } from '../../shared/schema';
import {
  BENCHMARK_REPORT_PATH,
  BUILD_REPORT_PATH,
  CATALOG_PATH,
  ORIGINS,
  RATINGS_PATH,
  TRAIL_ELEVATION_STEP_KM,
} from '../config';
import { candidatesFor, type Verdict } from '../lib/candidates';
import { openCatalog, rows, sqlString } from '../lib/duck';
import { ElevationService } from '../lib/elevation';

/** Seuils proposés dans VAGARI-PLAN.md, phase 0. */
const THRESHOLDS = {
  b1MinCandidates: 30,
  b2MinYesShare: 0.6,
  b2NoGoShare: 0.4,
  b3DistanceTolerance: 0.05,
  b3GainTolerance: 0.15,
  b4MaxBuildS: 30 * 60,
  b4MaxQueryMs: 500,
} as const;

/** Valeurs affichées par AllTrails (fixtures/README.md). */
const FIXTURES = [
  { file: 'sur-les-traces-de-voltaire.gpx', distanceKm: 6.81, gainM: 85 },
  { file: 'vallee-du-crevon.gpx', distanceKm: 7.65, gainM: 169 },
] as const;

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const db = await openCatalog(CATALOG_PATH, true);
const pass = (ok: boolean) => (ok ? 'OK' : 'ÉCHEC');

// B1 — couverture et B4 — temps de requête
const b1 = [];
const queryMs: number[] = [];
for (const origin of ORIGINS) {
  await candidatesFor(db, origin, 1); // met l'isochrone en cache
  const start = performance.now();
  const candidates = await candidatesFor(db, origin);
  queryMs.push(performance.now() - start);
  b1.push({ origin: origin.label, candidates: candidates.length, ok: candidates.length >= THRESHOLDS.b1MinCandidates });
}

// B2 — pertinence, d'après les avis saisis dans la page de revue
const ratings: Verdict[] = existsSync(RATINGS_PATH)
  ? (JSON.parse(await readFile(RATINGS_PATH, 'utf8')) as Verdict[])
  : [];
const b2 = [];
for (const origin of ORIGINS) {
  const top = await candidatesFor(db, origin, 20);
  const rated = top
    .map((c) => ratings.find((r) => r.originId === origin.id && r.trailId === c.trail_id))
    .filter((r): r is Verdict => r !== undefined);
  const yes = rated.filter((r) => r.verdict === 'yes').length;
  b2.push({ origin: origin.label, rated: rated.length, yes, of: top.length, yesShare: rated.length ? yes / rated.length : null });
}
const allRated = b2.reduce((s, o) => s + o.rated, 0);
const allYes = b2.reduce((s, o) => s + o.yes, 0);
const b2Share = allRated ? allYes / allRated : null;

// B3 — exactitude : distance et D+ recalculés par le pipeline sur les GPX AllTrails
const elevation = new ElevationService();
await elevation.load();
const b3 = [];
for (const fixture of FIXTURES) {
  const xml = await readFile(path.join(ROOT, 'fixtures', 'recordings', fixture.file), 'utf8');
  const track = parseRecordedGpx(xml);
  const points = densify(track.segments.flat(), TRAIL_ELEVATION_STEP_KM);
  const altitudes = await elevation.altitudes(points);
  const stats = computeHikeStats(
    points.map((p, i) => ({ ...p, altM: altitudes[i] ?? null })),
    DEFAULT_SETTINGS.pace,
    CATALOG_HYSTERESIS_M,
  );
  const distanceError = Math.abs(stats.distanceKm - fixture.distanceKm) / fixture.distanceKm;
  const gainError = stats.elevationGainM === null ? 1 : Math.abs(stats.elevationGainM - fixture.gainM) / fixture.gainM;

  // Itinéraire OSM le plus proche : part de la trace à moins de 30 m.
  const wkt = `LINESTRING(${points.filter((_, i) => i % 5 === 0).map((p) => `${p.lng} ${p.lat}`).join(', ')})`;
  const [match] = await rows<{ name: string | null; trail_id: string; share: number }>(
    db,
    // Distances en Lambert-93 (EPSG:2154), en mètres.
    `WITH pts AS (
       SELECT ST_Transform(unnest(ST_Dump(ST_Points(ST_GeomFromText(${sqlString(wkt)})))).geom, 'EPSG:4326', 'EPSG:2154') AS pt
     ),
     near AS (
       SELECT name, trail_id, ST_Transform(geom, 'EPSG:4326', 'EPSG:2154') AS g FROM reference_trails
       WHERE ST_Intersects(geom, ST_Buffer(ST_Envelope(ST_GeomFromText(${sqlString(wkt)})), 0.01))
     )
     SELECT near.name, near.trail_id, count(*) FILTER (WHERE ST_DWithin(pts.pt, near.g, 30)) / count(*) AS share
     FROM near, pts
     GROUP BY near.name, near.trail_id ORDER BY share DESC LIMIT 1`,
  );
  b3.push({
    fixture: fixture.file,
    allTrails: { distanceKm: fixture.distanceKm, gainM: fixture.gainM },
    pipeline: { distanceKm: stats.distanceKm, gainM: stats.elevationGainM },
    distanceError,
    gainError,
    ok: distanceError <= THRESHOLDS.b3DistanceTolerance && gainError <= THRESHOLDS.b3GainTolerance,
    closestOsmTrail: match ? { name: match.name, trailId: match.trail_id, overlap: match.share } : null,
  });
}
await elevation.save();

// B4 — performance
const build = existsSync(BUILD_REPORT_PATH)
  ? (JSON.parse(await readFile(BUILD_REPORT_PATH, 'utf8')) as { totalS: number; elevationRequests: number })
  : null;
const maxQueryMs = Math.max(...queryMs);
const b4 = {
  buildS: build?.totalS ?? null,
  buildFromCache: build ? build.elevationRequests === 0 : null,
  maxQueryMs: Math.round(maxQueryMs),
  ok: build !== null && build.totalS <= THRESHOLDS.b4MaxBuildS && maxQueryMs <= THRESHOLDS.b4MaxQueryMs,
};

// B5 — honnêteté : chaque inconnue mesurée porte son code d'incertitude
const [b5] = await rows<{ total: number; violations: number; dog_unknown: number; surface_incomplete: number; geometry_incomplete: number; reserve: number }>(
  db,
  `SELECT count(*) AS total,
     count(*) FILTER (WHERE
       (dog_policy = 'unknown' AND NOT list_contains(uncertainties, 'DOG_ACCESS_UNKNOWN'))
       OR (in_reserve AND NOT list_contains(uncertainties, 'RESERVE_REGULATION_CHECK'))
       OR (surface_unknown_ratio > 0.3 AND NOT list_contains(uncertainties, 'OSM_SURFACE_INCOMPLETE'))
       OR (gap_km > 0.3 AND NOT list_contains(uncertainties, 'OSM_GEOMETRY_INCOMPLETE'))
       OR (elevation_gain_m IS NULL AND NOT list_contains(uncertainties, 'ELEVATION_MISSING'))) AS violations,
     count(*) FILTER (WHERE dog_policy = 'unknown') AS dog_unknown,
     count(*) FILTER (WHERE list_contains(uncertainties, 'OSM_SURFACE_INCOMPLETE')) AS surface_incomplete,
     count(*) FILTER (WHERE list_contains(uncertainties, 'OSM_GEOMETRY_INCOMPLETE')) AS geometry_incomplete,
     count(*) FILTER (WHERE in_reserve) AS reserve
   FROM reference_trails`,
);
db.closeSync();

const report = {
  at: new Date().toISOString(),
  thresholds: THRESHOLDS,
  B1: { ok: b1.every((o) => o.ok), origins: b1 },
  B2: {
    ok: b2Share === null ? null : b2Share >= THRESHOLDS.b2MinYesShare,
    noGo: b2Share !== null && b2Share < THRESHOLDS.b2NoGoShare,
    yesShare: b2Share,
    origins: b2,
  },
  B3: { ok: b3.every((f) => f.ok), fixtures: b3 },
  B4: b4,
  B5: { ok: b5!.violations === 0, ...b5 },
};
await writeFile(BENCHMARK_REPORT_PATH, JSON.stringify(report, null, 2));

const pct = (v: number) => `${Math.round(v * 100)} %`;
console.log('\nPhase 0 — benchmarks\n');
for (const o of b1) console.log(`B1 ${pass(o.ok)}  ${o.origin} : ${o.candidates} boucles de 5–15 km à ≤ 45 min`);
console.log(
  b2Share === null
    ? `B2 EN ATTENTE  aucun avis : lancer npm run catalog:review`
    : `B2 ${pass(report.B2.ok === true)}  « j'irais » : ${pct(b2Share)} (${allRated} avis)`,
);
for (const f of b3) {
  console.log(
    `B3 ${pass(f.ok)}  ${f.fixture} : ${f.pipeline.distanceKm} km (AllTrails ${f.allTrails.distanceKm}, écart ${pct(f.distanceError)}), ` +
      `D+ ${f.pipeline.gainM} m (AllTrails ${f.allTrails.gainM}, écart ${pct(f.gainError)})` +
      (f.closestOsmTrail ? ` — itinéraire OSM le plus proche : ${f.closestOsmTrail.name ?? f.closestOsmTrail.trailId} (${pct(f.closestOsmTrail.overlap)} commun)` : ''),
  );
}
console.log(`B4 ${pass(b4.ok)}  construction ${b4.buildS} s${b4.buildFromCache ? ' (altitudes en cache)' : ''}, requête max ${b4.maxQueryMs} ms`);
console.log(`B5 ${pass(report.B5.ok)}  ${b5!.violations} inconnue(s) non signalée(s) sur ${b5!.total} itinéraires`);
console.log(
  `   chien inconnu ${pct(b5!.dog_unknown / b5!.total)}, revêtement incomplet ${pct(b5!.surface_incomplete / b5!.total)}, ` +
    `tracé incomplet ${pct(b5!.geometry_incomplete / b5!.total)}, en réserve ${b5!.reserve}`,
);
