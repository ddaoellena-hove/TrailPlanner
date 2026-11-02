import { formatTimeAfter } from './format';
import { daySchedule } from './schedule';
import type { Day, ItineraryLeg, Settings, Trip } from './schema';

export type DayTotals = {
  hikingKm: number;
  elevationGainM: number;
  hikingMin: number;
  drivingKm: number;
  drivingMin: number;
  placesMin: number;
  activeMin: number;
  estimatedEndTime: string;
  /** Minutes depuis 0 h, pour comparer à un seuil. */
  estimatedEndMinutes: number;
};

/** Totaux d'un jour (SPEC §5.3). Les replis ne comptent pas. */
export function dayTotals(
  trip: Trip,
  day: Day,
  legs: ItineraryLeg[],
  dayStartTime: Settings['dayStartTime'],
): DayTotals {
  let hikingKm = 0;
  let elevationGainM = 0;
  let hikingMin = 0;
  let placesMin = 0;
  for (const stop of day.stops) {
    if (stop.kind === 'place') {
      placesMin += stop.durationMin ?? 0;
      continue;
    }
    const stats = trip.hikes.find(({ id }) => id === stop.hikeId)?.stats;
    hikingKm += stats?.distanceKm ?? 0;
    elevationGainM += stats?.elevationGainM ?? 0;
    hikingMin += stats?.estimatedDurationMin ?? 0;
  }
  const dayLegs = legs.filter((leg) => leg.dayIndex === day.index);
  const drivingKm = dayLegs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const drivingMin = dayLegs.reduce((sum, leg) => sum + leg.durationMin, 0);
  const activeMin = hikingMin + drivingMin + placesMin;
  const { endMin } = daySchedule(trip, day, legs, dayStartTime);
  return {
    hikingKm,
    elevationGainM,
    hikingMin,
    drivingKm,
    drivingMin,
    placesMin,
    activeMin,
    estimatedEndTime: formatTimeAfter('00:00', endMin),
    estimatedEndMinutes: endMin,
  };
}

/** Part du seuil utilisée, ou null si le seuil n'est pas défini (pas de seuil imposé). */
export function loadRatio(minutes: number, maxHours: number | undefined): number | null {
  return maxHours ? minutes / (maxHours * 60) : null;
}

export type TripStats = {
  hikeCount: number;
  hikingKm: number;
  elevationGainM: number;
  elevationLossM: number;
  hikingMin: number;
  maxAltitudeM: number | null;
  drivingKm: number;
  drivingMin: number;
};

/** Totaux du voyage : les randos planifiées, comptées à chaque passage, hors replis. */
export function tripStats(trip: Trip, legs: ItineraryLeg[]): TripStats {
  const hikes = trip.days.flatMap((day) =>
    day.stops.flatMap((stop) => {
      const hike = stop.kind === 'hike' ? trip.hikes.find(({ id }) => id === stop.hikeId) : undefined;
      return hike ? [hike.stats] : [];
    }),
  );
  const altitudes = hikes.flatMap(({ maxAltitudeM }) => (maxAltitudeM === null ? [] : [maxAltitudeM]));
  return {
    hikeCount: hikes.length,
    hikingKm: hikes.reduce((sum, stats) => sum + stats.distanceKm, 0),
    elevationGainM: hikes.reduce((sum, stats) => sum + (stats.elevationGainM ?? 0), 0),
    elevationLossM: hikes.reduce((sum, stats) => sum + (stats.elevationLossM ?? 0), 0),
    hikingMin: hikes.reduce((sum, stats) => sum + stats.estimatedDurationMin, 0),
    maxAltitudeM: altitudes.length > 0 ? Math.max(...altitudes) : null,
    drivingKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    drivingMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
  };
}
