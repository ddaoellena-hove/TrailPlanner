import { fastDistanceKm } from '../loop-generator';
import type { CatalogTrail } from './types';

export type ScoredCandidate = {
  trail: CatalogTrail;
  score: number;
};

const GEO_DECAY_KM = 8;

/** Similarité [0, 1] entre deux boucles : proximité géographique, gabarit et ambiance. */
export function trailSimilarity(a: CatalogTrail, b: CatalogTrail): number {
  const geoSim = Math.exp(-fastDistanceKm(a.start, b.start) / GEO_DECAY_KM);
  const maxDist = Math.max(a.distanceMeters, b.distanceMeters, 1);
  const distSim = 1 - Math.min(1, Math.abs(a.distanceMeters - b.distanceMeters) / maxDist);
  const diffSim = a.difficulty === b.difficulty ? 1 : 0.4;
  const profileDiff =
    (Math.abs(a.scenicAvg - b.scenicAvg) +
      Math.abs(a.isolationAvg - b.isolationAvg) +
      Math.abs(a.heritageAvg - b.heritageAvg)) /
    3;
  const moodSim = 1 - Math.min(1, profileDiff);
  return 0.65 * geoSim + 0.2 * (0.6 * distSim + 0.4 * diffSim) + 0.15 * moodSim;
}

/**
 * Maximal Marginal Relevance (MMR) : sélectionne jusqu'à `limit` boucles en arbitrant
 * entre pertinence (`lambda`) et diversité géographique / d'ambiance (`1 - lambda`).
 */
export function diversifyMmr<T extends ScoredCandidate>(
  candidates: T[],
  limit: number,
  lambda = 0.72,
): T[] {
  const remaining = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.trail.trailId.localeCompare(b.trail.trailId);
  });
  const selected: T[] = [];

  while (selected.length < limit && remaining.length > 0) {
    if (selected.length === 0) {
      selected.push(remaining.shift()!);
      continue;
    }
    let bestIndex = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      let maxSim = 0;
      for (const picked of selected) {
        const sim = trailSimilarity(candidate.trail, picked.trail);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * candidate.score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIndex = i;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected;
}
