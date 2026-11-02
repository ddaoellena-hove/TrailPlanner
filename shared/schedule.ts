import type { Day, ItineraryLeg, Trip } from './schema';

export function timeToMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export type StopTiming = { stopId: string; startMin: number; endMin: number };
export type DaySchedule = { stops: StopTiming[]; endMin: number };

/**
 * Horaire d'un jour, en minutes depuis 0 h. L'heure court depuis `dayStartTime` en ajoutant
 * trajets, randos et pauses ; un `startTime` recale la rando à l'heure choisie.
 */
export function daySchedule(
  trip: Trip,
  day: Day,
  legs: ItineraryLeg[],
  dayStartTime: string,
): DaySchedule {
  const dayLegs = legs.filter((leg) => leg.dayIndex === day.index);
  const driveMin = (stopId: string | null, phase: ItineraryLeg['phase']) =>
    dayLegs
      .filter((leg) => leg.stopId === stopId && leg.phase === phase)
      .reduce((sum, leg) => sum + leg.durationMin, 0);

  let clock = timeToMinutes(dayStartTime);
  const stops = day.stops.map((stop) => {
    clock += driveMin(stop.id, 'enter');
    if (stop.kind === 'hike' && stop.startTime) clock = timeToMinutes(stop.startTime);
    const startMin = clock;
    clock +=
      stop.kind === 'hike'
        ? (trip.hikes.find(({ id }) => id === stop.hikeId)?.stats.estimatedDurationMin ?? 0)
        : (stop.durationMin ?? 0);
    const timing = { stopId: stop.id, startMin, endMin: clock };
    clock += driveMin(stop.id, 'stay');
    return timing;
  });
  return { stops, endMin: clock + driveMin(null, 'end') };
}
