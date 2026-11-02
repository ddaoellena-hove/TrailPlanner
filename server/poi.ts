import { z } from 'zod';
import { type Box, corridorBoxes } from '../shared/charging';
import type { Poi, Trip } from '../shared/schema';
import type { TripStore } from './trip-store';

/** Serveurs publics souvent saturés : on essaie le suivant avant de renoncer. */
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const USER_AGENT = 'TrailPlanner/0.1 (outil local personnel)';
const TIMEOUT_MS = 20_000;
const MAX_POIS = 300;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

const ResponseSchema = z.object({
  elements: z.array(
    z.object({
      type: z.string(),
      id: z.number(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

const KIND_NAMES: Record<Poi['kind'], string> = {
  water: 'Point d’eau',
  hut: 'Refuge',
  camping: 'Camping',
  parking: 'Parking',
};

function kindOf(tags: Record<string, string>): Poi['kind'] | null {
  if (tags.amenity === 'drinking_water') return 'water';
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut') return 'hut';
  if (tags.tourism === 'camp_site') return 'camping';
  if (tags.amenity === 'parking') return 'parking';
  return null;
}

export function overpassQuery(boxes: Box[]): string {
  const areas = boxes.flatMap(({ south, west, north, east }) => {
    const bbox = `(${south},${west},${north},${east})`;
    return [
      `node["amenity"="drinking_water"]${bbox};`,
      `nwr["tourism"~"^(alpine_hut|wilderness_hut|camp_site)$"]${bbox};`,
      `nwr["amenity"="parking"]["name"]${bbox};`,
    ];
  });
  return `[out:json][timeout:18];(${areas.join('')});out center ${MAX_POIS};`;
}

export function toPois(elements: z.infer<typeof ResponseSchema>['elements']): Poi[] {
  return elements.flatMap((element) => {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    const kind = element.tags ? kindOf(element.tags) : null;
    if (lat === undefined || lng === undefined || !kind) return [];
    return [
      {
        id: `${element.type}/${element.id}`,
        kind,
        name: element.tags?.name ?? KIND_NAMES[kind],
        location: { lat, lng },
      },
    ];
  });
}

async function fetchPois(boxes: Box[]): Promise<Poi[]> {
  const body = new URLSearchParams({ data: overpassQuery(boxes) });
  let lastError: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'user-agent': USER_AGENT },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Overpass : ${response.status}`);
      return toPois(ResponseSchema.parse(await response.json()).elements);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Points utiles autour des randos. Le résultat reste une semaine sur disque, et sert encore si
 * tous les serveurs sont saturés.
 */
export async function findPois(store: TripStore, trip: Trip): Promise<Poi[]> {
  const lines = trip.hikes.map((hike) =>
    hike.stats.profile.map(({ lng, lat }) => [lng, lat]),
  );
  const boxes = corridorBoxes(lines, []);
  if (boxes.length === 0) return [];
  const key = JSON.stringify(boxes);
  const cached = await store.readPoiCache(trip.slug);
  const matching = cached?.key === key ? cached : null;
  if (matching && Date.now() - matching.at < FRESH_MS) return matching.pois;
  try {
    const pois = await fetchPois(boxes);
    await store.writePoiCache(trip.slug, { key, at: Date.now(), pois });
    return pois;
  } catch (error) {
    if (matching) return matching.pois;
    throw error;
  }
}
