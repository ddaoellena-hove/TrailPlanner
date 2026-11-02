import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type Trip } from '../../shared/schema';
import { api } from './api';

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
