import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emptyHistory, HISTORY_LIMIT, record, redo, undo } from './history';
import { buildProfile, nearestPointIndex } from './profile';
import { DEFAULT_SETTINGS, type Hike, type ItineraryLeg, type Trip } from './schema';
import { dayTotals, loadRatio } from './totals';
import { addHikeStop, generateDays, updateDay } from './trip';

function hike(alts: number[], stepKm = 1): Hike {
  return {
    id: randomUUID(),
    name: 'Rando',
    gpxFile: 'gpx/x.gpx',
    kind: 'loop',
    stats: {
      distanceKm: (alts.length - 1) * stepKm,
      elevationGainM: 500,
      elevationLossM: 0,
      maxAltitudeM: null,
      minAltitudeM: null,
      estimatedDurationMin: 120,
      profile: alts.map((altM, i) => ({ distKm: i * stepKm, altM, lat: 45 + i, lng: 6 })),
    },
    start: { lat: 45, lng: 6 },
    end: { lat: 45, lng: 6 },
    dogPolicy: 'unknown',
  };
}

const baseTrip = {
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
} satisfies Trip;

const leg = (dayIndex: number, distanceKm: number, durationMin: number): ItineraryLeg => ({
  from: { lat: 0, lng: 0 },
  to: { lat: 0, lng: 0 },
  distanceKm,
  durationMin,
  geometry: { type: 'LineString', coordinates: [] },
  source: 'ign',
  fromName: 'A',
  toName: 'B',
  dayIndex,
  stopId: null,
  phase: 'end',
  trailToStay: false,
});

describe('dayTotals', () => {
  it('additionne marche, route et pauses du seul jour concerné', () => {
    const backup = hike([1000, 1100]);
    const trip = updateDay(addHikeStop({ ...baseTrip, hikes: [backup] }, 1, hike([1000, 1100])), 1, {
      backupHikeIds: [backup.id],
    });
    trip.days[0]!.stops.push({
      id: randomUUID(),
      kind: 'place',
      placeId: randomUUID(),
      durationMin: 45,
    });

    const totals = dayTotals(trip, trip.days[0]!, [leg(1, 80, 75), leg(2, 500, 300)], '08:30');

    expect(totals).toMatchObject({
      hikingKm: 1,
      elevationGainM: 500,
      hikingMin: 120,
      drivingKm: 80,
      drivingMin: 75,
      placesMin: 45,
      activeMin: 240,
      estimatedEndTime: '12:30',
    });
  });

  it('ne compte pas de D+ pour une rando sans altitude', () => {
    const noAltitude = hike([1000, 1100]);
    noAltitude.stats.elevationGainM = null;
    const trip = addHikeStop(baseTrip, 1, noAltitude);
    expect(
      dayTotals(trip, trip.days[0]!, [], DEFAULT_SETTINGS.dayStartTime).elevationGainM,
    ).toBe(0);
  });
});

describe('loadRatio', () => {
  it('ne donne rien tant que le seuil n’est pas défini', () => {
    expect(loadRatio(300, undefined)).toBeNull();
    expect(loadRatio(300, 5)).toBe(1);
  });
});

describe('profil', () => {
  it('calcule la pente locale', () => {
    const [first, second] = buildProfile([hike([1000, 1100])]);
    expect(first?.slopePct).toBeNull();
    expect(second?.slopePct).toBeCloseTo(10);
  });

  it('enchaîne plusieurs randos sur la distance', () => {
    const points = buildProfile([hike([1000, 1100]), hike([900, 950])]);
    expect(points.map((point) => point.distKm)).toEqual([0, 1, 1, 2]);
    expect(points[2]?.slopePct).toBeNull();
  });

  it('trouve le point le plus proche', () => {
    const points = buildProfile([hike([1000, 1100, 1200])]);
    expect(nearestPointIndex(points, { lat: 46.1, lng: 6 })).toBe(1);
    expect(nearestPointIndex([], { lat: 0, lng: 0 })).toBe(-1);
  });
});

describe('historique', () => {
  it('annule puis rétablit dans l’ordre', () => {
    const afterTwo = record(record(emptyHistory<string>(), 'a'), 'b');
    const undone = undo(afterTwo, 'c')!;
    expect(undone.value).toBe('b');
    const redone = redo(undone.history, 'b')!;
    expect(redone.value).toBe('c');
    expect(redone.history.past).toEqual(['a', 'b']);
  });

  it('ne fait rien sans historique', () => {
    expect(undo(emptyHistory<string>(), 'a')).toBeNull();
    expect(redo(emptyHistory<string>(), 'a')).toBeNull();
  });

  it('efface le rétablir après une nouvelle modification', () => {
    const undone = undo(record(emptyHistory<string>(), 'a'), 'b')!;
    expect(record(undone.history, 'a').future).toEqual([]);
  });

  it('garde au moins 20 niveaux, jusqu’à la limite', () => {
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(20);
    let history = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) history = record(history, i);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
  });
});
