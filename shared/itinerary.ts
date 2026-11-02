import { distance, point } from '@turf/turf';
import type { DriveLeg, LatLng, PlaceType, Stop, Trip } from './schema';

/** Sous cette distance à vol d'oiseau, on considère qu'on marche (SPEC §4). */
export const MIN_DRIVE_KM = 0.3;
const FALLBACK_DETOUR_FACTOR = 1.3;
const FALLBACK_SPEED_KMH = 70;

type Position = { location: LatLng; name: string; type?: PlaceType; placeId?: string };
export type LegEnds = { from: LatLng; to: LatLng };
/** `phase` situe le trajet : vers l'étape, vers son séjour, ou en fin de journée. */
export type NamedLeg = LegEnds & {
  fromName: string;
  toName: string;
  dayIndex: number;
  stopId: string | null;
  phase: 'enter' | 'stay' | 'end';
  /** Retour d'une rando vers un hébergement, distingué sur la carte. */
  trailToStay: boolean;
};
export type PlannedStop = {
  id: string;
  kind: 'hike' | PlaceType;
  name: string;
  location: LatLng;
  dayIndex: number;
  placeId?: string;
};

function straightLineKm(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]));
}

type ResolvedStop = {
  id: string;
  kind: Stop['kind'];
  enter: Position;
  leave: Position;
  departure?: Position;
  stay?: Position;
};

function placePosition(trip: Trip, id: string | undefined): Position | undefined {
  const place = trip.places.find((candidate) => candidate.id === id);
  return (
    place && {
      location: place.location,
      name: place.name,
      type: place.type,
      placeId: place.id,
    }
  );
}

/** Points de passage d'une étape ; une rando repart de son arrivée. */
function resolveStop(trip: Trip, stop: Stop): ResolvedStop | undefined {
  const { id, kind } = stop;
  const departure = placePosition(trip, stop.departurePlaceId);
  if (stop.kind === 'hike') {
    const hike = trip.hikes.find((candidate) => candidate.id === stop.hikeId);
    if (!hike) return undefined;
    return {
      id,
      kind,
      departure,
      enter: { location: hike.start, name: hike.name },
      leave: { location: hike.end, name: hike.name },
      stay: placePosition(trip, stop.stayPlaceId),
    };
  }
  const place = placePosition(trip, stop.placeId);
  return place && { id, kind, departure, enter: place, leave: place };
}

/** Points à afficher : pour chaque étape son départ, son entrée et son séjour, puis la nuit. */
export function plannedStops(trip: Trip): PlannedStop[] {
  return trip.days.flatMap((day) => {
    const marker = (id: string, position: Position): PlannedStop => ({
      id,
      kind: position.type ?? 'hike',
      name: position.name,
      location: position.location,
      dayIndex: day.index,
      placeId: position.placeId,
    });
    const markers = day.stops.flatMap((stop) => {
      const resolved = resolveStop(trip, stop);
      if (!resolved) return [];
      const { id, departure, enter, stay } = resolved;
      return [
        ...(departure ? [marker(`${id}-departure`, departure)] : []),
        marker(id, enter),
        ...(stay ? [marker(`${id}-stay`, stay)] : []),
      ];
    });
    const night = placePosition(trip, day.nightPlaceId);
    return night ? [...markers, marker(`night-${day.index}`, night)] : markers;
  });
}

/**
 * Trajets voiture du voyage (SPEC §4). Sans `origin`, le voyage commence à la première étape.
 * Un départ renseigné remplace la position courante : aucun trajet n'y mène.
 */
export function deriveLegs(trip: Trip): NamedLeg[] {
  const legs: NamedLeg[] = [];
  let position: Position | undefined = trip.origin && {
    location: trip.origin.location,
    name: trip.origin.name,
    type: trip.origin.type,
  };
  let dayIndex = 1;

  const driveTo = (
    target: Position | undefined,
    stopId: string | null = null,
    phase: NamedLeg['phase'] = 'end',
  ) => {
    if (!target) return;
    if (position && straightLineKm(position.location, target.location) >= MIN_DRIVE_KM) {
      legs.push({
        from: position.location,
        to: target.location,
        fromName: position.name,
        toName: target.name,
        dayIndex,
        stopId,
        phase,
        trailToStay: position.type === undefined && target.type === 'lodging',
      });
    }
    position = target;
  };

  for (const day of trip.days) {
    dayIndex = day.index;
    for (const stop of day.stops) {
      const resolved = resolveStop(trip, stop);
      if (!resolved) continue;
      position = resolved.departure ?? position;
      driveTo(resolved.enter, stop.id, 'enter');
      position = resolved.leave;
      driveTo(resolved.stay, stop.id, 'stay');
    }
    driveTo(placePosition(trip, day.nightPlaceId));
  }
  driveTo(trip.destination && { location: trip.destination.location, name: trip.destination.name });
  return legs;
}

/** Coordonnées arrondies à 4 décimales (SPEC §6). */
export function routeCacheKey({ from, to }: LegEnds): string {
  const format = ({ lat, lng }: LatLng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return `${format(from)}→${format(to)}`;
}

/** Repli sans routage : ligne droite × 1,3 à 70 km/h (SPEC §6). */
export function straightLineLeg({ from, to }: LegEnds): DriveLeg {
  const distanceKm = straightLineKm(from, to) * FALLBACK_DETOUR_FACTOR;
  return {
    from,
    to,
    distanceKm,
    durationMin: (distanceKm / FALLBACK_SPEED_KMH) * 60,
    geometry: {
      type: 'LineString',
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
    source: 'straight-line-fallback',
  };
}

export function itineraryTotals(legs: DriveLeg[]) {
  return {
    distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    estimated: legs.some((leg) => leg.source === 'straight-line-fallback'),
  };
}
