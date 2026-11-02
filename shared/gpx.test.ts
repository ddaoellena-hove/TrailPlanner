import { describe, expect, it } from 'vitest';
import {
  computeHikeStats,
  detectKind,
  elevationChange,
  ELEVATION_HYSTERESIS_M,
  estimateDurationMin,
  smoothAltitudes,
  withPace,
  type TrackPoint,
} from './gpx';
import { DEFAULT_SETTINGS, type Trip } from './schema';

const { pace } = DEFAULT_SETTINGS;

/** Trace vers le nord : 0,001° de latitude ≈ 111 m. */
function northbound(altitudes: (number | null)[]): TrackPoint[] {
  return altitudes.map((altM, i) => ({ lat: 45 + i * 0.001, lng: 6, altM }));
}

describe('DIN 33466', () => {
  it('donne ≈ 5 h 30 sur la boucle de référence de la SPEC', () => {
    expect(estimateDurationMin(10, 800, 800, pace)).toBeCloseTo(331, 0);
  });

  it('applique le facteur de pauses', () => {
    const slower = { ...pace, breakFactor: 1.5 };
    expect(estimateDurationMin(10, 800, 800, slower)).toBeCloseTo(331 * 1.5, 0);
  });
});

describe('withPace', () => {
  it('recalcule la durée de chaque rando', () => {
    const stats = computeHikeStats(northbound([1000, 1020, 1040]), pace);
    const trip = { hikes: [{ stats }] } as Trip;
    const slower = withPace(trip, { ...pace, flatKmh: 1, breakFactor: 2 });
    expect(slower.hikes[0]!.stats.estimatedDurationMin).toBeGreaterThan(
      stats.estimatedDurationMin * 2,
    );
  });
});

describe('dénivelé', () => {
  it('garde un seuil d’hystérésis de 5 m', () => {
    expect(ELEVATION_HYSTERESIS_M).toBe(5);
  });

  it('ignore le bruit sous le seuil', () => {
    expect(elevationChange([100, 103, 99, 102, 100])).toEqual({ gainM: 0, lossM: 0 });
  });

  it('cumule montées et descentes au-dessus du seuil', () => {
    expect(elevationChange([100, 110, 120, 105])).toEqual({ gainM: 20, lossM: 15 });
  });

  it('lisse sur la distance', () => {
    expect(smoothAltitudes([100, 130, 100], [0, 0.02, 0.04])).toEqual([115, 110, 115]);
  });
});

describe('type de rando', () => {
  const out = northbound(Array.from({ length: 20 }, () => 1000));

  it('reconnaît une traversée', () => {
    expect(detectKind(out)).toBe('point-to-point');
  });

  it('reconnaît un aller-retour', () => {
    expect(detectKind([...out, ...out.toReversed()])).toBe('out-and-back');
  });

  it('reconnaît une boucle', () => {
    const east = out.map((p) => ({ ...p, lng: 6.02 }));
    const top = { lat: out.at(-1)!.lat, lng: 6.01, altM: 1000 };
    const bottom = { lat: 45, lng: 6.01, altM: 1000 };
    expect(detectKind([...out, top, ...east.toReversed(), bottom, out[0]!])).toBe('loop');
  });
});

describe('computeHikeStats', () => {
  it('calcule distance, altitudes et profil', () => {
    const stats = computeHikeStats(northbound([1000, 1020, 1040, 1060, 1080]), pace);
    expect(stats.distanceKm).toBeCloseTo(0.44, 1);
    expect(stats.elevationGainM).toBe(80);
    expect(stats.maxAltitudeM).toBe(1080);
    expect(stats.profile).toHaveLength(5);
  });

  it('met les altitudes à null si le GPX n’en a pas', () => {
    const stats = computeHikeStats(northbound([null, null, null]), pace);
    expect(stats.elevationGainM).toBeNull();
    expect(stats.maxAltitudeM).toBeNull();
    expect(stats.profile[0]?.altM).toBeNull();
    expect(stats.estimatedDurationMin).toBeGreaterThan(0);
  });

  it('limite le profil à 500 points, arrivée comprise', () => {
    const points = northbound(Array.from({ length: 1200 }, () => 1000));
    const { profile, distanceKm } = computeHikeStats(points, pace);
    expect(profile).toHaveLength(500);
    expect(profile.at(-1)?.distKm).toBeCloseTo(distanceKm, 1);
  });
});
