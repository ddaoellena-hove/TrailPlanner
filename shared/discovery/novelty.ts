import { fastDistanceKm } from '../loop-generator';
import type { Activity, SuggestionFeedback, SuggestionResult } from '../schema';
import type { CatalogTrail } from './types';

const DONE_START_MAX_KM = 0.6;
const DONE_DISTANCE_TOLERANCE = 0.25;
const DONE_POINT_GAP_KM = 0.12;
const DONE_OVERLAP_MIN_SHARE = 0.55;

export type NoveltyAssessment = {
  score: number;
  status: SuggestionResult['noveltyStatus'];
};

function matchesDoneActivity(
  trail: Pick<CatalogTrail, 'start' | 'distanceMeters' | 'coordinates'>,
  activity: Pick<Activity, 'start' | 'distanceMeters' | 'profile'>,
): boolean {
  const longest = Math.max(trail.distanceMeters, activity.distanceMeters);
  if (longest === 0) return false;
  const distDiff = Math.abs(trail.distanceMeters - activity.distanceMeters) / longest;
  if (distDiff > DONE_DISTANCE_TOLERANCE) return false;

  // 1. Départ proche + distance comparable : cas typique d'une boucle déjà faite.
  if (fastDistanceKm(trail.start, activity.start) <= DONE_START_MAX_KM) return true;

  // 2. Sinon recouvrement géométrique échantillonné (départ différent sur la même boucle).
  if (trail.coordinates.length === 0 || activity.profile.length === 0) return false;
  const trailStep = Math.max(1, Math.floor(trail.coordinates.length / 25));
  const actStep = Math.max(1, Math.floor(activity.profile.length / 40));
  const trailSamples = trail.coordinates.filter((_, i) => i % trailStep === 0);
  const actSamples = activity.profile.filter((_, i) => i % actStep === 0);
  const close = trailSamples.filter(([lng, lat]) =>
    actSamples.some((pt) => fastDistanceKm({ lat, lng }, pt) <= DONE_POINT_GAP_KM),
  );
  return close.length / trailSamples.length >= DONE_OVERLAP_MIN_SHARE;
}

/**
 * Déduit la nouveauté d'un sentier à partir de « Mes sorties » et des avis passés.
 * Une boucle déjà faite ou écartée est pénalisée mais jamais masquée silencieusement.
 */
export function assessNovelty(
  trail: Pick<CatalogTrail, 'trailId' | 'start' | 'distanceMeters' | 'coordinates'>,
  activities: Pick<Activity, 'start' | 'distanceMeters' | 'profile'>[],
  feedbacks: Pick<SuggestionFeedback, 'trailId' | 'verdict'>[],
): NoveltyAssessment {
  const latestFeedback = feedbacks.filter((f) => f.trailId === trail.trailId).at(-1);
  if (latestFeedback?.verdict === 'dismissed') {
    return { score: 0.05, status: 'rejected_before' };
  }
  if (activities.some((activity) => matchesDoneActivity(trail, activity))) {
    return { score: 0.15, status: 'done_before' };
  }
  if (latestFeedback?.verdict === 'liked' || latestFeedback?.verdict === 'saved') {
    return { score: 0.85, status: 'new' };
  }
  return { score: 1, status: 'new' };
}
