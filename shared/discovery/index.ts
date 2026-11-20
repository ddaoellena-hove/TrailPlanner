import type { DiscoveryQuery, SuggestionResult } from '../schema';
import { buildExplanation } from './explain';
import { estimateDriveMinutes, passesHardConstraints } from './filter';
import { diversifyMmr } from './mmr';
import { assessNovelty } from './novelty';
import { scoreTrail } from './score';
import {
  DEFAULT_DISCOVERY_INTENT,
  type CatalogTrail,
  type DiscoveryContext,
} from './types';

export type DiscoveryRunResult = {
  totalMatching: number;
  suggestions: SuggestionResult[];
};

/**
 * Pipeline pur de découverte : filtre dur → nouveauté → score d'intention → diversification MMR → explication.
 * Déterministe et sans LLM.
 */
export function discoverTrails(
  trails: CatalogTrail[],
  query: DiscoveryQuery,
  context: DiscoveryContext,
): DiscoveryRunResult {
  const intent = query.intent ?? DEFAULT_DISCOVERY_INTENT;
  const eligible = trails.filter((trail) => passesHardConstraints(trail, query, context.isochrone));

  const scored = eligible.map((trail) => {
    const novelty = assessNovelty(trail, context.activities, context.feedbacks);
    const scores = scoreTrail(trail, novelty.score, intent);
    return {
      trail,
      score: scores.total,
      scores,
      noveltyStatus: novelty.status,
    };
  });

  const diversified = diversifyMmr(scored, query.limit, query.diversityLambda);

  const suggestions: SuggestionResult[] = diversified.map(({ trail, scores, noveltyStatus }) => {
    const { explanation, provenance } = buildExplanation(trail, noveltyStatus, context.meta);
    return {
      trailId: trail.trailId,
      osmRelationId: trail.osmRelationId,
      sourceType: trail.sourceType,
      name: trail.name ?? `Boucle ${trail.trailId}`,
      kind: trail.kind,
      distanceMeters: trail.distanceMeters,
      elevationGainMeters: trail.elevationGainMeters,
      elevationLossMeters: trail.elevationLossMeters,
      estimatedDurationMin: trail.estimatedDurationMin,
      difficulty: trail.difficulty,
      pavedRatio: trail.pavedRatio,
      surfaceUnknownRatio: trail.surfaceUnknownRatio,
      dogPolicy: trail.dogPolicy,
      inReserve: trail.inReserve,
      start: { ...trail.start },
      estimatedDriveMin: estimateDriveMinutes(query.origin, trail.start),
      geometry: {
        type: 'LineString',
        coordinates: trail.coordinates,
      },
      scores,
      noveltyStatus,
      explanation,
      provenance,
    };
  });

  return { totalMatching: eligible.length, suggestions };
}

export * from './types';
export { estimateDriveMinutes, isWithinReach, passesHardConstraints } from './filter';
export { assessNovelty } from './novelty';
export { scoreTrail } from './score';
export { diversifyMmr, trailSimilarity } from './mmr';
export { buildExplanation } from './explain';
