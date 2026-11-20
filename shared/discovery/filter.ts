import { booleanPointInPolygon, point } from '@turf/turf';
import { fastDistanceKm } from '../loop-generator';
import type { DiscoveryQuery, LatLng } from '../schema';
import {
  FALLBACK_DRIVE_SPEED_KMH,
  FALLBACK_ROAD_DETOUR,
  type CatalogTrail,
  type IsochronePolygon,
} from './types';

/** Estimation simple du temps d'approche en voiture à partir de la distance à vol d'oiseau. */
export function estimateDriveMinutes(origin: LatLng, destination: LatLng): number {
  const crowKm = fastDistanceKm(origin, destination);
  return Math.round(((crowKm * FALLBACK_ROAD_DETOUR) / FALLBACK_DRIVE_SPEED_KMH) * 60);
}

/**
 * Vérifie si le départ (ou le milieu de la trace) tombe dans l'isochrone voiture ;
 * sans isochrone, utilise un rayon estimé transparent.
 */
export function isWithinReach(
  trail: Pick<CatalogTrail, 'start' | 'coordinates'>,
  origin: LatLng,
  maxDriveMin: number,
  isochrone?: IsochronePolygon | null,
): boolean {
  if (isochrone) {
    const poly = isochrone as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    if (booleanPointInPolygon(point([trail.start.lng, trail.start.lat]), poly)) return true;
    const mid = trail.coordinates[Math.floor(trail.coordinates.length / 2)];
    if (mid && booleanPointInPolygon(point(mid), poly)) return true;
    return false;
  }
  return estimateDriveMinutes(origin, trail.start) <= maxDriveMin;
}

/**
 * Filtre dur : ne rejette jamais sur une donnée inconnue (`dogPolicy === 'unknown'`
 * ou `elevationGainMeters === null` restent visibles avec leur incertitude explicite).
 */
export function passesHardConstraints(
  trail: CatalogTrail,
  query: DiscoveryQuery,
  isochrone?: IsochronePolygon | null,
): boolean {
  const minM = query.minDistanceKm * 1000;
  const maxM = query.maxDistanceKm * 1000;
  if (trail.distanceMeters < minM || trail.distanceMeters > maxM) return false;
  if (query.loopsOnly && trail.kind !== 'loop') return false;
  if (
    query.maxElevationGainM !== undefined &&
    trail.elevationGainMeters !== null &&
    trail.elevationGainMeters > query.maxElevationGainM
  ) {
    return false;
  }
  if (query.maxDurationMin !== undefined && trail.estimatedDurationMin > query.maxDurationMin) {
    return false;
  }
  if (query.maxPavedRatio !== undefined && trail.pavedRatio > query.maxPavedRatio) {
    return false;
  }
  if (query.withDog && trail.dogPolicy === 'forbidden') {
    return false;
  }
  return isWithinReach(trail, query.origin, query.maxDriveMin, isochrone);
}
