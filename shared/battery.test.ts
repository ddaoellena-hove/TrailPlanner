import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeAlerts } from './alerts';
import { batteryPlan, batteryWarnings } from './battery';
import { DEFAULT_SETTINGS, type ItineraryLeg, type Place, type Stop, type Trip } from './schema';
import { generateDays } from './trip';

const here = { lat: 45, lng: 6 };

const place = (type: Place['type'], overrides: Partial<Place> = {}): Place => ({
  id: randomUUID(),
  type,
  name: type,
  location: here,
  ...overrides,
});

const placeStop = ({ id }: Place): Stop => ({ id: randomUUID(), kind: 'place', placeId: id });

const baseTrip: Trip = {
  schemaVersion: 1,
  id: randomUUID(),
  slug: 'test',
  name: 'Test',
  startDate: '2027-07-01',
  endDate: '2027-07-02',
  travelers: { withDog: false, electricVehicle: true },
  // 0,4 % par kilomètre.
  vehicle: { batteryKwh: 50, startPercent: 90, consumptionKwhPer100km: 20 },
  hikes: [],
  places: [],
  days: generateDays('2027-07-01', '2027-07-02'),
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const leg = (distanceKm: number, overrides: Partial<ItineraryLeg> = {}): ItineraryLeg => ({
  from: here,
  to: here,
  distanceKm,
  durationMin: 60,
  geometry: { type: 'LineString', coordinates: [] },
  source: 'ign',
  fromName: 'A',
  toName: 'B',
  dayIndex: 1,
  stopId: null,
  phase: 'end',
  trailToStay: false,
  ...overrides,
});

const levels = (trip: Trip, legs: ItineraryLeg[]) =>
  batteryPlan(trip, legs)?.map(({ fromPercent, toPercent }) => [fromPercent, toPercent]);

const withStops = (stops: Stop[], places: Place[]): Trip => ({
  ...baseTrip,
  places,
  days: baseTrip.days.map((day) => (day.index === 1 ? { ...day, stops } : day)),
});

describe('batteryPlan', () => {
  it('ne calcule rien sans véhicule ou hors voiture électrique', () => {
    expect(batteryPlan({ ...baseTrip, vehicle: undefined }, [leg(10)])).toBeNull();
    expect(batteryPlan({ ...baseTrip, travelers: { withDog: false } }, [leg(10)])).toBeNull();
  });

  it('retire la consommation de chaque trajet', () => {
    expect(levels(baseTrip, [leg(50), leg(25)])).toEqual([
      [90, 70],
      [70, 60],
    ]);
  });

  it('remonte à 80 % à une borne, sans jamais baisser le niveau', () => {
    const borne = place('charging');
    const stop = placeStop(borne);
    const trip = withStops([stop], [borne]);
    const enter = { stopId: stop.id, phase: 'enter' as const };
    expect(levels(trip, [leg(150, enter), leg(50)])).toEqual([
      [90, 30],
      [80, 60],
    ]);
    expect(levels(trip, [leg(10, enter), leg(50)])).toEqual([
      [90, 86],
      [86, 66],
    ]);
  });

  it('compte une borne sans trajet pour la rejoindre', () => {
    const borne = place('charging');
    const trip = { ...withStops([placeStop(borne)], [borne]) };
    expect(levels({ ...trip, vehicle: { ...trip.vehicle!, startPercent: 40 } }, [leg(50)])).toEqual(
      [[80, 60]],
    );
  });

  it('remplit la batterie la nuit, seulement si l’hébergement le permet', () => {
    const night = (chargesOvernight: boolean) => {
      const gite = place('lodging', { chargesOvernight });
      return {
        ...baseTrip,
        places: [gite],
        days: baseTrip.days.map((day) =>
          day.index === 1 ? { ...day, nightPlaceId: gite.id } : day,
        ),
      };
    };
    const legs = [leg(50), leg(50, { dayIndex: 2 })];
    expect(levels(night(true), legs)?.[1]).toEqual([100, 80]);
    expect(levels(night(false), legs)?.[1]).toEqual([70, 50]);
  });

  it('s’arrête à zéro et marque le trajet impossible', () => {
    const plan = batteryPlan(baseTrip, [leg(300), leg(10)]);
    expect(plan?.map(({ toPercent, empty }) => [toPercent, empty])).toEqual([
      [0, true],
      [0, true],
    ]);
  });
});

describe('batteryWarnings', () => {
  it('ne signale qu’une fois entre deux recharges, le trajet le plus grave', () => {
    const steps = batteryPlan(baseTrip, [leg(190), leg(10), leg(100), leg(10)])!;
    expect(batteryWarnings(steps)).toEqual([steps[2]]);
  });

  it('signale de nouveau après une recharge', () => {
    const borne = place('charging');
    const stop = placeStop(borne);
    const trip = withStops([stop], [borne]);
    const steps = batteryPlan(trip, [leg(200, { stopId: stop.id, phase: 'enter' }), leg(180)])!;
    expect(batteryWarnings(steps)).toHaveLength(2);
  });
});

describe('alerte A10', () => {
  const a10 = (trip: Trip, legs: ItineraryLeg[]) =>
    computeAlerts(trip, legs, DEFAULT_SETTINGS).filter(({ code }) => code === 'A10');

  it('prévient sous la réserve de 15 %', () => {
    expect(a10(baseTrip, [leg(190, { fromName: 'Lyon', toName: 'Gap' })])).toMatchObject([
      { level: 'warning', message: "J1 : Lyon → Gap : 14 % à l'arrivée, sous la réserve de 15 %" },
    ]);
  });

  it('passe en erreur si la batterie ne suffit pas', () => {
    expect(a10(baseTrip, [leg(300)])).toMatchObject([{ level: 'error', dayIndex: 1 }]);
  });

  it('reste muette si tout tient', () => {
    expect(a10(baseTrip, [leg(100)])).toEqual([]);
  });
});
