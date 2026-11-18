import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import { cellScores, heritageWeight, popularity } from '../shared/catalog';
import { DATA_DIR, H3_RESOLUTION } from './config';
import { rows, runSqlFile, sqlString } from './lib/duck';
import type { ElevationService } from './lib/elevation';

type FeatureRow = {
  h3_index: string | number;
  center_lat: number;
  center_lon: number;
  forest_share: number;
  built_share: number;
  has_water: boolean;
  has_coast: boolean;
  viewpoints: number;
  rings_to_major_road: number;
  neighbors: (string | number)[];
};

function standardDeviation(values: number[]): number | null {
  if (values.length < 3) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** Étape 02 : caractéristiques en SQL, relief via l'IGN, scores via `cellScores`. */
export async function buildH3Grid(db: DuckDBConnection, elevation: ElevationService): Promise<void> {
  await runSqlFile(db, '02_build_h3_grid.sql', { res: H3_RESOLUTION });

  const features = await rows<FeatureRow & { neighbors: unknown }>(
    db,
    `SELECT h3_index::VARCHAR AS h3_index, center_lat, center_lon, forest_share, built_share, has_water,
            has_coast, viewpoints, rings_to_major_road, list_transform(neighbors, lambda n: n::VARCHAR) AS neighbors
     FROM cell_features`,
  );

  // Patrimoine : poids des lieux de la cellule, puis somme sur la cellule et ses voisines.
  const places = await rows<{ h3: string; category: string; raw_tags: string }>(
    db,
    `SELECT h3_index::VARCHAR AS h3, category, raw_tags::VARCHAR AS raw_tags
     FROM places WHERE category IN ('heritage', 'village')`,
  );
  const ownWeight = new Map<string, number>();
  for (const place of places) {
    const tags = JSON.parse(place.raw_tags) as Record<string, string>;
    const weight = heritageWeight({ category: place.category, popularity: popularity(tags) });
    ownWeight.set(place.h3, (ownWeight.get(place.h3) ?? 0) + weight);
  }

  // Relief : 7 sous-cellules (résolution + 1) par cellule.
  const probesPerCell = await rows<{ h3: string; lats: number[]; lngs: number[] }>(
    db,
    `SELECT h3_index::VARCHAR AS h3,
            list_transform(h3_cell_to_children(h3_index, ${H3_RESOLUTION + 1}), lambda c: h3_cell_to_lat(c)) AS lats,
            list_transform(h3_cell_to_children(h3_index, ${H3_RESOLUTION + 1}), lambda c: h3_cell_to_lng(c)) AS lngs
     FROM cells`,
  );
  const probePoints = probesPerCell.flatMap((c) => c.lats.map((lat, i) => ({ lat, lng: c.lngs[i]! })));
  console.log(`  altitudes de ${probePoints.length} points de relief`);
  const altitudes = await elevation.altitudes(probePoints);
  await elevation.save();
  const stdByCell = new Map<string, number | null>();
  let offset = 0;
  for (const cell of probesPerCell) {
    const values = altitudes.slice(offset, offset + cell.lats.length).filter((v): v is number => v !== null);
    stdByCell.set(cell.h3, standardDeviation(values));
    offset += cell.lats.length;
  }

  const lines = features.map((f) => {
    const h3 = String(f.h3_index);
    const elevationStdM = stdByCell.get(h3) ?? null;
    const scores = cellScores({
      forestShare: f.forest_share,
      builtShare: f.built_share,
      hasWater: f.has_water,
      hasCoastOrCliff: f.has_coast,
      viewpoints: f.viewpoints,
      elevationStdM,
      ringsToMajorRoad: f.rings_to_major_road,
      heritageWeight: f.neighbors.reduce<number>((sum, n) => sum + (ownWeight.get(String(n)) ?? 0), 0),
    });
    return JSON.stringify({
      h3_index: h3,
      center_lat: f.center_lat,
      center_lon: f.center_lon,
      scenic_score: scores.scenic,
      isolation_score: scores.isolation,
      heritage_score: scores.heritage,
      elevation_roughness: elevationStdM,
    });
  });
  const file = path.join(DATA_DIR, 'h3_cells.ndjson');
  await writeFile(file, lines.join('\n'));
  await db.run(`
    CREATE OR REPLACE TABLE h3_cells AS
    SELECT h3_index::UBIGINT AS h3_index, center_lat, center_lon,
           ST_GeomFromText(h3_cell_to_boundary_wkt(h3_index::UBIGINT)) AS geom,
           scenic_score, isolation_score, heritage_score, elevation_roughness
    FROM read_json(${sqlString(file)}, columns = {
      h3_index: 'VARCHAR', center_lat: 'DOUBLE', center_lon: 'DOUBLE', scenic_score: 'DOUBLE',
      isolation_score: 'DOUBLE', heritage_score: 'DOUBLE', elevation_roughness: 'DOUBLE'
    });
    DROP TABLE cell_geom;
  `);
}
