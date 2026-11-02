import type { ChargingStation } from '../../shared/schema';

export function formatStation({ maxPowerKw, points, connectors, operator }: ChargingStation): string {
  return [
    `${Math.round(maxPowerKw)} kW`,
    `${points} ${points > 1 ? 'points' : 'point'}`,
    ...(connectors.length > 0 ? [connectors.join(', ')] : []),
    ...(operator ? [operator] : []),
  ].join(' · ');
}

export function stationNotes(station: ChargingStation): string {
  return [formatStation(station), station.address, station.hours && `Horaires : ${station.hours}`]
    .filter(Boolean)
    .join('\n');
}
