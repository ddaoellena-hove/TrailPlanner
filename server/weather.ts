import { z } from 'zod';
import { plannedStops } from '../shared/itinerary';
import type { DayWeather, LatLng, Trip } from '../shared/schema';
import { forecastAvailableFrom, isForecastable } from '../shared/weather';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MS = 60 * 60 * 1000;

const ForecastSchema = z.object({
  daily: z.object({
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_sum: z.array(z.number()),
    wind_speed_10m_max: z.array(z.number()),
    weather_code: z.array(z.number()),
  }),
});

type Forecast = Extract<DayWeather, { status: 'forecast' }>;

const cache = new Map<string, { at: number; forecast: Forecast }>();

async function fetchForecast(date: string, { lat, lng }: LatLng, altitudeM: number | null) {
  const key = `${date}|${lat.toFixed(2)},${lng.toFixed(2)}|${altitudeM}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.forecast;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily:
      'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code',
    timezone: 'Europe/Paris',
    start_date: date,
    end_date: date,
    ...(altitudeM === null ? {} : { elevation: String(altitudeM) }),
  });
  const response = await fetch(`${FORECAST_URL}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Open-Meteo : ${response.status}`);
  const { daily } = ForecastSchema.parse(await response.json());
  const forecast: Forecast = {
    status: 'forecast',
    tempMinC: daily.temperature_2m_min[0]!,
    tempMaxC: daily.temperature_2m_max[0]!,
    precipitationMm: daily.precipitation_sum[0]!,
    windKmh: daily.wind_speed_10m_max[0]!,
    code: daily.weather_code[0]!,
  };
  cache.set(key, { at: Date.now(), forecast });
  return forecast;
}

/** Météo de chaque jour, au premier point du jour et à l'altitude maximale de sa rando. */
export async function tripWeather(trip: Trip, today: string): Promise<Record<number, DayWeather>> {
  const stops = plannedStops(trip);
  const entries = await Promise.all(
    trip.days.map(async (day): Promise<[number, DayWeather] | null> => {
      const first = stops.find(({ dayIndex }) => dayIndex === day.index);
      if (!first || day.date < today) return null;
      if (!isForecastable(day.date, today)) {
        return [day.index, { status: 'later', availableFrom: forecastAvailableFrom(day.date) }];
      }
      const hikeStop = day.stops.find((stop) => stop.kind === 'hike');
      const hike =
        hikeStop?.kind === 'hike'
          ? trip.hikes.find(({ id }) => id === hikeStop.hikeId)
          : undefined;
      try {
        const altitude = hike?.stats.maxAltitudeM ?? null;
        return [day.index, await fetchForecast(day.date, hike?.start ?? first.location, altitude)];
      } catch (error) {
        console.warn('Météo indisponible :', error);
        return [day.index, { status: 'unavailable' }];
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
