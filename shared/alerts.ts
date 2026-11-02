import { distance, point } from '@turf/turf';
import { batteryPlan, batteryWarnings, BATTERY_RESERVE_PERCENT } from './battery';
import { formatClock, formatDuration } from './format';
import { MIN_DRIVE_KM } from './itinerary';
import type { Hike, ItineraryLeg, LatLng, Place, Settings, Stop, Trip } from './schema';
import { daySchedule, timeToMinutes } from './schedule';
import { sunTimes } from './sun';
import { dayTotals } from './totals';
import { nightOf, unplanned } from './trip';

export type AlertLevel = 'error' | 'warning' | 'info';
export type AlertCode = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10';

export type Alert = {
  id: string;
  code: AlertCode;
  level: AlertLevel;
  message: string;
  dayIndex?: number;
  hikeId?: string;
  placeId?: string;
  stopId?: string;
};

function isClose(a: LatLng, b: LatLng): boolean {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat])) < MIN_DRIVE_KM;
}

/** Une étape suivante au départ de la traversée ramène au véhicule. */
function returnsToVehicle(trip: Trip, hike: Hike, next: Stop | undefined): boolean {
  if (next?.kind !== 'place') return false;
  const place = trip.places.find(({ id }) => id === next.placeId);
  return place !== undefined && isClose(place.location, hike.start);
}

function thresholdAlerts(trip: Trip, legs: ItineraryLeg[], settings: Settings): Alert[] {
  const { thresholds, dayStartTime } = settings;
  return trip.days.flatMap((day) => {
    const totals = dayTotals(trip, day, legs, dayStartTime);
    const hoursOver = (minutes: number, maxHours: number | undefined) =>
      maxHours !== undefined && minutes > maxHours * 60;
    const exceeded = [
      hoursOver(totals.hikingMin, thresholds.maxHikingHoursPerDay) &&
        `${formatDuration(totals.hikingMin)} de marche pour ${thresholds.maxHikingHoursPerDay} h max`,
      hoursOver(totals.drivingMin, thresholds.maxDrivingHoursPerDay) &&
        `${formatDuration(totals.drivingMin)} de route pour ${thresholds.maxDrivingHoursPerDay} h max`,
      hoursOver(totals.hikingMin + totals.drivingMin, thresholds.maxTotalActiveHoursPerDay) &&
        `${formatDuration(totals.hikingMin + totals.drivingMin)} de marche et de route pour ${thresholds.maxTotalActiveHoursPerDay} h max`,
      thresholds.maxElevationGainPerDay !== undefined &&
        totals.elevationGainM > thresholds.maxElevationGainPerDay &&
        `${Math.round(totals.elevationGainM)} m D+ pour ${thresholds.maxElevationGainPerDay} m max`,
      thresholds.latestEndTime !== undefined &&
        totals.estimatedEndMinutes > timeToMinutes(thresholds.latestEndTime) &&
        `fin ≈ ${totals.estimatedEndTime} pour ${thresholds.latestEndTime} au plus tard`,
    ].filter((message) => typeof message === 'string');
    return exceeded.map((detail, index) => ({
      id: `A1-${day.index}-${index}`,
      code: 'A1' as const,
      level: 'warning' as const,
      message: `J${day.index} : ${detail}`,
      dayIndex: day.index,
    }));
  });
}

function dogAlert(name: string, policy: Hike['dogPolicy'] | Place['dogPolicy']) {
  if (policy === 'forbidden') {
    return { code: 'A3' as const, level: 'error' as const, message: `Chiens interdits : ${name}` };
  }
  if (policy === 'unknown' || policy === undefined) {
    return { code: 'A4' as const, level: 'warning' as const, message: `Chien à confirmer : ${name}` };
  }
  return null;
}

function dogAlerts(trip: Trip): Alert[] {
  if (!trip.travelers.withDog) return [];
  const alerts = new Map<string, Alert>();
  for (const day of trip.days) {
    const hikeIds = [
      ...day.stops.flatMap((stop) => (stop.kind === 'hike' ? [stop.hikeId] : [])),
      ...day.backupHikeIds,
    ];
    for (const hike of trip.hikes.filter(({ id }) => hikeIds.includes(id))) {
      const alert = dogAlert(hike.name, hike.dogPolicy);
      if (alert) {
        alerts.set(hike.id, {
          ...alert,
          id: `${alert.code}-${hike.id}`,
          dayIndex: day.index,
          hikeId: hike.id,
        });
      }
    }
    const lodgingIds = [
      nightOf(trip, day)?.id,
      ...day.stops.map((stop) => (stop.kind === 'hike' ? stop.stayPlaceId : stop.placeId)),
    ];
    const lodgings = trip.places.filter(
      ({ id, type }) => type === 'lodging' && lodgingIds.includes(id),
    );
    for (const place of lodgings) {
      const alert = dogAlert(place.name, place.dogPolicy);
      if (alert) {
        alerts.set(place.id, {
          ...alert,
          id: `${alert.code}-${place.id}`,
          dayIndex: day.index,
          placeId: place.id,
        });
      }
    }
  }
  return [...alerts.values()];
}

function crossingAlerts(trip: Trip): Alert[] {
  return trip.days.flatMap((day) =>
    day.stops.flatMap((stop, index) => {
      if (stop.kind !== 'hike') return [];
      const hike = trip.hikes.find(({ id }) => id === stop.hikeId);
      if (hike?.kind !== 'point-to-point') return [];
      if (returnsToVehicle(trip, hike, day.stops[index + 1])) return [];
      return [
        {
          id: `A5-${stop.id}`,
          code: 'A5' as const,
          level: 'warning' as const,
          message: `${hike.name} : le véhicule reste au départ`,
          dayIndex: day.index,
          hikeId: hike.id,
          stopId: stop.id,
        },
      ];
    }),
  );
}

/** Une rando finie après le coucher du soleil (A9), avec le soleil à son point de départ. */
function daylightAlerts(trip: Trip, legs: ItineraryLeg[], dayStartTime: string): Alert[] {
  return trip.days.flatMap((day) => {
    const { stops } = daySchedule(trip, day, legs, dayStartTime);
    return day.stops.flatMap((stop): Alert[] => {
      if (stop.kind !== 'hike') return [];
      const hike = trip.hikes.find(({ id }) => id === stop.hikeId);
      const endMin = stops.find(({ stopId }) => stopId === stop.id)?.endMin;
      if (!hike || endMin === undefined) return [];
      const { sunsetMin } = sunTimes(day.date, hike.start);
      if (endMin <= sunsetMin) return [];
      return [
        {
          id: `A9-${stop.id}`,
          code: 'A9',
          level: 'warning',
          message: `${hike.name} : fin ≈ ${formatClock(endMin)}, coucher du soleil à ${formatClock(sunsetMin)}`,
          dayIndex: day.index,
          hikeId: hike.id,
          stopId: stop.id,
        },
      ];
    });
  });
}

/** Une alerte par recharge manquante, pas une par trajet qui suit. */
function batteryAlerts(trip: Trip, legs: ItineraryLeg[]): Alert[] {
  return batteryWarnings(batteryPlan(trip, legs) ?? []).map((step, index) => {
    const { fromName, toName, dayIndex, stopId } = step.leg;
    const route = `J${dayIndex} : ${fromName} → ${toName}`;
    return {
      id: `A10-${index}`,
      code: 'A10',
      level: step.empty ? 'error' : 'warning',
      message: step.empty
        ? `${route} : batterie vide avant l'arrivée`
        : `${route} : ${Math.round(step.toPercent)} % à l'arrivée, sous la réserve de ${BATTERY_RESERVE_PERCENT} %`,
      dayIndex,
      stopId: stopId ?? undefined,
    };
  });
}

/** Toutes les alertes du voyage (SPEC §5.4). Sans seuil défini, A1 ne se déclenche jamais. */
export function computeAlerts(trip: Trip, legs: ItineraryLeg[], settings: Settings): Alert[] {
  const lastDay = trip.days.at(-1)?.index;
  const nights: Alert[] = trip.days
    .filter((day) => day.index !== lastDay && !nightOf(trip, day))
    .map((day) => ({
      id: `A2-${day.index}`,
      code: 'A2',
      level: 'info',
      message: `J${day.index} : nuit non définie`,
      dayIndex: day.index,
    }));
  const library: Alert[] = unplanned(trip).hikes.map((hike) => ({
    id: `A6-${hike.id}`,
    code: 'A6',
    level: 'info',
    message: `${hike.name} : dans aucun jour`,
    hikeId: hike.id,
  }));
  const fallbacks: Alert[] = legs
    .filter((leg) => leg.source === 'straight-line-fallback')
    .map((leg, index) => ({
      id: `A7-${index}`,
      code: 'A7',
      level: 'warning',
      message: `${leg.fromName} → ${leg.toName} : trajet estimé à vol d'oiseau`,
      dayIndex: leg.dayIndex,
    }));
  const bookings: Alert[] = trip.places
    .filter(({ type, bookingStatus }) =>
      type === 'lodging' && (bookingStatus === 'to-book' || bookingStatus === 'idea'),
    )
    .map((place) => ({
      id: `A8-${place.id}`,
      code: 'A8',
      level: 'info',
      message: `${place.name} : ${place.bookingStatus === 'idea' ? 'simple idée' : 'à réserver'}`,
      dayIndex: trip.days.find((day) => nightOf(trip, day)?.id === place.id)?.index,
      placeId: place.id,
    }));

  const order: Record<AlertLevel, number> = { error: 0, warning: 1, info: 2 };
  return [
    ...thresholdAlerts(trip, legs, settings),
    ...nights,
    ...dogAlerts(trip),
    ...crossingAlerts(trip),
    ...daylightAlerts(trip, legs, settings.dayStartTime),
    ...batteryAlerts(trip, legs),
    ...library,
    ...fallbacks,
    ...bookings,
  ].sort((a, b) => order[a.level] - order[b.level]);
}
