import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeTrip } from './assistant-context';
import { applyOps } from './assistant-ops';
import { estimateLegs, planImpact } from './plan-impact';
import { DEFAULT_SETTINGS, type Hike, type Place, type Trip } from './schema';
import { addHikes, addHikeStop, generateDays } from './trip';

const here = { lat: 45, lng: 6 };

function hike(name: string, minutes = 120): Hike {
  return {
    id: randomUUID(),
    name,
    gpxFile: 'gpx/x.gpx',
    kind: 'loop',
    stats: {
      distanceKm: 8,
      elevationGainM: 400,
      elevationLossM: 400,
      maxAltitudeM: 2000,
      minAltitudeM: 1000,
      estimatedDurationMin: minutes,
      profile: [{ distKm: 0, altM: 1000, ...here }],
    },
    start: here,
    end: here,
    dogPolicy: 'allowed',
  };
}

const hotel: Place = { id: randomUUID(), type: 'lodging', name: 'Hôtel', location: here };

const base: Trip = {
  schemaVersion: 1,
  id: randomUUID(),
  slug: 'test',
  name: 'Test',
  startDate: '2027-07-01',
  endDate: '2027-07-02',
  travelers: { withDog: false },
  hikes: [],
  places: [hotel],
  days: generateDays('2027-07-01', '2027-07-02'),
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const col = hike('Col');
const planned = addHikeStop(base, 1, col);
const stopId = planned.days[0]!.stops[0]!.id;

function applied(trip: Trip, ops: Parameters<typeof applyOps>[1]): Trip {
  const result = applyOps(trip, ops);
  if (!result.ok) throw new Error(result.error);
  return result.trip;
}

describe('applyOps', () => {
  it('déplace une étape et décrit le changement', () => {
    const result = applyOps(planned, [{ op: 'move_stop', stopId, dayIndex: 2, position: 0 }]);
    expect(result).toMatchObject({ ok: true, descriptions: ['Déplacer Col au J2'] });
    if (result.ok) expect(result.trip.days[1]!.stops).toHaveLength(1);
  });

  it('planifie une rando de la bibliothèque à la position voulue', () => {
    const lac = hike('Lac');
    const trip = applied(addHikes(planned, [lac]), [
      { op: 'plan_hike', hikeId: lac.id, dayIndex: 1, position: 0 },
    ]);
    expect(trip.days[0]!.stops[0]).toMatchObject({ hikeId: lac.id });
  });

  it('retire une étape', () => {
    const trip = applied(planned, [{ op: 'remove_stop', stopId }]);
    expect(trip.days[0]!.stops).toEqual([]);
  });

  it('règle et efface une heure de départ', () => {
    const timed = applied(planned, [{ op: 'set_start_time', stopId, startTime: '07:30' }]);
    expect(timed.days[0]!.stops[0]).toMatchObject({ startTime: '07:30' });
    const cleared = applied(timed, [{ op: 'set_start_time', stopId, startTime: null }]);
    expect(cleared.days[0]!.stops[0]).not.toMatchObject({ startTime: '07:30' });
  });

  it('choisit une nuit, un titre, un repli et une tâche', () => {
    const lac = hike('Lac');
    const trip = applied(addHikes(planned, [lac]), [
      { op: 'set_night', dayIndex: 1, placeId: hotel.id },
      { op: 'set_day_title', dayIndex: 1, title: 'Tour' },
      { op: 'add_backup', dayIndex: 1, hikeId: lac.id },
      { op: 'add_checklist_item', label: 'Frontale' },
    ]);
    expect(trip.days[0]).toMatchObject({
      nightPlaceId: hotel.id,
      title: 'Tour',
      backupHikeIds: [lac.id],
    });
    expect(trip.checklist?.[0]?.label).toBe('Frontale');
  });

  it('refuse tout identifiant absent du voyage', () => {
    const cases: Parameters<typeof applyOps>[1][] = [
      [{ op: 'remove_stop', stopId: 'inconnu' }],
      [{ op: 'plan_hike', hikeId: 'inconnue', dayIndex: 1, position: 0 }],
      [{ op: 'move_stop', stopId, dayIndex: 9, position: 0 }],
      [{ op: 'set_night', dayIndex: 1, placeId: 'inconnu' }],
    ];
    for (const ops of cases) expect(applyOps(planned, ops).ok).toBe(false);
  });

  it('refuse une heure sur une étape qui n’est pas une rando', () => {
    const withPlace = {
      ...planned,
      days: planned.days.map((day, index) =>
        index === 1
          ? { ...day, stops: [{ id: randomUUID(), kind: 'place' as const, placeId: hotel.id }] }
          : day,
      ),
    };
    const id = withPlace.days[1]!.stops[0]!.id;
    expect(applyOps(withPlace, [{ op: 'set_start_time', stopId: id, startTime: '09:00' }]).ok).toBe(
      false,
    );
  });

  it('n’applique rien si une opération échoue, et ne touche pas au voyage d’origine', () => {
    const before = JSON.stringify(planned);
    const result = applyOps(planned, [
      { op: 'set_day_title', dayIndex: 1, title: 'Tour' },
      { op: 'remove_stop', stopId: 'inconnu' },
    ]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(planned)).toBe(before);
  });

  it('rejoue sur un voyage modifié et signale une étape disparue', () => {
    const gone = applied(planned, [{ op: 'remove_stop', stopId }]);
    expect(applyOps(gone, [{ op: 'set_start_time', stopId, startTime: '09:00' }]).ok).toBe(false);
  });
});

describe('planImpact', () => {
  it('montre le jour modifié et l’alerte résolue', () => {
    const settings = { ...DEFAULT_SETTINGS, thresholds: { maxHikingHoursPerDay: 1 } };
    const after = applied(planned, [{ op: 'remove_stop', stopId }]);
    const impact = planImpact(planned, after, {}, settings);
    expect(impact.days).toHaveLength(1);
    expect(impact.days[0]).toMatchObject({
      dayIndex: 1,
      before: { hikingMin: 120 },
      after: { hikingMin: 0 },
    });
    expect(impact.alertsResolved[0]).toMatch(/de marche pour 1 h max/);
    expect(impact.alertsAdded).toEqual([]);
  });

  it('signale une alerte créée', () => {
    const settings = { ...DEFAULT_SETTINGS, thresholds: { maxHikingHoursPerDay: 1 } };
    const start = applied(planned, [{ op: 'remove_stop', stopId }]);
    expect(planImpact(start, planned, {}, settings).alertsAdded).toHaveLength(1);
  });

  it('ne dit rien si les chiffres ne changent pas', () => {
    const after = applied(planned, [{ op: 'set_day_title', dayIndex: 1, title: 'Tour' }]);
    expect(planImpact(planned, after, {}, DEFAULT_SETTINGS).days).toEqual([]);
  });

  it('préfère le trajet en cache à l’estimation', () => {
    const away = { ...hike('Loin'), start: { lat: 45.5, lng: 6.5 }, end: { lat: 45.5, lng: 6.5 } };
    const trip = addHikeStop(planned, 2, away);
    const [estimated] = estimateLegs(trip, {});
    expect(estimated?.source).toBe('straight-line-fallback');
    const key = '45.0000,6.0000→45.5000,6.5000';
    const [cached] = estimateLegs(trip, { [key]: { ...estimated!, source: 'ign' } });
    expect(cached?.source).toBe('ign');
  });
});

describe('describeTrip', () => {
  it('est stable et sans tracé GPX', () => {
    const first = describeTrip(planned, [], [], DEFAULT_SETTINGS, {});
    expect(describeTrip(planned, [], [], DEFAULT_SETTINGS, {})).toBe(first);
    expect(first).toContain(stopId);
    expect(first).toContain('"name":"Col"');
    expect(first).not.toContain('profile');
    expect(first).not.toContain('gpxFile');
  });

  it('expose la bibliothèque et la météo', () => {
    const lac = hike('Lac');
    const text = describeTrip(addHikes(planned, [lac]), [], [], DEFAULT_SETTINGS, {
      1: {
        status: 'forecast',
        code: 73,
        tempMinC: -4,
        tempMaxC: 2,
        precipitationMm: 6,
        windKmh: 30,
      },
    });
    expect(text).toContain('Lac');
    expect(text).toContain('Neige');
  });
});
