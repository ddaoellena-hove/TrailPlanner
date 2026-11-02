import { z } from 'zod';
import type { GeocodeResult } from '../shared/schema';

const COMPLETION_URL = 'https://data.geopf.fr/geocodage/completion/';
const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 6;

const CompletionSchema = z.object({
  results: z.array(z.object({ fulltext: z.string(), x: z.number(), y: z.number() })),
});

/** Autocomplétion d'adresses et de communes françaises (Géoplateforme IGN, sans clé). */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const text = query.trim();
  if (text.length < MIN_QUERY_LENGTH) return [];
  const params = new URLSearchParams({
    text,
    type: 'StreetAddress,PositionOfInterest',
    maximumResponses: String(MAX_RESULTS),
  });
  const response = await fetch(`${COMPLETION_URL}?${params}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Géoplateforme : ${response.status}`);
  const { results } = CompletionSchema.parse(await response.json());
  // Une commune peut revenir plusieurs fois (mairie, lieu-dit) sous le même libellé.
  const byLabel = new Map(results.toReversed().map((result) => [result.fulltext, result]));
  return [...byLabel.values()].toReversed().map(({ fulltext, x, y }) => ({
    label: fulltext,
    location: { lat: y, lng: x },
  }));
}
