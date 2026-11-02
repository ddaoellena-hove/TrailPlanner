import { z } from 'zod';
import {
  deriveLegs,
  type LegEnds,
  routeCacheKey,
  straightLineLeg,
} from '../shared/itinerary';
import type { DriveLeg, Itinerary, ItineraryLeg } from '../shared/schema';
import type { TripStore } from './trip-store';

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
const IGN_URL = 'https://data.geopf.fr/navigation/itineraire';
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 1000;

const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.array(z.number())),
});

const OrsResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: LineStringSchema,
        properties: z.object({ summary: z.object({ distance: z.number(), duration: z.number() }) }),
      }),
    )
    .min(1),
});

const IgnResponseSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: LineStringSchema,
});

/** Calcul d'itinéraire de la Géoplateforme IGN : sans clé, France uniquement. */
async function fetchIgnRoute({ from, to }: LegEnds): Promise<DriveLeg> {
  const params = new URLSearchParams({
    resource: 'bdtopo-valhalla',
    profile: 'car',
    optimization: 'fastest',
    start: `${from.lng},${from.lat}`,
    end: `${to.lng},${to.lat}`,
    geometryFormat: 'geojson',
    getSteps: 'false',
    getBbox: 'false',
    distanceUnit: 'kilometer',
    timeUnit: 'minute',
  });
  const response = await fetch(`${IGN_URL}?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`IGN : ${response.status}`);
  const route = IgnResponseSchema.parse(await response.json());
  return {
    from,
    to,
    distanceKm: route.distance,
    durationMin: route.duration,
    geometry: route.geometry,
    source: 'ign',
  };
}

async function fetchOrsRoute({ from, to }: LegEnds, apiKey: string): Promise<DriveLeg> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(ORS_URL, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt));
      continue;
    }
    if (!response.ok) throw new Error(`ORS : ${response.status}`);
    const { features } = OrsResponseSchema.parse(await response.json());
    const { geometry, properties } = features[0]!;
    return {
      from,
      to,
      distanceKm: properties.summary.distance / 1000,
      durationMin: properties.summary.duration / 60,
      geometry,
      source: 'ors',
    };
  }
}

/**
 * Calcule les trajets du voyage, un à la fois pour respecter les quotas, avec ORS si une clé
 * existe et l'IGN sinon. Les replis ne vont pas en cache : ils seront retentés au calcul suivant.
 */
export async function computeItinerary(
  store: TripStore,
  slug: string,
  apiKey: string | undefined,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<Itinerary> {
  const trip = await store.get(slug);
  const cache = await store.readRouteCache(slug);
  const legs: ItineraryLeg[] = [];
  let cacheChanged = false;

  for (const { from, to, ...names } of deriveLegs(trip)) {
    const ends = { from, to };
    const key = routeCacheKey(ends);
    const cached = refresh ? undefined : cache[key];
    if (cached) {
      legs.push({ ...cached, ...names });
      continue;
    }
    try {
      const leg = apiKey ? await fetchOrsRoute(ends, apiKey) : await fetchIgnRoute(ends);
      cache[key] = leg;
      cacheChanged = true;
      legs.push({ ...leg, ...names });
    } catch (error) {
      console.warn('Routage indisponible :', error);
      legs.push({ ...straightLineLeg(ends), ...names });
    }
  }

  if (cacheChanged) await store.writeRouteCache(slug, cache);
  return { legs };
}
