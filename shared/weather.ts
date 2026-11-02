import type { DayWeather } from './schema';

/** Open-Meteo prévoit 16 jours, aujourd'hui compris. */
export const FORECAST_DAYS = 16;
const DAY_MS = 86_400_000;

/** Premier jour où une prévision existera pour `date`. */
export function forecastAvailableFrom(date: string): string {
  const from = Date.parse(`${date}T00:00:00Z`) - (FORECAST_DAYS - 1) * DAY_MS;
  return new Date(from).toISOString().slice(0, 10);
}

export function isForecastable(date: string, today: string): boolean {
  return date >= today && forecastAvailableFrom(date) <= today;
}

/** Libellé d'un code météo WMO. */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Ciel clair';
  if (code <= 3) return 'Nuageux';
  if (code <= 48) return 'Brouillard';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Averses de neige';
  return 'Orage';
}

export function formatWeather({
  code,
  tempMinC,
  tempMaxC,
  precipitationMm,
  windKmh,
}: Extract<DayWeather, { status: 'forecast' }>): string {
  return [
    weatherLabel(code),
    `${Math.round(tempMinC)} à ${Math.round(tempMaxC)} °C`,
    ...(precipitationMm > 0 ? [`${Math.round(precipitationMm)} mm`] : []),
    `vent ${Math.round(windKmh)} km/h`,
  ].join(' · ');
}
