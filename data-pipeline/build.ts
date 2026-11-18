/**
 * Construit le catalogue de la phase 0 : `npm run catalog:build`.
 * Étapes : 01 ingestion OSM → 02 grille H3 → 03 boucles. Le catalogue est
 * écrit dans un fichier temporaire puis renommé (remplacement atomique).
 */
import { existsSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { buildH3Grid } from './02_build_h3_grid';
import { extractTrails } from './03_extract_loops';
import { BUILD_REPORT_PATH, CATALOG_PATH, H3_RESOLUTION, REGION } from './config';
import { openCatalog, rows, runSqlFile } from './lib/duck';
import { ElevationService } from './lib/elevation';

const only = process.argv[2];
const tmpPath = `${CATALOG_PATH}.building`;
const timings: Record<string, number> = {};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  console.log(`→ ${name}`);
  const result = await run();
  timings[name] = Math.round((performance.now() - start) / 1000);
  console.log(`  ${name} : ${timings[name]} s`);
  return result;
}

if (!existsSync(REGION.pbfPath)) {
  throw new Error(`Extrait OSM absent : ${REGION.pbfPath}\nTélécharger ${REGION.pbfUrl}`);
}

// `--from 02` repart du catalogue existant pour itérer sur une étape.
const resume = only === '--from-02' || only === '--from-03';
if (resume) {
  await rm(tmpPath, { force: true });
  const { copyFile } = await import('node:fs/promises');
  await copyFile(CATALOG_PATH, tmpPath);
} else {
  await rm(tmpPath, { force: true });
}

const db = await openCatalog(tmpPath);
const elevation = new ElevationService();
await elevation.load();

const start = performance.now();
if (!resume) {
  await step('01 ingestion OSM', () =>
    runSqlFile(db, '01_ingest_osm.sql', { pbf: REGION.pbfPath, h3_resolution: H3_RESOLUTION }),
  );
}
if (only !== '--from-03') await step('02 grille H3', () => buildH3Grid(db, elevation));
await step('03 boucles', () => extractTrails(db, elevation));
await elevation.save();

const snapshotId = `${REGION.name}-${new Date().toISOString().slice(0, 10)}`;
await db.run(`
  CREATE OR REPLACE TABLE catalog_meta AS SELECT
    '${snapshotId}' AS snapshot_id,
    '${REGION.name}' AS region_name,
    TIMESTAMP '${new Date().toISOString().replace('T', ' ').slice(0, 19)}' AS osm_timestamp,
    'IGN RGE ALTI (Géoplateforme)' AS dem_source,
    current_timestamp AS created_at;
`);
const counts = await rows(
  db,
  `SELECT (SELECT count(*) FROM places) AS places, (SELECT count(*) FROM h3_cells) AS cells,
          (SELECT count(*) FROM reference_trails) AS trails`,
);
db.closeSync();

await rename(tmpPath, CATALOG_PATH);
await rm(`${tmpPath}.wal`, { force: true });

const totalS = Math.round((performance.now() - start) / 1000);
const report = { snapshotId, totalS, timings, elevationRequests: elevation.requests, ...counts[0] };
await writeFile(BUILD_REPORT_PATH, JSON.stringify(report, null, 2));
console.log(report);
