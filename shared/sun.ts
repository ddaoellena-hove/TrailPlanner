import { getTimes } from 'suncalc';
import { plannedStops } from './itinerary';
import type { Day, LatLng, Trip } from './schema';

export type SunTimes = { sunriseMin: number; sunsetMin: number };

const parisClock = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
});

function parisMinutes(date: Date): number {
  const parts = parisClock.formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return value('hour') * 60 + value('minute');
}

/** Lever et coucher du soleil, en minutes depuis 0 h à l'heure de Paris. */
export function sunTimes(date: string, { lat, lng }: LatLng): SunTimes {
  const { sunrise, sunset } = getTimes(new Date(`${date}T12:00:00Z`), lat, lng);
  // Pas de lever ni de coucher au-delà des cercles polaires : journée entière.
  if (!sunrise || !sunset) return { sunriseMin: 0, sunsetMin: 24 * 60 };
  return { sunriseMin: parisMinutes(sunrise), sunsetMin: parisMinutes(sunset) };
}

/** Soleil du jour, au premier point de la journée. Null pour un jour sans étape. */
export function daySun(trip: Trip, day: Day): SunTimes | null {
  const first = plannedStops(trip).find(({ dayIndex }) => dayIndex === day.index);
  return first ? sunTimes(day.date, first.location) : null;
}
