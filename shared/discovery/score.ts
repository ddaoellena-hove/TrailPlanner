import { GEOMETRY_GAP_MAX_KM } from '../catalog';
import type { DiscoveryIntent, SuggestionResult } from '../schema';
import type { CatalogTrail } from './types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Score déterministe pondéré par l'intention (paysage, isolement, patrimoine, nouveauté),
 * pénalisé par le bitume et un tracé troué. Aucun LLM.
 */
export function scoreTrail(
  trail: CatalogTrail,
  noveltyScore: number,
  intent: DiscoveryIntent,
): SuggestionResult['scores'] {
  const weightSum = intent.scenic + intent.isolation + intent.heritage + intent.novelty || 1;
  const weighted =
    (intent.scenic * trail.scenicAvg +
      intent.isolation * trail.isolationAvg +
      intent.heritage * trail.heritageAvg +
      intent.novelty * noveltyScore) /
    weightSum;
  const pavedPenalty = 0.35 * trail.pavedRatio;
  const gapPenalty = trail.gapKm > GEOMETRY_GAP_MAX_KM ? 0.2 : 0;
  const total = clamp01(weighted - pavedPenalty - gapPenalty);
  return {
    total: round3(total),
    scenic: round3(trail.scenicAvg),
    isolation: round3(trail.isolationAvg),
    heritage: round3(trail.heritageAvg),
    novelty: round3(noveltyScore),
    pavedPenalty: round3(pavedPenalty),
  };
}
