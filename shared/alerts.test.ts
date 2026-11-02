import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeAlerts } from './alerts';
import { DEFAULT_SETTINGS, type Hike, type ItineraryLeg, type Place, type Settings, type Trip } from './schema';
import { addHikes, addHikeStop, addPlaceStop, addRecoveryStop, convertToOutAndBack, generateDays, setStopPlaces, updateDay, updatePlace } from './trip';

const { pace } = DEFAULT_SETTINGS;
const here = { lat: 45, lng: 6 };
const there = { lat: 45.2, lng: 6.2 };

function hike(overrides: Partial<Hike> = {}): Hike {
  return {
    id: randomUUID(),
    name: 'Rando',
    gpxFile: 'gpx/x.gpx',
    kind: 'loop',
    stats: {
      distanceKm: 10,
      elevationGainM: 800,
      elevationLossM: 800,
      maxAltitudeM: null,
      minAltitudeM: null,
      estimatedDurationMin: 300,
      profile: [],
    },
    start: here,
    end: here,
    dogPolicy: 'allowed',
    ...overrides,
  };
}

function lodging(overrides: Partial<Place> = {}): Place {
  return {
    id: randomUUID(),
    type: 'lodging',
    name: 'Gîte',
    location: here,
    dogPolicy: 'allowed',
    ...overrides,
  };
}

const trip: Trip = {
  schemaVersion: 1,
  id: randomUUID(),
  slug: 'test',
  name: 'Test',
  startDate: '2027-07-01',
  endDate: '2027-07-02',
  travelers: { withDog: false },
  hikes: [],
  places: [],
  days: generateDays('2027-07-01', '2027-07-02'),
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const leg = (source: ItineraryLeg['source'], durationMin = 60): ItineraryLeg => ({
  from: here,
  to: there,
  distanceKm: 50,
  durationMin,
  geometry: { type: 'LineString', coordinates: [] },
  source,
  fromName: 'A',
  toName: 'B',
  dayIndex: 1,
  stopId: null,
  phase: 'end',
  trailToStay: false,
});

const codes = (t: Trip, legs: ItineraryLeg[] = [], settings: Settings = DEFAULT_SETTINGS) =>
  computeAlerts(t, legs, settings).map((alert) => alert.code);

const withThresholds = (thresholds: Settings['thresholds']) => ({
  ...DEFAULT_SETTINGS,
  thresholds,
});

/** Voyage d'un jour, sans A2. */
const oneDay: Trip = { ...trip, endDate: trip.startDate, days: generateDays(trip.startDate, trip.startDate) };

describe('A1 seuils', () => {
  const planned = addHikeStop(oneDay, 1, hike());

  it('ne se déclenche jamais sans seuil', () => {
    expect(codes(planned, [leg('ign', 600)])).toEqual([]);
  });

  it('couvre chaque seuil défini', () => {
    const over = (thresholds: Settings['thresholds']) =>
      codes(planned, [leg('ign')], withThresholds(thresholds));
    expect(over({ maxHikingHoursPerDay: 4 })).toEqual(['A1']);
    expect(over({ maxHikingHoursPerDay: 6 })).toEqual([]);
    expect(over({ maxDrivingHoursPerDay: 0.5 })).toEqual(['A1']);
    expect(over({ maxTotalActiveHoursPerDay: 5.5 })).toEqual(['A1']);
    expect(over({ maxElevationGainPerDay: 500 })).toEqual(['A1']);
    expect(over({ latestEndTime: '12:00' })).toEqual(['A1']);
    expect(over({ latestEndTime: '20:00' })).toEqual([]);
  });

  it('compte chaque seuil dépassé', () => {
    const settings = withThresholds({ maxHikingHoursPerDay: 1, maxElevationGainPerDay: 100 });
    expect(codes(planned, [], settings)).toEqual(['A1', 'A1']);
  });
});

describe('A2 nuits', () => {
  it('signale les jours sans nuit, sauf le dernier', () => {
    expect(codes(trip)).toEqual(['A2']);
  });

  it('accepte un séjour du jour comme nuit', () => {
    expect(codes(addPlaceStop(trip, 1, lodging()))).toEqual([]);
  });

  it('accepte le séjour d’une rando', () => {
    const base = addHikeStop(trip, 1, hike());
    const planned = setStopPlaces(base, base.days[0]!.stops[0]!.id, {
      departure: null,
      stay: { name: 'Hôtel', location: here },
    });
    expect(codes(planned)).toEqual([]);
  });
});

describe('A3 et A4 chiens', () => {
  const dog = { ...oneDay, travelers: { withDog: true } };

  it('ne dit rien sans chien', () => {
    expect(codes(addHikeStop(oneDay, 1, hike({ dogPolicy: 'forbidden' })))).toEqual([]);
  });

  it('passe en erreur pour une rando ou un hébergement interdit', () => {
    expect(codes(addHikeStop(dog, 1, hike({ dogPolicy: 'forbidden' })))).toEqual(['A3']);
    expect(codes(addPlaceStop(dog, 1, lodging({ dogPolicy: 'forbidden' })))).toEqual(['A3']);
  });

  it('demande confirmation si inconnu, y compris pour un repli', () => {
    expect(codes(addHikeStop(dog, 1, hike({ dogPolicy: 'unknown' })))).toEqual(['A4']);
    expect(codes(addPlaceStop(dog, 1, lodging({ dogPolicy: undefined })))).toEqual(['A4']);
    const backup = hike({ dogPolicy: 'unknown' });
    const withBackup = updateDay(addHikes(dog, [backup]), 1, { backupHikeIds: [backup.id] });
    expect(codes(withBackup)).toEqual(['A4']);
  });

  it('accepte la laisse', () => {
    expect(codes(addHikeStop(dog, 1, hike({ dogPolicy: 'leash' })))).toEqual([]);
  });

  it('ne signale une rando qu’une fois', () => {
    const repeated = hike({ dogPolicy: 'unknown' });
    const twice = addHikeStop({ ...trip, travelers: { withDog: true } }, 1, repeated);
    twice.days[1]!.stops.push({ id: randomUUID(), kind: 'hike', hikeId: repeated.id });
    expect(codes(twice).filter((code) => code === 'A4')).toHaveLength(1);
  });

  it('ne compte pas un parking comme hébergement', () => {
    expect(codes(addPlaceStop(dog, 1, lodging({ type: 'parking', dogPolicy: undefined })))).toEqual([]);
  });
});

describe('A5 traversées', () => {
  const crossing = hike({ kind: 'point-to-point', end: there });
  const planned = addHikeStop(oneDay, 1, crossing);

  it('se déclenche sur une traversée', () => {
    expect(codes(planned)).toEqual(['A5']);
    const alert = computeAlerts(planned, [], DEFAULT_SETTINGS)[0];
    expect(alert).toMatchObject({ hikeId: crossing.id, stopId: planned.days[0]!.stops[0]!.id });
  });

  it('disparaît après conversion en aller-retour', () => {
    expect(codes(convertToOutAndBack(planned, crossing.id, pace))).toEqual([]);
  });

  it('disparaît après ajout du trajet de récupération', () => {
    expect(codes(addRecoveryStop(planned, planned.days[0]!.stops[0]!.id))).toEqual([]);
  });
});

describe('A9 coucher du soleil', () => {
  const winter = {
    ...oneDay,
    startDate: '2026-12-12',
    endDate: '2026-12-12',
    days: generateDays('2026-12-12', '2026-12-12'),
  };
  const long = hike();
  long.stats = { ...long.stats, estimatedDurationMin: 600 };

  it('se déclenche quand une rando finit à la nuit, en décembre', () => {
    const alerts = computeAlerts(addHikeStop(winter, 1, long), [], DEFAULT_SETTINGS);
    expect(alerts.map(({ code }) => code)).toEqual(['A9']);
    expect(alerts[0]?.message).toMatch(/fin ≈ 18:30, coucher du soleil à 1[67]:\d\d/);
  });

  it('ne dit rien pour la même rando en juillet', () => {
    expect(codes(addHikeStop(oneDay, 1, long))).toEqual([]);
  });
});

describe('A6 à A8', () => {
  it('A6 : rando dans aucun jour', () => {
    expect(codes(addHikes(oneDay, [hike()]))).toEqual(['A6']);
  });

  it('A6 : un repli est dans un jour', () => {
    const backup = hike();
    expect(codes(updateDay(addHikes(oneDay, [backup]), 1, { backupHikeIds: [backup.id] }))).toEqual([]);
  });

  it('A7 : trajet en repli ligne droite', () => {
    expect(codes(oneDay, [leg('straight-line-fallback')])).toEqual(['A7']);
    expect(codes(oneDay, [leg('ign')])).toEqual([]);
  });

  it('A8 : hébergement à réserver ou idée', () => {
    const stay = lodging({ bookingStatus: 'to-book' });
    const planned = addPlaceStop(oneDay, 1, stay);
    expect(codes(planned)).toEqual(['A8']);
    expect(codes(updatePlace(planned, stay.id, { bookingStatus: 'idea' }))).toEqual(['A8']);
    expect(codes(updatePlace(planned, stay.id, { bookingStatus: 'booked' }))).toEqual([]);
  });
});

it('trie erreurs, avertissements puis infos', () => {
  const planned = addHikes(
    addHikeStop({ ...oneDay, travelers: { withDog: true } }, 1, hike({ dogPolicy: 'forbidden' })),
    [hike()],
  );
  expect(computeAlerts(planned, [leg('straight-line-fallback')], DEFAULT_SETTINGS).map((a) => a.level)).toEqual([
    'error',
    'warning',
    'info',
  ]);
});
