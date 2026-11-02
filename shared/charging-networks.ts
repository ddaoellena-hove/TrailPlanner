import type { ChargingStation, FavoriteStation, MapLinkResult } from './schema';

/** Réseaux reconnus d'après leurs noms déclarés. Electra vient d'Open Charge Map, les autres d'IRVE. */
export const CHARGING_NETWORKS = [
  { id: 'ionity', label: 'IONITY', pattern: /ionity/i },
  { id: 'izivia', label: 'Izivia', pattern: /izivia/i },
  { id: 'mobilize', label: 'Mobilize', pattern: /mobilize/i },
  { id: 'sowatt', label: 'Sowatt', pattern: /sowatt/i },
  { id: 'le-plein', label: 'Le Plein', pattern: /le plein/i },
  { id: 'electra', label: 'Electra', pattern: /\belectra\b/i },
] as const;

/** Sans source automatique : leurs bornes s'ajoutent par lien Google Maps. */
export const NETWORKS_WITHOUT_SOURCE = ['Plug Inn'];

export const DEFAULT_FAVORITE_NETWORKS: string[] = CHARGING_NETWORKS.map(({ id }) => id);

/**
 * Fiche Google Maps d'une borne, pour lire ses avis. Les noms IRVE sont souvent des codes :
 * l'opérateur et l'adresse la retrouvent mieux. Un lien collé par l'utilisateur reste prioritaire.
 */
export function stationReviewsUrl({
  name,
  operator,
  address,
  url,
}: Pick<FavoriteStation, 'name' | 'operator' | 'address' | 'url'>): string {
  if (url) return url;
  const place = address ? [operator, address] : [name];
  const query = ['borne de recharge', ...place].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function stationNetwork(names: (string | null)[]): string | null {
  const text = names.filter(Boolean).join(' ');
  return CHARGING_NETWORKS.find(({ pattern }) => pattern.test(text))?.id ?? null;
}

export type RankedStation = ChargingStation & { favorite: boolean; starred: boolean };

/** Bornes étoilées, puis réseaux favoris, puissance décroissante dans chaque groupe. */
export function rankStations(
  stations: ChargingStation[],
  favorites: string[],
  onlyFavorites: boolean,
  starredIds: string[] = [],
): RankedStation[] {
  return stations
    .map((station) => ({
      ...station,
      favorite: Boolean(station.network && favorites.includes(station.network)),
      starred: starredIds.includes(station.id),
    }))
    .filter(({ favorite, starred }) => favorite || starred || !onlyFavorites)
    .toSorted(
      (a, b) =>
        Number(b.starred) - Number(a.starred) ||
        Number(b.favorite) - Number(a.favorite) ||
        b.maxPowerKw - a.maxPowerKw,
    );
}

export function toggleFavoriteStation(
  favorites: FavoriteStation[],
  station: FavoriteStation,
): FavoriteStation[] {
  return favorites.some(({ id }) => id === station.id)
    ? favorites.filter(({ id }) => id !== station.id)
    : [...favorites, station];
}

/** Une borne ajoutée par lien : sa puissance et ses connecteurs ne sont pas connus. */
export function stationFromLink(
  { location, url }: MapLinkResult,
  name: string,
  id: string,
): FavoriteStation {
  return {
    id,
    name,
    address: '',
    operator: '',
    network: null,
    location,
    maxPowerKw: 0,
    points: 0,
    connectors: [],
    hours: null,
    url,
  };
}
