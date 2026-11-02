import type { Alert } from './alerts';
import { checklistSuggestions } from './checklist';
import type { DayWeather, ItineraryLeg, Settings, Trip } from './schema';
import { dayTotals } from './totals';
import { nightOf, unplanned } from './trip';
import { formatWeather } from './weather';

/** État du voyage pour l'assistant : compact, sans tracés GPX, et toujours dans le même ordre. */
export function describeTrip(
  trip: Trip,
  legs: ItineraryLeg[],
  alerts: Alert[],
  settings: Settings,
  weather: Record<number, DayWeather>,
): string {
  const hikeFacts = (id: string) => {
    const hike = trip.hikes.find((candidate) => candidate.id === id);
    if (!hike) return null;
    const { distanceKm, elevationGainM, estimatedDurationMin, maxAltitudeM } = hike.stats;
    return {
      hikeId: hike.id,
      name: hike.name,
      kind: hike.kind,
      km: distanceKm,
      gainM: elevationGainM,
      minutes: estimatedDurationMin,
      maxAltitudeM,
      dogs: hike.dogPolicy,
      notes: hike.notes,
    };
  };
  const library = unplanned(trip);
  return JSON.stringify({
    name: trip.name,
    dates: [trip.startDate, trip.endDate],
    travelers: trip.travelers,
    pace: settings.pace,
    dayStartTime: settings.dayStartTime,
    thresholds: settings.thresholds,
    days: trip.days.map((day) => {
      const totals = dayTotals(trip, day, legs, settings.dayStartTime);
      const forecast = weather[day.index];
      return {
        dayIndex: day.index,
        date: day.date,
        title: day.title,
        notes: day.notes,
        night: nightOf(trip, day)?.name ?? null,
        stops: day.stops.map((stop) =>
          stop.kind === 'hike'
            ? { stopId: stop.id, startTime: stop.startTime, ...hikeFacts(stop.hikeId) }
            : {
                stopId: stop.id,
                place: trip.places.find(({ id }) => id === stop.placeId)?.name,
                pauseMinutes: stop.durationMin,
              },
        ),
        backups: day.backupHikeIds.map(hikeFacts),
        totals: {
          km: totals.hikingKm,
          gainM: totals.elevationGainM,
          hikingMinutes: totals.hikingMin,
          drivingMinutes: Math.round(totals.drivingMin),
          end: totals.estimatedEndTime,
        },
        weather: forecast?.status === 'forecast' ? formatWeather(forecast) : null,
      };
    }),
    unplannedHikes: library.hikes.map(({ id }) => hikeFacts(id)),
    lodgings: trip.places
      .filter(({ type }) => type === 'lodging')
      .map(({ id, name, bookingStatus, dogPolicy, price }) => ({
        placeId: id,
        name,
        bookingStatus,
        dogPolicy,
        price,
      })),
    alerts: alerts.map(({ code, level, message }) => ({ code, level, message })),
    checklist: (trip.checklist ?? []).map(({ label, done }) => ({ label, done })),
    checklistIdeas: checklistSuggestions(trip).map(({ label }) => label),
  });
}
