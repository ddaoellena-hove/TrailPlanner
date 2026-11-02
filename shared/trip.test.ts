import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  formatDateRange,
  formatDay,
  formatDayCount,
  formatDuration,
  formatElevationGain,
  formatKm,
  formatTimeAfter,
} from './format';
import { NewTripSchema, type Hike, type Trip, TripSchema } from './schema';
import {
  addHikeStop,
  addHikes,
  addPlace,
  addPlaceStop,
  addRecoveryStop,
  changeDates,
  convertToOutAndBack,
  countDays,
  countDroppedDays,
  directionsUrl,
  generateDays,
  moveStop,
  nightOf,
  removeHike,
  removePlace,
  removeStop,
  replaceHikeTrack,
  setStopDuration,
  setStopPlaces,
  slugify,
  summarizeTrip,
  unplanned,
  updateDay,
  updateHike,
} from './trip';

const place = { id: randomUUID(), type: 'poi' as const, name: 'Lyon', location: { lat: 45.76, lng: 4.84 } };

function hike(distanceKm: number, elevationGainM: number | null): Hike {
  return {
    id: randomUUID(),
    name: 'Rando',
    gpxFile: 'gpx/rando.gpx',
    kind: 'loop',
    stats: {
      distanceKm,
      elevationGainM,
      elevationLossM: elevationGainM,
      maxAltitudeM: null,
      minAltitudeM: null,
      estimatedDurationMin: 60,
      profile: [],
    },
    start: place.location,
    end: place.location,
    dogPolicy: 'unknown',
  };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    slug: 'devoluy',
    name: 'Dévoluy',
    startDate: '2027-07-01',
    endDate: '2027-07-03',
    origin: place,
    destination: place,
    travelers: { withDog: false },
    hikes: [],
    places: [],
    days: generateDays('2027-07-01', '2027-07-03'),
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('slugify', () => {
  it('retire accents, ligatures et ponctuation', () => {
    expect(slugify('Dévoluy & Champsaur')).toBe('devoluy-champsaur');
    expect(slugify("  Cœur de l'Écrin !  ")).toBe('coeur-de-l-ecrin');
  });

  it('retombe sur « voyage » quand il ne reste rien', () => {
    expect(slugify('⛰️')).toBe('voyage');
  });
});

describe('generateDays', () => {
  it('compte début et fin inclus', () => {
    expect(countDays('2027-07-01', '2027-07-01')).toBe(1);
    expect(countDays('2027-07-01', '2027-07-05')).toBe(5);
  });

  it('numérote les jours et franchit les mois', () => {
    const days = generateDays('2027-01-30', '2027-02-02');
    expect(days.map((day) => day.date)).toEqual([
      '2027-01-30',
      '2027-01-31',
      '2027-02-01',
      '2027-02-02',
    ]);
    expect(days.map((day) => day.index)).toEqual([1, 2, 3, 4]);
  });

  it("n'est pas décalé par le changement d'heure", () => {
    expect(generateDays('2027-03-27', '2027-03-29').at(-1)?.date).toBe('2027-03-29');
  });
});

describe('summarizeTrip', () => {
  it('additionne les randos planifiées seulement', () => {
    const planned = hike(10.5, 800);
    const noAltitude = hike(4, null);
    const unplanned = hike(100, 5000);
    const backup = hike(50, 2000);
    const days = generateDays('2027-07-01', '2027-07-03');
    days[0]!.stops = [{ id: randomUUID(), kind: 'hike', hikeId: planned.id }];
    days[1]!.stops = [{ id: randomUUID(), kind: 'hike', hikeId: noAltitude.id }];
    days[1]!.backupHikeIds = [backup.id];

    const summary = summarizeTrip(
      trip({ hikes: [planned, noAltitude, unplanned, backup], days }),
    );

    expect(summary.totalKm).toBe(14.5);
    expect(summary.totalElevationGainM).toBe(800);
    expect(summary.dayCount).toBe(3);
    expect(summary.lastNotionExportAt).toBeNull();
  });
});

describe('étapes', () => {
  it('ajoute, modifie puis retire une étape', () => {
    const added = addHikeStop(trip(), 2, hike(5, 100));
    const stop = added.days[1]!.stops[0]!;
    expect(added.hikes).toHaveLength(1);
    expect(added.days[0]!.stops).toEqual([]);

    const hikeId = added.hikes[0]!.id;
    const renamed = updateHike(added, hikeId, { name: 'Festre', alltrailsUrl: undefined });
    expect(renamed.hikes[0]!.name).toBe('Festre');

    const removed = removeStop(renamed, stop.id);
    expect(removed.days[1]!.stops).toEqual([]);
    expect(removed.hikes).toEqual([]);
  });

  it('garde une rando encore utilisée en repli', () => {
    const added = addHikeStop(trip(), 1, hike(5, 100));
    const hikeId = added.hikes[0]!.id;
    added.days[1]!.backupHikeIds = [hikeId];
    expect(removeStop(added, added.days[0]!.stops[0]!.id).hikes).toHaveLength(1);
  });

  it('construit le lien d’itinéraire', () => {
    expect(directionsUrl({ lat: 44.7, lng: 5.9 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=44.7,5.9',
    );
  });
});

describe('étapes de séjour', () => {
  const lodging = { ...place, type: 'lodging' as const, name: 'Gîte' };

  const stay = { name: 'Refuge', location: { lat: 1, lng: 2 }, url: 'https://refuge.example/' };
  const departure = { name: 'Lyon', location: { lat: 3, lng: 4 } };

  it('modifie le séjour d’une étape de séjour sans créer de lieu', () => {
    const added = addPlaceStop(trip(), 1, lodging);
    const stopId = added.days[0]!.stops[0]!.id;
    const moved = setStopPlaces(added, stopId, { departure: null, stay });
    expect(moved.places).toHaveLength(1);
    expect(moved.places[0]).toMatchObject({ id: lodging.id, ...stay });
    expect(removeStop(moved, stopId).places).toEqual([]);
  });

  it('crée, met à jour et retire le départ et le séjour d’une rando', () => {
    const added = addHikeStop(trip(), 1, hike(5, 100));
    const stopId = added.days[0]!.stops[0]!.id;

    const first = setStopPlaces(added, stopId, { departure, stay });
    expect(first.places.map((item) => item.type).toSorted()).toEqual(['lodging', 'poi']);

    const second = setStopPlaces(first, stopId, {
      departure,
      stay: { ...stay, name: 'Hôtel', url: undefined },
    });
    expect(second.places).toHaveLength(2);
    expect(second.places.find(({ type }) => type === 'lodging')).toMatchObject({ name: 'Hôtel' });
    expect(second.places.find(({ type }) => type === 'lodging')?.url).toBeUndefined();

    expect(setStopPlaces(second, stopId, { departure: null, stay: null }).places).toEqual([]);
    expect(removeStop(second, stopId).places).toEqual([]);
    expect(unplanned(second).places).toEqual([]);
  });

  it('garde un lieu encore utilisé pour la nuit', () => {
    const added = addPlaceStop(trip(), 1, lodging);
    added.days[1]!.nightPlaceId = lodging.id;
    expect(removeStop(added, added.days[0]!.stops[0]!.id).places).toHaveLength(1);
  });
});

describe('bibliothèque', () => {
  it('ajoute des randos sans les planifier', () => {
    const added = addHikes(trip(), [hike(1, 0), hike(2, 0)]);
    expect(unplanned(added).hikes).toHaveLength(2);
  });

  it('remplace un tracé en gardant id, nom et planning', () => {
    const planned = addHikeStop(trip(), 1, { ...hike(1, 0), name: 'Festre', notes: 'Eau' });
    const id = planned.hikes[0]!.id;
    const replaced = replaceHikeTrack(planned, id, { ...hike(9, 900), gpxFile: 'gpx/new.gpx' });
    expect(replaced.hikes[0]).toMatchObject({ id, name: 'Festre', notes: 'Eau', gpxFile: 'gpx/new.gpx' });
    expect(replaced.hikes[0]!.stats.distanceKm).toBe(9);
    expect(replaced.days[0]!.stops).toHaveLength(1);
  });

  it('supprime une rando de ses étapes, de ses replis et ses lieux orphelins', () => {
    const planned = addHikeStop(trip(), 1, hike(1, 0));
    const id = planned.hikes[0]!.id;
    const withStay = setStopPlaces(planned, planned.days[0]!.stops[0]!.id, {
      departure: null,
      stay: { name: 'Gîte', location: place.location },
    });
    const removed = removeHike(updateDay(withStay, 2, { backupHikeIds: [id] }), id);
    expect(removed.hikes).toEqual([]);
    expect(removed.places).toEqual([]);
    expect(removed.days[0]!.stops).toEqual([]);
    expect(removed.days[1]!.backupHikeIds).toEqual([]);
  });

  it('modifie le titre d’un seul jour', () => {
    const updated = updateDay(trip(), 2, { title: 'Col du Festre' });
    expect(updated.days.map((day) => day.title)).toEqual([undefined, 'Col du Festre', undefined]);
  });
});

describe('lieux et nuits', () => {
  const hotel = { ...place, id: randomUUID(), type: 'lodging' as const, name: 'Hôtel' };
  const gite = { ...place, id: randomUUID(), type: 'lodging' as const, name: 'Gîte' };
  const parking = { ...place, id: randomUUID(), type: 'parking' as const, name: 'Parking' };

  it('prend le dernier séjour du jour comme nuit, sauf choix explicite', () => {
    const planned = addPlaceStop(addPlaceStop(addPlaceStop(trip(), 1, hotel), 1, gite), 1, parking);
    expect(nightOf(planned, planned.days[0]!)?.name).toBe('Gîte');
    const chosen = updateDay(planned, 1, { nightPlaceId: hotel.id });
    expect(nightOf(chosen, chosen.days[0]!)?.name).toBe('Hôtel');
    expect(nightOf(planned, planned.days[1]!)).toBeUndefined();
  });

  it('retire un lieu partout où il est référencé', () => {
    const base = addHikeStop(addPlaceStop(addPlace(trip(), gite), 2, hotel), 1, hike(1, 0));
    const stopId = base.days[0]!.stops[0]!.id;
    const withRefs = updateDay(
      setStopPlaces(base, stopId, {
        departure: null,
        stay: { name: 'Séjour', location: place.location },
      }),
      1,
      { nightPlaceId: hotel.id },
    );
    const removed = removePlace(withRefs, hotel.id);
    expect(removed.days[1]!.stops).toEqual([]);
    expect(removed.days[0]!.nightPlaceId).toBeUndefined();
    const stayId = withRefs.places.find(({ name }) => name === 'Séjour')!.id;
    const noStay = removePlace(withRefs, stayId);
    expect(noStay.days[0]!.stops[0]).not.toMatchObject({ stayPlaceId: stayId });
  });

  it('enregistre la durée d’une pause', () => {
    const planned = addPlaceStop(trip(), 1, parking);
    const stopId = planned.days[0]!.stops[0]!.id;
    expect(setStopDuration(planned, stopId, 45).days[0]!.stops[0]).toMatchObject({
      durationMin: 45,
    });
  });
});

describe('traversées', () => {
  const start = { lat: 45, lng: 6 };
  const end = { lat: 45.1, lng: 6.1 };
  const crossing = (): Hike => {
    const base = hike(10, 800);
    return {
      ...base,
      kind: 'point-to-point',
      start,
      end,
      stats: {
        ...base.stats,
        elevationLossM: 200,
        profile: [
          { distKm: 0, altM: 1000, ...start },
          { distKm: 10, altM: 1600, ...end },
        ],
      },
    };
  };

  it('convertit en aller-retour : distance doublée, chaque sens compté', () => {
    const base = addHikes(trip(), [crossing()]);
    const id = base.hikes[0]!.id;
    const pace = { flatKmh: 4, ascentMPerH: 300, descentMPerH: 500, breakFactor: 1 };
    const { kind, stats, end: arrival } = convertToOutAndBack(base, id, pace).hikes[0]!;
    expect(kind).toBe('out-and-back');
    expect(arrival).toEqual(start);
    expect(stats.distanceKm).toBe(20);
    expect(stats.elevationGainM).toBe(1000);
    expect(stats.elevationLossM).toBe(1000);
    expect(stats.profile.map((point) => point.distKm)).toEqual([0, 10, 20]);
    expect(stats.estimatedDurationMin).toBeGreaterThan(crossing().stats.estimatedDurationMin);
  });

  it('borne le profil à 500 points', () => {
    const long = crossing();
    long.stats.profile = Array.from({ length: 500 }, (_, i) => ({
      distKm: i / 10,
      altM: 1000,
      ...start,
    }));
    const base = addHikes(trip(), [long]);
    const pace = { flatKmh: 4, ascentMPerH: 300, descentMPerH: 500, breakFactor: 1 };
    const converted = convertToOutAndBack(base, base.hikes[0]!.id, pace);
    expect(converted.hikes[0]!.stats.profile.length).toBeLessThanOrEqual(500);
  });

  it('insère le retour au véhicule juste après la rando', () => {
    const base = addPlaceStop(addHikeStop(trip(), 1, crossing()), 1, {
      ...place,
      id: randomUUID(),
      type: 'lodging',
    });
    const [hikeStop, stayStop] = base.days[0]!.stops;
    const recovered = addRecoveryStop(base, hikeStop!.id);
    const stops = recovered.days[0]!.stops;
    expect(stops).toHaveLength(3);
    expect(stops[0]!.id).toBe(hikeStop!.id);
    expect(stops[2]!.id).toBe(stayStop!.id);
    expect(recovered.places.at(-1)).toMatchObject({ type: 'parking', location: start });
  });
});

describe('moveStop', () => {
  const a = hike(1, 0);
  const b = hike(2, 0);
  const c = hike(3, 0);
  const planned = addHikeStop(addHikeStop(addHikeStop(trip(), 1, a), 1, b), 2, c);
  const stopsOf = (t: Trip, index: number) =>
    t.days[index]!.stops.map((stop) => (stop.kind === 'hike' ? stop.hikeId : ''));
  const [stopA, stopB] = planned.days[0]!.stops;
  const stopC = planned.days[1]!.stops[0]!;

  it('réordonne dans un jour, vers le bas et vers le haut', () => {
    expect(stopsOf(moveStop(planned, stopA!.id, 1, 1), 0)).toEqual([b.id, a.id]);
    expect(stopsOf(moveStop(planned, stopB!.id, 1, 0), 0)).toEqual([b.id, a.id]);
  });

  it('déplace vers un autre jour, à la position voulue', () => {
    const moved = moveStop(planned, stopC.id, 1, 1);
    expect(stopsOf(moved, 0)).toEqual([a.id, c.id, b.id]);
    expect(stopsOf(moved, 1)).toEqual([]);
  });

  it('dépose à la fin d’un jour vide', () => {
    const moved = moveStop(planned, stopA!.id, 3, 0);
    expect(stopsOf(moved, 2)).toEqual([a.id]);
    expect(stopsOf(moved, 0)).toEqual([b.id]);
  });

  it('ignore une étape inconnue', () => {
    expect(moveStop(planned, 'inconnue', 1, 0)).toBe(planned);
  });
});

describe('changement de dates', () => {
  const planned = addHikeStop(trip(), 3, hike(5, 100));

  it('garde le programme quand le voyage est décalé', () => {
    const moved = changeDates(planned, '2027-08-01', '2027-08-03');
    expect(moved.days.map((day) => day.date)).toEqual(['2027-08-01', '2027-08-02', '2027-08-03']);
    expect(moved.days[2]!.stops).toHaveLength(1);
    expect(countDroppedDays(planned, '2027-08-01', '2027-08-03')).toBe(0);
  });

  it('garde les étapes à leur date quand le voyage s’allonge par le début', () => {
    const longer = changeDates(planned, '2027-06-30', '2027-07-03');
    expect(longer.days).toHaveLength(4);
    expect(longer.days[3]).toMatchObject({ date: '2027-07-03', index: 4 });
    expect(longer.days[3]!.stops).toHaveLength(1);
  });

  it('renvoie dans la bibliothèque les étapes des jours retirés', () => {
    expect(countDroppedDays(planned, '2027-07-01', '2027-07-02')).toBe(1);
    const shorter = changeDates(planned, '2027-07-01', '2027-07-02');
    expect(shorter.days).toHaveLength(2);
    expect(unplanned(shorter).hikes).toHaveLength(1);
    expect(unplanned(planned).hikes).toHaveLength(0);
  });
});

describe('schémas', () => {
  it('accepte un voyage valide', () => {
    expect(TripSchema.safeParse(trip()).success).toBe(true);
  });

  it('refuse une fin avant le début', () => {
    expect(TripSchema.safeParse(trip({ endDate: '2027-06-30' })).success).toBe(false);
    const result = NewTripSchema.safeParse({
      name: 'X',
      startDate: '2027-07-02',
      endDate: '2027-07-01',
      withDog: false,
    });
    expect(result.success).toBe(false);
  });

  it('refuse un slug qui sortirait du dossier des voyages', () => {
    expect(TripSchema.safeParse(trip({ slug: '../evil' })).success).toBe(false);
  });
});

describe('formats FR', () => {
  it('formate distances et dénivelés', () => {
    expect(formatKm(1234.5)).toBe('1 234,5 km'.replace(' ', ' '));
    expect(formatElevationGain(1200)).toBe('1 200 m D+');
  });

  it('formate les plages de dates', () => {
    expect(formatDateRange('2027-07-01', '2027-07-05')).toBe('1 juillet → 5 juillet 2027');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe(
      '30 décembre 2026 → 2 janvier 2027',
    );
    expect(formatDateRange('2027-07-01', '2027-07-01')).toBe('1 juillet 2027');
  });

  it('formate durées et jours', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(200)).toBe('3 h 20');
    expect(formatDay('2027-07-01')).toBe('jeudi 1 juillet');
  });

  it('calcule une heure de fin, au-delà de minuit compris', () => {
    expect(formatTimeAfter('08:30', 200)).toBe('11:50');
    expect(formatTimeAfter('20:00', 300)).toBe('01:00 (+1 j)');
  });

  it('accorde le nombre de jours', () => {
    expect(formatDayCount(1)).toBe('1 jour');
    expect(formatDayCount(5)).toBe('5 jours');
  });
});
