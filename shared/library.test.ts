import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { filterLibraryHikes, NO_FILTERS, paceComparison, suggestPace } from './library';
import { DEFAULT_SETTINGS, type LibraryHike, type Outing } from './schema';

const { pace } = DEFAULT_SETTINGS;

const outing = (durationMin?: number): Outing => ({
  id: randomUUID(),
  date: '2026-07-01',
  durationMin,
});

function hike(overrides: Partial<LibraryHike> = {}): LibraryHike {
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
    start: { lat: 45, lng: 6 },
    end: { lat: 45, lng: 6 },
    dogPolicy: 'allowed',
    gpxHash: randomUUID(),
    outings: [],
    createdAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('filterLibraryHikes', () => {
  const names = (hikes: LibraryHike[], filters: Partial<typeof NO_FILTERS>) =>
    filterLibraryHikes(hikes, { ...NO_FILTERS, ...filters }).map(({ name }) => name);

  it('cherche dans le nom et les tags, sans accents ni casse', () => {
    const hikes = [hike({ name: 'Lac des Écrins' }), hike({ name: 'Col', tags: ['Été'] })];
    expect(names(hikes, { query: 'ecrins' })).toEqual(['Lac des Écrins']);
    expect(names(hikes, { query: 'ete' })).toEqual(['Col']);
  });

  it('sépare les randos faites des autres', () => {
    const hikes = [hike({ name: 'Faite', outings: [outing()] }), hike({ name: 'À faire' })];
    expect(names(hikes, { status: 'done' })).toEqual(['Faite']);
    expect(names(hikes, { status: 'todo' })).toEqual(['À faire']);
  });

  it('écarte seulement les randos interdites aux chiens', () => {
    const hikes = [
      hike({ name: 'Interdite', dogPolicy: 'forbidden' }),
      hike({ name: 'À confirmer', dogPolicy: 'unknown' }),
    ];
    expect(names(hikes, { withDog: true })).toEqual(['À confirmer']);
  });

  it('filtre par note, distance et dénivelé', () => {
    const big = hike({ name: 'Grande', rating: 5 });
    const small = hike({
      name: 'Petite',
      stats: { ...big.stats, distanceKm: 4, elevationGainM: 100 },
    });
    expect(names([big, small], { minRating: 4 })).toEqual(['Grande']);
    expect(names([big, small], { maxKm: 5 })).toEqual(['Petite']);
    expect(names([big, small], { maxElevationGainM: 200 })).toEqual(['Petite']);
  });
});

describe('paceComparison', () => {
  it('ignore les sorties sans durée, et prend la médiane', () => {
    expect(paceComparison([hike({ outings: [outing()] })])).toBeNull();
    const hikes = [hike({ outings: [outing(150), outing(270), outing(900), outing()] })];
    expect(paceComparison(hikes)).toEqual({ ratio: 0.9, outingCount: 3 });
  });
});

describe('suggestPace', () => {
  it('ne propose rien sous 3 sorties ou sans écart net', () => {
    expect(suggestPace(pace, null)).toBeNull();
    expect(suggestPace(pace, { ratio: 0.8, outingCount: 2 })).toBeNull();
    expect(suggestPace(pace, { ratio: 0.99, outingCount: 5 })).toBeNull();
  });

  it('ajuste le multiplicateur à partir du rythme actuel', () => {
    expect(suggestPace({ ...pace, breakFactor: 1.2 }, { ratio: 0.9, outingCount: 3 })).toEqual({
      ...pace,
      breakFactor: 1.08,
    });
  });
});
