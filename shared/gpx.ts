import { distance, point } from '@turf/turf';
import type { Hike, HikeStats, LatLng, Settings, Trip } from './schema';

export type TrackPoint = LatLng & { altM: number | null };

/** Fenêtre de la moyenne glissante appliquée aux altitudes, en mètres de distance. */
export const SMOOTHING_WINDOW_M = 50;
/** Seuil d'hystérésis du D+/D− (SPEC §5.1). */
export const ELEVATION_HYSTERESIS_M = 5;
const MAX_PROFILE_POINTS = 500;
const LOOP_MAX_GAP_KM = 0.15;
const RETRACE_MAX_GAP_KM = 0.05;
const RETRACE_MIN_SHARE = 0.8;
const RETRACE_SAMPLES = 50;

function distanceKm(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]));
}

function cumulativeKm(points: TrackPoint[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) {
    result.push(result[i - 1]! + distanceKm(points[i - 1]!, points[i]!));
  }
  return result;
}

/** Moyenne des altitudes sur une fenêtre centrée de `SMOOTHING_WINDOW_M`. */
export function smoothAltitudes(altitudes: number[], distancesKm: number[]): number[] {
  const halfWindowKm = SMOOTHING_WINDOW_M / 2000;
  let from = 0;
  let to = 0;
  let sum = 0;
  return altitudes.map((_, i) => {
    const center = distancesKm[i]!;
    while (to < altitudes.length && distancesKm[to]! <= center + halfWindowKm) {
      sum += altitudes[to]!;
      to++;
    }
    while (distancesKm[from]! < center - halfWindowKm) {
      sum -= altitudes[from]!;
      from++;
    }
    return sum / (to - from);
  });
}

export function elevationChange(altitudes: number[]): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  let reference = altitudes[0] ?? 0;
  for (const altitude of altitudes) {
    const delta = altitude - reference;
    if (Math.abs(delta) < ELEVATION_HYSTERESIS_M) continue;
    if (delta > 0) gainM += delta;
    else lossM -= delta;
    reference = altitude;
  }
  return { gainM, lossM };
}

/** Durée de marche selon DIN 33466 (SPEC §5.2). */
export function estimateDurationMin(
  distanceKmValue: number,
  gainM: number,
  lossM: number,
  pace: Settings['pace'],
): number {
  const horizontalH = distanceKmValue / pace.flatKmh;
  const verticalH = gainM / pace.ascentMPerH + lossM / pace.descentMPerH;
  const hours = Math.max(horizontalH, verticalH) + Math.min(horizontalH, verticalH) / 2;
  return hours * pace.breakFactor * 60;
}

/** Recalcule les durées de toutes les randos pour un nouveau rythme (SPEC §5.2). */
export function withPace(trip: Trip, pace: Settings['pace']): Trip {
  return {
    ...trip,
    hikes: trip.hikes.map((hike) => ({
      ...hike,
      stats: {
        ...hike.stats,
        estimatedDurationMin: Math.round(
          estimateDurationMin(
            hike.stats.distanceKm,
            hike.stats.elevationGainM ?? 0,
            hike.stats.elevationLossM ?? 0,
            pace,
          ),
        ),
      },
    })),
  };
}

function retracesItself(points: TrackPoint[]): boolean {
  const half = Math.floor(points.length / 2);
  const outbound = points.slice(0, half + 1);
  const inbound = points.slice(half);
  const step = Math.max(1, Math.floor(inbound.length / RETRACE_SAMPLES));
  const samples = inbound.filter((_, i) => i % step === 0);
  const close = samples.filter((sample) =>
    outbound.some((candidate) => distanceKm(sample, candidate) <= RETRACE_MAX_GAP_KM),
  );
  return close.length / samples.length >= RETRACE_MIN_SHARE;
}

/** Le retour sur la trace est testé d'abord : un aller-retour finit aussi près de son départ. */
export function detectKind(points: TrackPoint[]): Hike['kind'] {
  const start = points[0]!;
  const end = points.at(-1)!;
  const closed = distanceKm(start, end) < LOOP_MAX_GAP_KM;
  if (closed && retracesItself(points)) return 'out-and-back';
  return closed ? 'loop' : 'point-to-point';
}

function sampleIndexes(length: number): number[] {
  if (length <= MAX_PROFILE_POINTS) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: MAX_PROFILE_POINTS }, (_, i) =>
    Math.round((i * (length - 1)) / (MAX_PROFILE_POINTS - 1)),
  );
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Sans altitude complète, les stats d'altitude valent null (SPEC §5.1). */
export function computeHikeStats(points: TrackPoint[], pace: Settings['pace']): HikeStats {
  const distances = cumulativeKm(points);
  const totalKm = distances.at(-1) ?? 0;
  const altitudes = points.flatMap((p) => (p.altM === null ? [] : [p.altM]));
  const smoothed =
    altitudes.length === points.length ? smoothAltitudes(altitudes, distances) : null;
  const change = smoothed && elevationChange(smoothed);

  return {
    distanceKm: round(totalKm, 2),
    elevationGainM: change && round(change.gainM),
    elevationLossM: change && round(change.lossM),
    maxAltitudeM: smoothed && round(Math.max(...smoothed)),
    minAltitudeM: smoothed && round(Math.min(...smoothed)),
    estimatedDurationMin: round(
      estimateDurationMin(totalKm, change?.gainM ?? 0, change?.lossM ?? 0, pace),
    ),
    profile: sampleIndexes(points.length).map((i) => ({
      distKm: round(distances[i]!, 3),
      altM: smoothed && round(smoothed[i]!, 1),
      lat: points[i]!.lat,
      lng: points[i]!.lng,
    })),
  };
}
