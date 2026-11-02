import { formatTimeAfter } from './format';
import type { Day, ItineraryLeg, Settings, Trip } from './schema';

export function timeToMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

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
  return {
    hikingKm,
    elevationGainM,
    hikingMin,
    drivingKm,
    drivingMin,
    placesMin,
    activeMin,
    estimatedEndTime: formatTimeAfter(dayStartTime, activeMin),
    estimatedEndMinutes: timeToMinutes(dayStartTime) + activeMin,
  };
}

/** Part du seuil utilisée, ou null si le seuil n'est pas défini (pas de seuil imposé). */
export function loadRatio(minutes: number, maxHours: number | undefined): number | null {
  return maxHours ? minutes / (maxHours * 60) : null;
}
