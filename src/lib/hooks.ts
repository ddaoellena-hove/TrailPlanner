import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type Poi, type Trip } from '../../shared/schema';
import { api } from './api';

export const POI_LABELS: Record<Poi['kind'], string> = {
  water: 'Eau',
  hut: 'Refuge',
  camping: 'Camping',
  parking: 'Parking',
};

export function itineraryKey(trip: Trip) {
  return ['itinerary', trip.slug, trip.updatedAt];
}

/**
 * La clé suit updatedAt : toute modification recalcule, et seuls les nouveaux trajets repartent
 * vers le routage grâce au cache serveur.
 */
export function useItinerary(trip: Trip) {
  return useQuery({
    queryKey: itineraryKey(trip),
    queryFn: () => api.computeItinerary(trip.slug),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useSettings() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  return settings.data ?? DEFAULT_SETTINGS;
}

/** Bornes du voyage, seulement pour un voyage en voiture électrique. */
export function useChargingStations(trip: Trip, minKw: number) {
  return useQuery({
    queryKey: ['charging', trip.slug, trip.updatedAt, minKw],
    queryFn: () => api.chargingStations(trip.slug, minKw),
    enabled: Boolean(trip.travelers.electricVehicle),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Météo par jour : se recharge si le voyage change, sans insister en cas de panne. */
export function useWeather(trip: Trip) {
  return useQuery({
    queryKey: ['weather', trip.slug, trip.updatedAt],
    queryFn: () => api.weather(trip.slug),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Cherchés à la demande : Overpass est lent, et ne dépend que des tracés. */
export function usePois(trip: Trip, enabled: boolean) {
  return useQuery({
    queryKey: ['poi', trip.slug, trip.hikes.map(({ id }) => id).join()],
    queryFn: () => api.pois(trip.slug),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}
