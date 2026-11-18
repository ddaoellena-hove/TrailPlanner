import { describe, expect, it } from 'vitest';
import { computeHikeStats } from './gpx';
import {
  activitySource,
  activityTitle,
  findDuplicate,
  isProbableDuplicate,
  RECORDED_HYSTERESIS_M,
  sortActivities,
  suggestRoutes,
  type RecordedPoint,
  recordedMetrics,
  type RecordedTrack,
} from './activity';
import { northboundPoints } from './recorded-gpx.fixture';
import { type Activity, DEFAULT_SETTINGS } from './schema';

function track(segments: ReturnType<typeof northboundPoints>[], creator = 'AllTrails.com'): RecordedTrack {
  return {
    name: 'Sortie',
    creator,
    segments: segments.map((points) =>
      points.map(
        ({ lat, lng, ele, time }): RecordedPoint => ({
          lat,
          lng,
          altM: ele ?? null,
          time: time ?? null,
        }),
      ),
    ),
  };
}

function comparable(points: ReturnType<typeof northboundPoints>, fingerprint = 'a'.repeat(64)) {
  const metrics = recordedMetrics(track([points]));
  return { ...metrics, fingerprint };
}

function stored(points: ReturnType<typeof northboundPoints>, fingerprint: string): Activity {
  return {
    ...comparable(points, fingerprint),
    id: crypto.randomUUID(),
  } as unknown as Activity;
}

describe('recordedMetrics', () => {
  it('calcule distance, durée écoulée et dénivelé d’un segment', () => {
    const metrics = recordedMetrics(track([northboundPoints(11)]));
    expect(metrics.distanceMeters).toBeGreaterThan(1100);
    expect(metrics.distanceMeters).toBeLessThan(1125);
    expect(metrics.durationSeconds).toBe(600);
    expect(metrics.elevationGainMeters).toBeGreaterThan(80);
    expect(metrics.elevationLossMeters).toBe(0);
    expect(metrics.activityDate).toBe('2026-07-01T06:00:00Z');
    expect(metrics.endedAt).toBe('2026-07-01T06:10:00Z');
    expect(metrics.pointCount).toBe(11);
    expect(metrics.segmentCount).toBe(1);
  });

  it('ne compte pas l’écart entre deux segments comme distance', () => {
    const first = northboundPoints(6);
    // Reprise 5 km plus au nord, une heure plus tard.
    const second = northboundPoints(6, { lat: 45.05, start: '2026-07-01T07:00:00Z' });
    const metrics = recordedMetrics(track([first, second]));
    const alone = recordedMetrics(track([first])).distanceMeters;
    expect(metrics.distanceMeters).toBe(alone * 2);
    expect(metrics.segmentCount).toBe(2);
    // Durée écoulée, pause comprise : ce n'est pas un temps en mouvement.
    expect(metrics.durationSeconds).toBe(65 * 60);
    expect(metrics.profile.at(-1)!.distKm).toBeCloseTo(metrics.distanceMeters / 1000, 1);
  });

  it('garde l’heure telle qu’écrite, fuseau compris', () => {
    const points = northboundPoints(3).map((p, i) => ({
      ...p,
      time: `2026-07-01T08:0${i}:00.250+02:00`,
    }));
    expect(recordedMetrics(track([points])).activityDate).toBe('2026-07-01T08:00:00.250+02:00');
  });

  it('laisse inconnus durée et date sans heures, et le dénivelé sans altitude', () => {
    const points = northboundPoints(5).map(({ lat, lng }) => ({ lat, lng }));
    const metrics = recordedMetrics(track([points]));
    expect(metrics.activityDate).toBeNull();
    expect(metrics.durationSeconds).toBeNull();
    expect(metrics.elevationGainMeters).toBeNull();
    expect(metrics.elevationLossMeters).toBeNull();
    expect(metrics.profile.every(({ altM }) => altM === null)).toBe(true);
  });

  it('ne donne pas de durée si une heure manque ou si elles reculent', () => {
    const missing = northboundPoints(4).map((p, i) => (i === 2 ? { ...p, time: undefined } : p));
    expect(recordedMetrics(track([missing])).durationSeconds).toBeNull();
    expect(recordedMetrics(track([missing])).activityDate).toBe('2026-07-01T06:00:00Z');
    const backwards = northboundPoints(4).toReversed().map((p, i) => ({ ...northboundPoints(4)[i]!, time: p.time }));
    expect(recordedMetrics(track([backwards])).durationSeconds).toBeNull();
  });

  it('garde un seuil de 2 m pour les traces enregistrées', () => {
    expect(RECORDED_HYSTERESIS_M).toBe(2);
  });

  it('compte les petites bosses de 3 m qu’une rando prévue ignorerait', () => {
    // Points espacés de ~111 m : la moyenne glissante sur 50 m ne les touche pas.
    const bumps = northboundPoints(9, { climbM: 0 }).map((p, i) => ({
      ...p,
      ele: i % 2 === 0 ? 100 : 103,
    }));
    const metrics = recordedMetrics(track([bumps]));
    expect(metrics.elevationGainMeters).toBe(12);
    expect(metrics.elevationLossMeters).toBe(12);
    const asRoute = computeHikeStats(
      bumps.map(({ lat, lng, ele }) => ({ lat, lng, altM: ele })),
      DEFAULT_SETTINGS.pace,
    );
    expect(asRoute.elevationGainM).toBe(0);
  });

  it('échantillonne le profil à 500 points au plus', () => {
    const metrics = recordedMetrics(track([northboundPoints(1200, { climbM: 0 })]));
    expect(metrics.profile).toHaveLength(500);
    expect(metrics.pointCount).toBe(1200);
  });
});

describe('provenance et titre', () => {
  it('ne déclare AllTrails que si le fichier le dit', () => {
    expect(activitySource(track([northboundPoints(2)]))).toBe('alltrails');
    expect(activitySource(track([northboundPoints(2)], 'Garmin Connect'))).toBe('gpx');
    expect(activitySource({ name: null, creator: null, segments: [] })).toBe('gpx');
  });

  it('prend le nom du GPX, sinon celui du fichier', () => {
    expect(activityTitle({ name: ' Col ', creator: null, segments: [] }, 'x.gpx')).toBe('Col');
    expect(activityTitle({ name: null, creator: null, segments: [] }, 'Lac.GPX')).toBe('Lac');
  });
});

describe('doublons', () => {
  const reference = northboundPoints(40);

  it('reconnaît le même fichier comme doublon exact', () => {
    const existing = stored(reference, 'b'.repeat(64));
    expect(findDuplicate(comparable(reference, 'b'.repeat(64)), [existing])).toEqual({
      status: 'exact',
      activityId: existing.id,
    });
  });

  it('signale la même sortie, enregistrée autrement, comme doublon probable', () => {
    // Autre export : départ 2 min plus tard, points décalés de ~20 m.
    const other = northboundPoints(40, { start: '2026-07-01T06:02:00Z', lng: 6.00025 });
    const existing = stored(reference, 'b'.repeat(64));
    expect(isProbableDuplicate(comparable(other), existing)).toBe(true);
    expect(findDuplicate(comparable(other), [existing]).status).toBe('probable');
  });

  it('distingue la même rando refaite un autre jour', () => {
    const later = northboundPoints(40, { start: '2026-07-08T06:00:00Z' });
    expect(isProbableDuplicate(comparable(later), stored(reference, 'b'.repeat(64)))).toBe(false);
  });

  it('ne fusionne pas des traces simplement voisines', () => {
    // Parallèle à ~400 m, mêmes heures et même distance.
    const nearby = northboundPoints(40, { lng: 6.005 });
    expect(isProbableDuplicate(comparable(nearby), stored(reference, 'b'.repeat(64)))).toBe(false);
  });

  it('écarte une distance trop différente', () => {
    const shorter = northboundPoints(30);
    expect(isProbableDuplicate(comparable(shorter), stored(reference, 'b'.repeat(64)))).toBe(false);
  });

  it('se fie à la géométrie quand une heure manque', () => {
    const untimed = reference.map(({ lat, lng, ele }) => ({ lat, lng, ele }));
    expect(isProbableDuplicate(comparable(untimed), stored(reference, 'b'.repeat(64)))).toBe(true);
  });
});

describe('sortActivities', () => {
  it('met les plus récentes d’abord, et celles sans heure à la fin', () => {
    const at = (id: string, activityDate: string | null, importedAt: string) => ({
      id,
      activityDate,
      importedAt,
    });
    const sorted = sortActivities([
      at('ancienne', '2026-07-01T06:00:00Z', '2026-11-01T00:00:00.000Z'),
      at('sans-heure-1', null, '2026-11-02T00:00:00.000Z'),
      at('récente', '2026-11-14T12:37:58Z', '2026-11-14T00:00:00.000Z'),
      at('sans-heure-2', null, '2026-11-03T00:00:00.000Z'),
    ]);
    expect(sorted.map(({ id }) => id)).toEqual([
      'récente',
      'ancienne',
      'sans-heure-2',
      'sans-heure-1',
    ]);
  });
});

describe('suggestRoutes', () => {
  const recordedTrack = comparable(northboundPoints(40));
  const route = (id: string, points: ReturnType<typeof northboundPoints>) => ({
    id,
    stats: { profile: comparable(points).profile } as never,
  });

  it('propose la rando prévue que la sortie a suivie, pas une voisine', () => {
    const suggestions = suggestRoutes({ ...recordedTrack, linkedRouteId: null }, [
      route('suivie', northboundPoints(40, { lng: 6.0002 })),
      route('voisine', northboundPoints(40, { lng: 6.005 })),
    ]);
    expect(suggestions.map(({ routeId }) => routeId)).toEqual(['suivie']);
    expect(suggestions[0]!.share).toBeGreaterThanOrEqual(0.9);
  });

  it('ne propose pas une rando dont la sortie n’a fait qu’un bout', () => {
    // Itinéraire trois fois plus long : la sortie n'en couvre qu'un tiers.
    const suggestions = suggestRoutes({ ...recordedTrack, linkedRouteId: null }, [
      route('longue', northboundPoints(120)),
    ]);
    expect(suggestions).toEqual([]);
  });

  it('ne repropose pas la rando déjà liée', () => {
    expect(
      suggestRoutes({ ...recordedTrack, linkedRouteId: 'suivie' }, [
        route('suivie', northboundPoints(40)),
      ]),
    ).toEqual([]);
  });
});
