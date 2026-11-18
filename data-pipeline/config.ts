import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const DATA_DIR = path.join(ROOT, 'data');

/** Région pilote de la phase 0 (VAGARI-PLAN.md, question 1, choix provisoire). */
export const REGION = {
  name: 'haute-normandie',
  pbfUrl: 'https://download.geofabrik.de/europe/france/haute-normandie-latest.osm.pbf',
  pbfPath: path.join(DATA_DIR, 'haute-normandie-latest.osm.pbf'),
} as const;

export const CATALOG_PATH = path.join(DATA_DIR, 'catalog_v0.duckdb');
export const ELEVATION_CACHE_PATH = path.join(DATA_DIR, 'elevation-cache.json');
export const RATINGS_PATH = path.join(DATA_DIR, 'ratings.json');
export const BUILD_REPORT_PATH = path.join(DATA_DIR, 'build-report.json');
export const BENCHMARK_REPORT_PATH = path.join(DATA_DIR, 'benchmarks.json');

/** Résolution H3 des cellules de paysage (≈ 0,7 km²). */
export const H3_RESOLUTION = 8;
/** Pas d'échantillonnage des altitudes le long d'une boucle, en km. */
export const TRAIL_ELEVATION_STEP_KM = 0.02;
/** Au-delà, pas d'altitude : les grands itinéraires (GR) ne sont pas des boucles d'une journée. */
export const TRAIL_ELEVATION_MAX_KM = 40;

/**
 * Origines de test des benchmarks B1 et B2. Provisoires : trois villes de la
 * région, à remplacer par les vraies origines de David.
 */
export const ORIGINS = [
  { id: 'rouen', label: 'Rouen', lat: 49.4431, lng: 1.0993 },
  { id: 'le-havre', label: 'Le Havre', lat: 49.4944, lng: 0.1079 },
  { id: 'evreux', label: 'Évreux', lat: 49.0241, lng: 1.1508 },
] as const;

/** Budget de route aller des benchmarks (B1). */
export const MAX_DRIVE_MIN = 45;
/** Boucles « d'une demi-journée » comptées par B1. */
export const LOOP_KM_RANGE = { min: 5, max: 15 } as const;
