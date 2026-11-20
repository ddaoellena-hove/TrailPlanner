import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { LatLng } from '../../shared/schema';
import { ELEVATION_CACHE_PATH } from '../config';

/**
 * Altitudes RGE ALTI via le service d'altimétrie de la Géoplateforme IGN (sans
 * clé). Les réponses sont mises en cache sur disque, indexées par coordonnée
 * arrondie à 1e-5 (≈ 1 m), pour qu'une reconstruction n'appelle plus le service.
 */
const ENDPOINT = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const BATCH = 5000;
/**
 * Hors couverture, le service renvoie -99999, ou une valeur interpolée avec
 * -99999 en bord de côte. Rien sur Terre n'est sous -500 m (mer Morte : -430 m).
 */
const MIN_VALID_M = -500;
const valid = (z: number | null) => (z === null || z < MIN_VALID_M ? null : z);

const key = ({ lat, lng }: LatLng) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

export class ElevationService {
  private cache = new Map<string, number | null>();
  private dirty = false;
  requests = 0;

  async load(): Promise<void> {
    if (!existsSync(ELEVATION_CACHE_PATH)) return;
    const entries = JSON.parse(await readFile(ELEVATION_CACHE_PATH, 'utf8')) as [string, number | null][];
    this.cache = new Map(entries.map(([k, z]) => [k, valid(z)]));
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const tmp = `${ELEVATION_CACHE_PATH}.tmp`;
    await writeFile(tmp, JSON.stringify([...this.cache]));
    await rename(tmp, ELEVATION_CACHE_PATH);
    this.dirty = false;
  }

  /** Altitude de chaque point, `null` hors couverture. */
  async altitudes(points: LatLng[]): Promise<(number | null)[]> {
    const missing = [...new Set(points.map(key).filter((k) => !this.cache.has(k)))];
    for (let i = 0; i < missing.length; i += BATCH) {
      await this.fetchBatch(missing.slice(i, i + BATCH));
    }
    return points.map((p) => this.cache.get(key(p)) ?? null);
  }

  private async fetchBatch(keys: string[]): Promise<void> {
    const coords = keys.map((k) => k.split(','));
    const body = JSON.stringify({
      lon: coords.map(([lon]) => lon).join('|'),
      lat: coords.map(([, lat]) => lat).join('|'),
      resource: 'ign_rge_alti_wld',
      zonly: 'true',
      delimiter: '|',
    });
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      this.requests++;
      if (response.ok) {
        const { elevations } = (await response.json()) as { elevations: number[] };
        if (elevations.length !== keys.length) throw new Error('Altimétrie IGN : réponse incomplète');
        keys.forEach((k, i) => this.cache.set(k, valid(elevations[i]!)));
        this.dirty = true;
        if (this.requests % 10 === 0) await this.save();
        return;
      }
      if (attempt >= 4) throw new Error(`Altimétrie IGN : HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}
