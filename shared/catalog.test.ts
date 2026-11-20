import { describe, expect, it } from 'vitest';
import {
  CATALOG_HYSTERESIS_M,
  cellScores,
  chainSegments,
  decimate,
  densify,
  difficulty,
  dogAccess,
  popularity,
  provisionalTrailScore,
  surfaceShares,
  trailDogPolicy,
  trailUncertainties,
  waySurface,
  type CellFeatures,
} from './catalog';
import { computeHikeStats, distanceKm } from './gpx';
import { DEFAULT_SETTINGS } from './schema';

const p = (lng: number, lat: number) => ({ lat, lng });

describe('chainSegments', () => {
  it('enchaîne des tronçons dans le désordre et retourne ceux à l’envers', () => {
    const a = [p(0, 0), p(0.001, 0)];
    const b = [p(0.002, 0), p(0.001, 0)]; // à l'envers
    const c = [p(0.002, 0), p(0.003, 0)];
    const result = chainSegments([a, c, b]);
    expect(result.points.map((pt) => pt.lng)).toEqual([0, 0.001, 0.002, 0.003]);
    expect(result.gaps).toBe(0);
    expect(result.gapKm).toBe(0);
  });

  it('compte les trous entre tronçons disjoints', () => {
    const result = chainSegments([
      [p(0, 0), p(0.001, 0)],
      [p(0.01, 0), p(0.011, 0)],
    ]);
    expect(result.gaps).toBe(1);
    expect(result.gapKm).toBeCloseTo(distanceKm(p(0.001, 0), p(0.01, 0)), 5);
    expect(result.points).toHaveLength(4);
  });

  it('ignore les tronçons dégénérés', () => {
    expect(chainSegments([[p(0, 0)]])).toEqual({ points: [], gapKm: 0, gaps: 0 });
  });
});

describe('densify / decimate', () => {
  it('aucun intervalle ne dépasse le pas', () => {
    const points = densify([p(0, 49), p(0.01, 49)], 0.1);
    for (let i = 1; i < points.length; i++) {
      expect(distanceKm(points[i - 1]!, points[i]!)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    expect(points.at(-1)).toEqual(p(0.01, 49));
  });

  it('decimate garde le dernier point', () => {
    expect(decimate([1, 2, 3, 4, 5], 3)).toEqual([1, 4, 5]);
  });
});

describe('waySurface', () => {
  it('surface explicite prioritaire', () => {
    expect(waySurface({ highway: 'residential', surface: 'gravel' })).toBe('unpaved');
    expect(waySurface({ highway: 'path', surface: 'asphalt' })).toBe('paved');
  });
  it('déduit du type de voie', () => {
    expect(waySurface({ highway: 'tertiary' })).toBe('paved');
    expect(waySurface({ highway: 'path' })).toBe('unpaved');
    expect(waySurface({ highway: 'track', tracktype: 'grade3' })).toBe('unpaved');
    expect(waySurface({ highway: 'track', tracktype: 'grade1' })).toBe('paved');
  });
  it('reste inconnu sans indice', () => {
    expect(waySurface({ highway: 'track' })).toBe('unknown');
    expect(waySurface({ highway: 'footway' })).toBe('unknown');
  });
});

describe('surfaceShares', () => {
  it('pondère par la longueur', () => {
    const shares = surfaceShares([
      { lengthKm: 3, surface: 'paved' },
      { lengthKm: 1, surface: 'unpaved' },
    ]);
    expect(shares).toEqual({ paved: 0.75, unpaved: 0.25, unknown: 0 });
  });
  it('tout inconnu sans longueur', () => {
    expect(surfaceShares([])).toEqual({ paved: 0, unpaved: 0, unknown: 1 });
  });
});

describe('chiens', () => {
  it('lit le tag dog', () => {
    expect(dogAccess('yes')).toBe('allowed');
    expect(dogAccess('leashed')).toBe('leashed');
    expect(dogAccess('no')).toBe('forbidden');
    expect(dogAccess(undefined)).toBe('unknown');
  });
  it('une interdiction sur un tronçon l’emporte', () => {
    expect(trailDogPolicy('allowed', ['allowed', 'forbidden'])).toBe('forbidden');
  });
  it('le silence d’OSM reste inconnu', () => {
    expect(trailDogPolicy('unknown', ['allowed', 'unknown'])).toBe('unknown');
    expect(trailDogPolicy('unknown', [])).toBe('unknown');
  });
  it('autorisé seulement si tous les tronçons le disent', () => {
    expect(trailDogPolicy('unknown', ['allowed', 'allowed'])).toBe('allowed');
    expect(trailDogPolicy('unknown', ['allowed', 'leashed'])).toBe('leashed');
  });
});

describe('cellScores', () => {
  const base: CellFeatures = {
    forestShare: 0,
    builtShare: 0,
    hasWater: false,
    hasCoastOrCliff: false,
    viewpoints: 0,
    elevationStdM: null,
    ringsToMajorRoad: 0,
    heritageWeight: 0,
  };

  it('forêt, eau, relief et isolement donnent des scores élevés', () => {
    const s = cellScores({
      ...base,
      forestShare: 1,
      hasWater: true,
      elevationStdM: 40,
      viewpoints: 2,
      ringsToMajorRoad: 6,
    });
    expect(s.scenic).toBeCloseTo(0.85, 5);
    expect(s.isolation).toBe(1);
    expect(s.roughness).toBe(1);
  });

  it('le bâti fait chuter paysage et isolement', () => {
    const s = cellScores({ ...base, forestShare: 0.4, builtShare: 1, ringsToMajorRoad: 4 });
    expect(s.scenic).toBe(0);
    expect(s.isolation).toBe(0);
  });

  it('tous les scores restent dans [0, 1]', () => {
    const s = cellScores({ ...base, heritageWeight: 10 });
    expect(s.heritage).toBe(1);
    expect(s.scenic).toBe(0);
  });
});

describe('popularity', () => {
  it('Wikidata, Wikipédia et protection s’additionnent', () => {
    expect(popularity({ wikidata: 'Q1', wikipedia: 'fr:X', heritage: '2' })).toBe(1);
    expect(popularity({})).toBe(0);
  });
});

describe('difficulty', () => {
  it('classe selon durée et D+', () => {
    expect(difficulty(120, 150)).toBe('easy');
    expect(difficulty(200, 400)).toBe('moderate');
    expect(difficulty(120, 900)).toBe('hard');
    expect(difficulty(400, null)).toBe('hard');
  });
});

describe('trailUncertainties', () => {
  it('liste ce qui n’est pas connu', () => {
    expect(
      trailUncertainties({
        dogPolicy: 'unknown',
        inReserve: true,
        surfaceUnknownShare: 0.5,
        gapKm: 1,
        restrictedWays: 2,
        gainM: null,
      }),
    ).toEqual([
      'DOG_ACCESS_UNKNOWN',
      'RESERVE_REGULATION_CHECK',
      'OSM_SURFACE_INCOMPLETE',
      'OSM_GEOMETRY_INCOMPLETE',
      'ACCESS_RESTRICTED',
      'ELEVATION_MISSING',
    ]);
  });
  it('rien à signaler pour une boucle bien renseignée', () => {
    expect(
      trailUncertainties({
        dogPolicy: 'allowed',
        inReserve: false,
        surfaceUnknownShare: 0.1,
        gapKm: 0,
        restrictedWays: 0,
        gainM: 120,
      }),
    ).toEqual([]);
  });
});

describe('provisionalTrailScore', () => {
  const trail = { scenicAvg: 0.8, isolationAvg: 0.6, heritageAvg: 0.2, pavedRatio: 0, gapKm: 0 };
  it('moyenne pondérée par l’intention', () => {
    expect(provisionalTrailScore(trail)).toBeCloseTo((0.5 * 0.8 + 0.5 * 0.6 + 0.3 * 0.2) / 1.3, 5);
  });
  it('le bitume et un tracé troué pénalisent', () => {
    const plain = provisionalTrailScore(trail);
    expect(provisionalTrailScore({ ...trail, pavedRatio: 0.5 })).toBeCloseTo(plain - 0.2, 5);
    expect(provisionalTrailScore({ ...trail, gapKm: 1 })).toBeCloseTo(plain - 0.2, 5);
  });
});

describe('CATALOG_HYSTERESIS_M', () => {
  it('conserve les petites bosses de plaine (3 m) ignorées par le seuil de 5 m', () => {
    const altitudes = [100, 103.5, 100, 103.5, 100];
    const points = altitudes.map((altM, i) => ({ lat: 49 + i * 0.002, lng: 1, altM }));
    const atDefault = computeHikeStats(points, DEFAULT_SETTINGS.pace);
    const atCatalog = computeHikeStats(points, DEFAULT_SETTINGS.pace, CATALOG_HYSTERESIS_M);
    expect(atDefault.elevationGainM).toBe(0);
    expect(atCatalog.elevationGainM).toBe(7);
  });
});
