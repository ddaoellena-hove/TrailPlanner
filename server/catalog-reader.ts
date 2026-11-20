import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DogAccess, UncertaintyCode } from '../shared/catalog';
import type { CatalogMeta, CatalogTrail, IsochronePolygon } from '../shared/discovery';
import type { LatLng } from '../shared/schema';

export type LoadedCatalog = {
  meta: CatalogMeta;
  trails: CatalogTrail[];
};

export interface CatalogSource {
  load(): Promise<LoadedCatalog | null>;
  fetchIsochrone(origin: LatLng, maxDriveMin: number): Promise<IsochronePolygon | null>;
}

type RawTrailRow = {
  trail_id: string;
  osm_relation_id: number | bigint | null;
  source_type: string;
  name: string | null;
  kind: string;
  distance_m: number | bigint;
  elevation_gain_m: number | bigint | null;
  elevation_loss_m: number | bigint | null;
  estimated_duration_min: number | bigint;
  difficulty: string;
  paved_ratio: number;
  surface_unknown_ratio: number;
  gap_km: number;
  dog_policy: string;
  in_reserve: boolean;
  start_lat: number;
  start_lon: number;
  scenic_avg: number;
  isolation_avg: number;
  heritage_avg: number;
  uncertainties: unknown;
  geojson: string;
};

type RawMetaRow = {
  snapshot_id: string;
  region_name: string;
  dem_source: string;
};

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object' && 'items' in value && Array.isArray(value.items)) {
    return value.items.map(String);
  }
  return [];
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function toNullableNumber(value: number | bigint | null): number | null {
  return value === null ? null : toNumber(value);
}

/**
 * Lit le catalogue DuckDB construit en phase 0 (`catalog_v0.duckdb`), en lecture seule,
 * avec mise en cache en mémoire invalidée automatiquement quand le fichier change sur disque.
 */
export class DuckDbCatalogSource implements CatalogSource {
  private cached: { mtimeMs: number; data: LoadedCatalog } | null = null;
  private isochroneCache = new Map<string, IsochronePolygon>();

  constructor(private readonly catalogPath: string) {}

  async load(): Promise<LoadedCatalog | null> {
    if (!existsSync(this.catalogPath)) return null;
    const info = await stat(this.catalogPath);
    if (this.cached && this.cached.mtimeMs === info.mtimeMs) {
      return this.cached.data;
    }

    const instance = await DuckDBInstance.create(this.catalogPath, { access_mode: 'READ_ONLY' });
    const conn = await instance.connect();
    try {
      await conn.run('LOAD spatial;');
      const metaReader = await conn.runAndReadAll(
        'SELECT snapshot_id, region_name, dem_source FROM catalog_meta LIMIT 1',
      );
      const metaRow = metaReader.getRowObjectsJS()[0] as RawMetaRow | undefined;
      const meta: CatalogMeta = metaRow
        ? {
            snapshotId: metaRow.snapshot_id,
            regionName: metaRow.region_name,
            demSource: metaRow.dem_source,
          }
        : {
            snapshotId: 'unknown',
            regionName: 'unknown',
            demSource: 'IGN RGE ALTI',
          };

      const trailReader = await conn.runAndReadAll(`
        SELECT trail_id, osm_relation_id, source_type, name, kind, distance_m,
               elevation_gain_m, elevation_loss_m, estimated_duration_min, difficulty,
               paved_ratio, surface_unknown_ratio, gap_km, dog_policy, in_reserve,
               start_lat, start_lon, scenic_avg, isolation_avg, heritage_avg,
               uncertainties, ST_AsGeoJSON(geom) AS geojson
        FROM reference_trails
      `);
      const rawRows = trailReader.getRowObjectsJS() as RawTrailRow[];
      const trails: CatalogTrail[] = rawRows.map((r) => {
        const parsed = JSON.parse(r.geojson) as { coordinates: [number, number][] };
        return {
          trailId: r.trail_id,
          osmRelationId: toNullableNumber(r.osm_relation_id),
          sourceType: r.source_type === 'generated_loop' ? 'generated_loop' : 'osm_relation',
          name: r.name,
          kind:
            r.kind === 'out-and-back' || r.kind === 'point-to-point' ? r.kind : 'loop',
          distanceMeters: Math.round(toNumber(r.distance_m)),
          elevationGainMeters:
            r.elevation_gain_m === null ? null : Math.round(toNumber(r.elevation_gain_m)),
          elevationLossMeters:
            r.elevation_loss_m === null ? null : Math.round(toNumber(r.elevation_loss_m)),
          estimatedDurationMin: toNumber(r.estimated_duration_min),
          difficulty:
            r.difficulty === 'easy' || r.difficulty === 'hard' ? r.difficulty : 'moderate',
          pavedRatio: r.paved_ratio,
          surfaceUnknownRatio: r.surface_unknown_ratio,
          gapKm: r.gap_km,
          dogPolicy:
            r.dog_policy === 'allowed' ||
            r.dog_policy === 'leashed' ||
            r.dog_policy === 'forbidden'
              ? (r.dog_policy as DogAccess)
              : 'unknown',
          inReserve: Boolean(r.in_reserve),
          start: { lat: r.start_lat, lng: r.start_lon },
          scenicAvg: r.scenic_avg,
          isolationAvg: r.isolation_avg,
          heritageAvg: r.heritage_avg,
          uncertainties: toArray(r.uncertainties) as UncertaintyCode[],
          coordinates: parsed.coordinates,
        };
      });

      const data: LoadedCatalog = { meta, trails };
      this.cached = { mtimeMs: info.mtimeMs, data };
      return data;
    } finally {
      conn.closeSync();
    }
  }

  /**
   * Isochrone voiture via la Géoplateforme IGN (sans clé), en cache mémoire.
   * Retourne `null` en cas de panne réseau (le moteur bascule sur un rayon estimé).
   */
  async fetchIsochrone(origin: LatLng, maxDriveMin: number): Promise<IsochronePolygon | null> {
    const cacheKey = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}:${Math.round(maxDriveMin)}`;
    const hit = this.isochroneCache.get(cacheKey);
    if (hit) return hit;

    const url = new URL('https://data.geopf.fr/navigation/isochrone');
    url.search = new URLSearchParams({
      point: `${origin.lng},${origin.lat}`,
      resource: 'bdtopo-valhalla',
      costValue: String(Math.round(maxDriveMin)),
      costType: 'time',
      timeUnit: 'minute',
      profile: 'car',
      direction: 'departure',
      geometryFormat: 'geojson',
    }).toString();

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return null;
      const payload = (await response.json()) as { geometry?: IsochronePolygon };
      if (
        !payload.geometry ||
        (payload.geometry.type !== 'Polygon' && payload.geometry.type !== 'MultiPolygon')
      ) {
        return null;
      }
      this.isochroneCache.set(cacheKey, payload.geometry);
      return payload.geometry;
    } catch {
      return null;
    }
  }
}
