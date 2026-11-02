import { estimateDurationMin } from './gpx';
import type {
  Day,
  Hike,
  LatLng,
  Place,
  PlaceInput,
  Settings,
  Stop,
  StopPlaces,
  Trip,
  TripSummary,
} from './schema';

const DAY_MS = 86_400_000;

function toUtcMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/** Nom de voyage → slug : minuscules, sans accents, tirets. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'voyage';
}

export function countDays(startDate: string, endDate: string): number {
  return Math.round((toUtcMs(endDate) - toUtcMs(startDate)) / DAY_MS) + 1;
}

/** Crée un jour vide par date, de `startDate` à `endDate` inclus. */
export function generateDays(startDate: string, endDate: string): Day[] {
  const start = toUtcMs(startDate);
  return Array.from({ length: countDays(startDate, endDate) }, (_, i) => ({
    date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    index: i + 1,
    stops: [],
    backupHikeIds: [],
  }));
}

/** Résumé d'un voyage pour l'accueil. Les totaux ne comptent que les randos planifiées, hors replis. */
export function summarizeTrip(trip: Trip): TripSummary {
  const hikesById = new Map(trip.hikes.map((hike) => [hike.id, hike]));
  let totalKm = 0;
  let totalElevationGainM = 0;
  for (const day of trip.days) {
    for (const stop of day.stops) {
      if (stop.kind !== 'hike') continue;
      const stats = hikesById.get(stop.hikeId)?.stats;
      totalKm += stats?.distanceKm ?? 0;
      totalElevationGainM += stats?.elevationGainM ?? 0;
    }
  }
  return {
    slug: trip.slug,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dayCount: countDays(trip.startDate, trip.endDate),
    totalKm,
    totalElevationGainM,
    lastNotionExportAt: trip.notion?.lastExportAt ?? null,
  };
}

function appendStop(trip: Trip, dayIndex: number, stop: Stop): Trip {
  return {
    ...trip,
    days: trip.days.map((day) =>
      day.index === dayIndex ? { ...day, stops: [...day.stops, stop] } : day,
    ),
  };
}

/** Fait d'une rando de la bibliothèque la dernière étape du jour. */
export function planHike(trip: Trip, dayIndex: number, hikeId: string): Trip {
  return appendStop(trip, dayIndex, { id: crypto.randomUUID(), kind: 'hike', hikeId });
}

/** Fait d'un lieu du voyage la dernière étape du jour. */
export function planPlace(trip: Trip, dayIndex: number, placeId: string): Trip {
  return appendStop(trip, dayIndex, { id: crypto.randomUUID(), kind: 'place', placeId });
}

export function addHikes(trip: Trip, hikes: Hike[]): Trip {
  return { ...trip, hikes: [...trip.hikes, ...hikes] };
}

export function addHikeStop(trip: Trip, dayIndex: number, hike: Hike): Trip {
  return planHike({ ...trip, hikes: [...trip.hikes, hike] }, dayIndex, hike.id);
}

export function addPlaceStop(trip: Trip, dayIndex: number, place: Place): Trip {
  return planPlace({ ...trip, places: [...trip.places, place] }, dayIndex, place.id);
}

export function updateHike(
  trip: Trip,
  hikeId: string,
  changes: Partial<Omit<Hike, 'id'>>,
): Trip {
  return {
    ...trip,
    hikes: trip.hikes.map((hike) => (hike.id === hikeId ? { ...hike, ...changes } : hike)),
  };
}

/** Remplace le tracé d'une rando en conservant son id, donc son planning et sa fiche. */
export function replaceHikeTrack(trip: Trip, hikeId: string, track: Hike): Trip {
  const { gpxFile, kind, stats, start, end } = track;
  return updateHike(trip, hikeId, { gpxFile, kind, stats, start, end });
}

export function updateDay(
  trip: Trip,
  dayIndex: number,
  changes: Partial<Pick<Day, 'title' | 'notes' | 'backupHikeIds' | 'nightPlaceId'>>,
): Trip {
  return {
    ...trip,
    days: trip.days.map((day) => (day.index === dayIndex ? { ...day, ...changes } : day)),
  };
}

function stopRefs(stop: Stop): string[] {
  const refs = stop.kind === 'hike' ? [stop.hikeId, stop.stayPlaceId] : [stop.placeId];
  return [...refs, stop.departurePlaceId].filter((id) => id !== undefined);
}

function usedIds(days: Day[]): Set<string> {
  return new Set(
    days.flatMap((day) => [
      ...day.backupHikeIds,
      ...(day.nightPlaceId ? [day.nightPlaceId] : []),
      ...day.stops.flatMap(stopRefs),
    ]),
  );
}

/** Retire de la bibliothèque ceux de `candidates` que plus rien n'utilise. */
function dropOrphans(trip: Trip, candidates: string[]): Trip {
  const used = usedIds(trip.days);
  const orphans = new Set(candidates.filter((id) => !used.has(id)));
  return {
    ...trip,
    hikes: trip.hikes.filter((hike) => !orphans.has(hike.id)),
    places: trip.places.filter((place) => !orphans.has(place.id)),
  };
}

/** Retire une étape, et sa rando et ses lieux si plus rien ne les utilise. */
export function removeStop(trip: Trip, stopId: string): Trip {
  const removed = trip.days.flatMap((day) => day.stops).find((stop) => stop.id === stopId);
  const days = trip.days.map((day) => ({
    ...day,
    stops: day.stops.filter((stop) => stop.id !== stopId),
  }));
  return dropOrphans({ ...trip, days }, removed ? stopRefs(removed) : []);
}

export function addPlace(trip: Trip, place: Place): Trip {
  return { ...trip, places: [...trip.places, place] };
}

export function updatePlace(trip: Trip, placeId: string, changes: Partial<Omit<Place, 'id'>>): Trip {
  return {
    ...trip,
    places: trip.places.map((place) => (place.id === placeId ? { ...place, ...changes } : place)),
  };
}

/** Retire un lieu du voyage, de ses étapes, de ses nuits, et de tout ce qui y renvoie. */
export function removePlace(trip: Trip, placeId: string): Trip {
  return {
    ...trip,
    places: trip.places.filter((place) => place.id !== placeId),
    days: trip.days.map((day) => ({
      ...day,
      nightPlaceId: day.nightPlaceId === placeId ? undefined : day.nightPlaceId,
      stops: day.stops
        .filter((stop) => stop.kind !== 'place' || stop.placeId !== placeId)
        .map((stop) => ({
          ...stop,
          departurePlaceId: stop.departurePlaceId === placeId ? undefined : stop.departurePlaceId,
          ...(stop.kind === 'hike' && stop.stayPlaceId === placeId
            ? { stayPlaceId: undefined }
            : {}),
        })),
    })),
  };
}

/** Applique une politique chiens à plusieurs éléments. Un lieu n'a pas de « laisse » : autorisé. */
export function setDogPolicies(
  trip: Trip,
  ids: string[],
  policy: Exclude<Hike['dogPolicy'], 'unknown'>,
): Trip {
  return {
    ...trip,
    hikes: trip.hikes.map((hike) =>
      ids.includes(hike.id) ? { ...hike, dogPolicy: policy } : hike,
    ),
    places: trip.places.map((place) =>
      ids.includes(place.id)
        ? { ...place, dogPolicy: policy === 'leash' ? 'allowed' : policy }
        : place,
    ),
  };
}

/** Endroit où insérer une étape : avant une étape existante, ou en fin de journée. */
export type StopSlot = {
  key: string;
  label: string;
  dayIndex: number;
  position: number;
  location?: LatLng;
};

export function stopSlots(trip: Trip): StopSlot[] {
  return trip.days.flatMap((day) => {
    const resolved = day.stops.map((stop) => {
      const hike = stop.kind === 'hike' ? trip.hikes.find(({ id }) => id === stop.hikeId) : undefined;
      const place =
        stop.kind === 'place' ? trip.places.find(({ id }) => id === stop.placeId) : undefined;
      return { name: hike?.name ?? place?.name ?? 'étape', location: hike?.start ?? place?.location };
    });
    return [
      ...resolved.map(({ name, location }, position) => ({
        key: `${day.index}:${position}`,
        label: `J${day.index} · avant ${name}`,
        dayIndex: day.index,
        position,
        location,
      })),
      {
        key: `${day.index}:end`,
        label: `J${day.index} · en fin de journée`,
        dayIndex: day.index,
        position: day.stops.length,
        location: resolved.at(-1)?.location,
      },
    ];
  });
}

/** Insère une étape de recharge, en ajoutant la borne aux lieux si elle n'y est pas encore. */
export function insertChargeStop(
  trip: Trip,
  place: Place,
  dayIndex: number,
  position: number,
  durationMin: number | undefined,
): Trip {
  const known = trip.places.some(({ id }) => id === place.id);
  const stop: Stop = {
    id: crypto.randomUUID(),
    kind: 'place',
    placeId: place.id,
    ...(durationMin === undefined ? {} : { durationMin }),
  };
  return {
    ...trip,
    places: known ? trip.places : [...trip.places, place],
    days: trip.days.map((day) =>
      day.index === dayIndex ? { ...day, stops: day.stops.toSpliced(position, 0, stop) } : day,
    ),
  };
}

export function setStopStartTime(trip: Trip, stopId: string, startTime: string | undefined): Trip {
  return {
    ...trip,
    days: trip.days.map((day) => ({
      ...day,
      stops: day.stops.map((stop) =>
        stop.id === stopId && stop.kind === 'hike' ? { ...stop, startTime } : stop,
      ),
    })),
  };
}

/** Voyage en boucle : l'arrivée est le départ, ou n'a pas été choisie autrement. */
export function isRoundTrip({ origin, destination }: Trip): boolean {
  return !destination || destination.id === origin?.id;
}

/** Change le départ. Dans un voyage en boucle, l'arrivée suit. */
export function setOrigin(trip: Trip, origin: Place | undefined): Trip {
  return { ...trip, origin, destination: isRoundTrip(trip) ? origin : trip.destination };
}

export function setDestination(trip: Trip, destination: Place | undefined): Trip {
  return { ...trip, destination };
}

export function setStopDuration(trip: Trip, stopId: string, durationMin: number | undefined): Trip {
  return {
    ...trip,
    days: trip.days.map((day) => ({
      ...day,
      stops: day.stops.map((stop) =>
        stop.id === stopId && stop.kind === 'place' ? { ...stop, durationMin } : stop,
      ),
    })),
  };
}

/** Le lieu de la nuit : le choix explicite, sinon le dernier séjour du jour. */
export function nightOf(trip: Trip, day: Day): Place | undefined {
  const lodgingId = (id: string | undefined) =>
    trip.places.find((place) => place.id === id && place.type === 'lodging')?.id;
  const stayIds = day.stops.flatMap((stop) => {
    const id = lodgingId(stop.kind === 'hike' ? stop.stayPlaceId : stop.placeId);
    return id ? [id] : [];
  });
  const id = day.nightPlaceId ?? stayIds.at(-1);
  return trip.places.find((place) => place.id === id);
}

/** Convertit une traversée en aller-retour (A5) : on refait le chemin en sens inverse. */
export function convertToOutAndBack(trip: Trip, hikeId: string, pace: Settings['pace']): Trip {
  const hike = trip.hikes.find(({ id }) => id === hikeId);
  if (!hike) return trip;
  const { stats } = hike;
  const lengthKm = stats.profile.at(-1)?.distKm ?? stats.distanceKm;
  const way = stats.profile.slice(0, -1).reverse();
  const merged = [
    ...stats.profile,
    ...way.map((point) => ({ ...point, distKm: 2 * lengthKm - point.distKm })),
  ];
  const profile =
    merged.length > 500
      ? merged.filter((_, index) => index % 2 === 0 || index === merged.length - 1)
      : merged;
  const climbs =
    stats.elevationGainM === null || stats.elevationLossM === null
      ? null
      : stats.elevationGainM + stats.elevationLossM;
  const distanceKm = stats.distanceKm * 2;
  return updateHike(trip, hikeId, {
    kind: 'out-and-back',
    end: hike.start,
    stats: {
      ...stats,
      distanceKm,
      elevationGainM: climbs,
      elevationLossM: climbs,
      estimatedDurationMin: Math.round(
        estimateDurationMin(distanceKm, climbs ?? 0, climbs ?? 0, pace),
      ),
      profile: profile.slice(0, 500),
    },
  });
}

/** Ajoute après une traversée un retour au véhicule, garé au départ de la rando (A5). */
export function addRecoveryStop(trip: Trip, stopId: string): Trip {
  const stop = trip.days.flatMap((day) => day.stops).find(({ id }) => id === stopId);
  const hike =
    stop?.kind === 'hike' ? trip.hikes.find(({ id }) => id === stop.hikeId) : undefined;
  if (!hike) return trip;
  const place: Place = {
    id: crypto.randomUUID(),
    type: 'parking',
    name: `Parking de ${hike.name}`,
    location: hike.start,
  };
  const recovery: Stop = { id: crypto.randomUUID(), kind: 'place', placeId: place.id };
  return {
    ...trip,
    places: [...trip.places, place],
    days: trip.days.map((day) => {
      const index = day.stops.findIndex(({ id }) => id === stopId);
      return index === -1
        ? day
        : { ...day, stops: day.stops.toSpliced(index + 1, 0, recovery) };
    }),
  };
}

/** Retire une rando du voyage, de toutes ses étapes et de tous les replis. */
export function removeHike(trip: Trip, hikeId: string): Trip {
  const removedStops = trip.days
    .flatMap((day) => day.stops)
    .filter((stop) => stop.kind === 'hike' && stop.hikeId === hikeId);
  const days = trip.days.map((day) => ({
    ...day,
    stops: day.stops.filter((stop) => !removedStops.includes(stop)),
    backupHikeIds: day.backupHikeIds.filter((id) => id !== hikeId),
  }));
  return dropOrphans({ ...trip, days }, [hikeId, ...removedStops.flatMap(stopRefs)]);
}

/** Déplace une étape à la position `position` du jour `dayIndex`, ce jour compris. */
export function moveStop(trip: Trip, stopId: string, dayIndex: number, position: number): Trip {
  const stop = trip.days.flatMap((day) => day.stops).find(({ id }) => id === stopId);
  if (!stop) return trip;
  return {
    ...trip,
    days: trip.days.map((day) => {
      const stops = day.stops.filter(({ id }) => id !== stopId);
      if (day.index === dayIndex) stops.splice(position, 0, stop);
      return { ...day, stops };
    }),
  };
}

/** Enregistre le départ et le séjour d'une étape. Une étape `place` est elle-même le séjour. */
export function setStopPlaces(trip: Trip, stopId: string, { departure, stay }: StopPlaces): Trip {
  const stop = trip.days.flatMap((day) => day.stops).find(({ id }) => id === stopId);
  if (!stop) return trip;

  let places = trip.places;
  const upsert = (id: string | undefined, type: Place['type'], input: PlaceInput) => {
    const existing = places.find((place) => place.id === id);
    const place: Place = { ...(existing ?? { id: crypto.randomUUID(), type }), ...input };
    places = existing
      ? places.map((candidate) => (candidate.id === id ? place : candidate))
      : [...places, place];
    return place.id;
  };

  const departurePlaceId = departure
    ? upsert(stop.departurePlaceId, 'poi', departure)
    : undefined;
  const updated: Stop =
    stop.kind === 'hike'
      ? {
          ...stop,
          departurePlaceId,
          stayPlaceId: stay ? upsert(stop.stayPlaceId, 'lodging', stay) : undefined,
        }
      : {
          ...stop,
          departurePlaceId,
          placeId: stay ? upsert(stop.placeId, 'lodging', stay) : stop.placeId,
        };

  const days = trip.days.map((day) => ({
    ...day,
    stops: day.stops.map((candidate) => (candidate.id === stopId ? updated : candidate)),
  }));
  return dropOrphans({ ...trip, places, days }, stopRefs(stop));
}

/** Randos et lieux du voyage placés dans aucun jour. */
export function unplanned(trip: Trip): { hikes: Hike[]; places: Place[] } {
  const used = usedIds(trip.days);
  return {
    hikes: trip.hikes.filter((hike) => !used.has(hike.id)),
    places: trip.places.filter((place) => !used.has(place.id)),
  };
}

/**
 * Jours du voyage pour de nouvelles dates. Un voyage décalé garde son programme jour par jour ;
 * un voyage raccourci ou allongé garde chaque étape à sa date.
 */
function matchDays(trip: Trip, startDate: string, endDate: string): Day[] {
  const fresh = generateDays(startDate, endDate);
  const overlaps = startDate <= trip.endDate && endDate >= trip.startDate;
  const byDate = overlaps && fresh.length !== trip.days.length;
  return fresh.map((day) => {
    const previous = byDate
      ? trip.days.find(({ date }) => date === day.date)
      : trip.days[day.index - 1];
    return previous ? { ...previous, date: day.date, index: day.index } : day;
  });
}

/** Nombre de jours avec des étapes que ces dates feraient disparaître. */
export function countDroppedDays(trip: Trip, startDate: string, endDate: string): number {
  const kept = new Set(matchDays(trip, startDate, endDate).map((day) => day.stops));
  return trip.days.filter((day) => day.stops.length > 0 && !kept.has(day.stops)).length;
}

/** Les étapes des jours retirés retournent dans la bibliothèque (SPEC US3). */
export function changeDates(trip: Trip, startDate: string, endDate: string): Trip {
  return { ...trip, startDate, endDate, days: matchDays(trip, startDate, endDate) };
}

/** Lien d'itinéraire vers un point : pour une rando, son départ dans le GPX. */
export function directionsUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
