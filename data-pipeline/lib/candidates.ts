import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import { DATA_DIR, LOOP_KM_RANGE, MAX_DRIVE_MIN } from '../config';
import { rows, sqlString } from './duck';

export type Origin = { id: string; label: string; lat: number; lng: number };

/**
 * Zone atteignable en voiture en `MAX_DRIVE_MIN` minutes (isochrone de la
 * Géoplateforme IGN, sans clé), mise en cache. Remplacée par GraphHopper en phase 2.
 */
export async function isochrone(origin: Origin): Promise<string> {
  const dir = path.join(DATA_DIR, 'isochrones');
  const file = path.join(dir, `${origin.id}-${MAX_DRIVE_MIN}min.geojson`);
  if (existsSync(file)) return readFile(file, 'utf8');
  const url = new URL('https://data.geopf.fr/navigation/isochrone');
  url.search = new URLSearchParams({
    point: `${origin.lng},${origin.lat}`,
    resource: 'bdtopo-valhalla',
    costValue: String(MAX_DRIVE_MIN),
    costType: 'time',
    timeUnit: 'minute',
    profile: 'car',
    direction: 'departure',
    geometryFormat: 'geojson',
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Isochrone IGN : HTTP ${response.status}`);
  const { geometry } = (await response.json()) as { geometry: unknown };
  const geojson = JSON.stringify(geometry);
  await mkdir(dir, { recursive: true });
  await writeFile(file, geojson);
  return geojson;
}

export type Candidate = {
  trail_id: string;
  osm_relation_id: number | null;
  source_type: string;
  name: string | null;
  kind: string;
  distance_m: number;
  elevation_gain_m: number | null;
  estimated_duration_min: number;
  paved_ratio: number;
  scenic_avg: number;
  isolation_avg: number;
  heritage_avg: number;
  provisional_score: number;
  difficulty: string;
  dog_policy: string;
  uncertainties: string[];
  geojson: string;
};

/** Boucles de 5–15 km qui touchent la zone atteignable, de la meilleure à la moins bonne. */
export async function candidatesFor(db: DuckDBConnection, origin: Origin, limit?: number): Promise<Candidate[]> {
  const zone = await isochrone(origin);
  return rows<Candidate>(
    db,
    `SELECT trail_id, osm_relation_id, source_type, name, kind, distance_m, elevation_gain_m, estimated_duration_min,
            paved_ratio, scenic_avg, isolation_avg, heritage_avg, provisional_score, difficulty, dog_policy,
            uncertainties, ST_AsGeoJSON(geom) AS geojson
     FROM reference_trails
     WHERE distance_m BETWEEN ${LOOP_KM_RANGE.min * 1000} AND ${LOOP_KM_RANGE.max * 1000}
       AND ST_Intersects(geom, ST_GeomFromGeoJSON(${sqlString(zone)}))
     ORDER BY provisional_score DESC
     ${limit ? `LIMIT ${limit}` : ''}`,
  );
}

export type Verdict = { originId: string; trailId: string; verdict: 'yes' | 'no'; reason?: string; at: string };
