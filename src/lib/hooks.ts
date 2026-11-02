import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { DEFAULT_FAVORITE_NETWORKS, rankStations } from '../../shared/charging-networks';
import { DEFAULT_SETTINGS, type Poi, type Settings, type Trip } from '../../shared/schema';
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

export function useLibrary() {
  return useQuery({ queryKey: ['library'], queryFn: api.library });
}

/** Lien entre les randos d'un voyage et la bibliothèque, qui dépend de leurs seuls fichiers. */
export function useLibraryLinks(trip: Trip) {
  return useQuery({
    queryKey: ['library-links', trip.slug, trip.hikes.map(({ gpxFile }) => gpxFile).join()],
    queryFn: () => api.libraryLinks(trip.slug),
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

/** Enregistre un réglage léger : il s'applique tout de suite, sans attendre le serveur. */
export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.saveSettings,
    onMutate: (next: Settings) => {
      queryClient.setQueryData(['settings'], next);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.error(`Réglage non enregistré : ${error.message}`);
    },
  });
}

/** Bornes du voyage, réseaux favoris en tête. */
export function useRankedStations(trip: Trip, minKw: number) {
  const settings = useSettings();
  const query = useChargingStations(trip, minKw);
  const stations = rankStations(
    query.data?.stations ?? [],
    settings.favoriteNetworks ?? DEFAULT_FAVORITE_NETWORKS,
    settings.favoriteNetworksOnly ?? false,
    (settings.favoriteStations ?? []).map(({ id }) => id),
  );
  return { ...query, stations };
}
