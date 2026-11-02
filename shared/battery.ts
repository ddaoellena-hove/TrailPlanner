import type { Day, ItineraryLeg, Stop, Trip } from './schema';
import { nightOf } from './trip';

/** Sous ce niveau à l'arrivée, l'alerte A10 se déclenche. */
export const BATTERY_RESERVE_PERCENT = 15;
/** Une borne rapide ralentit au-delà : on suppose qu'on en repart à ce niveau. */
const CHARGE_TARGET_PERCENT = 80;
const FULL_PERCENT = 100;

export const DEFAULT_CONSUMPTION_KWH_PER_100KM = 22;

export type BatteryStep = {
  leg: ItineraryLeg;
  fromPercent: number;
  toPercent: number;
  /** La batterie ne suffit pas pour finir ce trajet. */
  empty: boolean;
};

function isChargingStop(trip: Trip, stop: Stop): boolean {
  if (stop.kind !== 'place') return false;
  return trip.places.find(({ id }) => id === stop.placeId)?.type === 'charging';
}

/**
 * Niveau de batterie estimé trajet par trajet, ou null sans véhicule renseigné.
 * Les recharges suivent le planning : une borne au fil des étapes, un hébergement la nuit.
 */
export function batteryPlan(trip: Trip, legs: ItineraryLeg[]): BatteryStep[] | null {
  const { vehicle, travelers } = trip;
  if (!travelers.electricVehicle || !vehicle) return null;
  const percentPerKm = vehicle.consumptionKwhPer100km / vehicle.batteryKwh;
  const steps: BatteryStep[] = [];
  let percent = vehicle.startPercent;

  const drive = (leg: ItineraryLeg) => {
    const arrival = percent - leg.distanceKm * percentPerKm;
    steps.push({
      leg,
      fromPercent: percent,
      toPercent: Math.max(arrival, 0),
      empty: arrival < 0,
    });
    percent = Math.max(arrival, 0);
  };
  const stopLegs = (stop: Stop, phase: ItineraryLeg['phase']) =>
    legs.filter((leg) => leg.stopId === stop.id && leg.phase === phase);
  const dayEndLegs = (day: Day) =>
    legs.filter((leg) => leg.dayIndex === day.index && leg.stopId === null);

  for (const day of trip.days) {
    for (const stop of day.stops) {
      stopLegs(stop, 'enter').forEach(drive);
      if (isChargingStop(trip, stop)) percent = Math.max(percent, CHARGE_TARGET_PERCENT);
      stopLegs(stop, 'stay').forEach(drive);
    }
    dayEndLegs(day).forEach(drive);
    if (nightOf(trip, day)?.chargesOvernight) percent = FULL_PERCENT;
  }
  return steps;
}

export function isBelowReserve({ toPercent }: BatteryStep): boolean {
  return toPercent < BATTERY_RESERVE_PERCENT;
}

/** Le trajet à signaler entre deux recharges : le premier vidé, sinon le premier sous la réserve. */
export function batteryWarnings(steps: BatteryStep[]): BatteryStep[] {
  const warnings: BatteryStep[] = [];
  let current: BatteryStep | undefined;
  steps.forEach((step, index) => {
    const recharged = index > 0 && step.fromPercent > steps[index - 1]!.toPercent;
    if (recharged) current = undefined;
    if (!isBelowReserve(step)) return;
    if (!current) {
      current = step;
      warnings.push(step);
    } else if (step.empty && !current.empty) {
      warnings[warnings.length - 1] = step;
      current = step;
    }
  });
  return warnings;
}
