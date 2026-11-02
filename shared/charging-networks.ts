import type { ChargingStation } from './schema';

/** Réseaux reconnus dans la base IRVE, d'après leurs noms déclarés (vérifiés sur la base). */
export const CHARGING_NETWORKS = [
  { id: 'ionity', label: 'IONITY', pattern: /ionity/i },
  { id: 'izivia', label: 'Izivia', pattern: /izivia/i },
  { id: 'mobilize', label: 'Mobilize', pattern: /mobilize/i },
  { id: 'sowatt', label: 'Sowatt', pattern: /sowatt/i },
  { id: 'le-plein', label: 'Le Plein', pattern: /le plein/i },
] as const;

/** Absents de la base IRVE : leurs bornes s'ajoutent à la main ou par lien Google Maps. */
export const NETWORKS_NOT_IN_IRVE = ['Plug Inn', 'Electra'];

export const DEFAULT_FAVORITE_NETWORKS: string[] = CHARGING_NETWORKS.map(({ id }) => id);

export function stationNetwork(names: (string | null)[]): string | null {
  const text = names.filter(Boolean).join(' ');
  return CHARGING_NETWORKS.find(({ pattern }) => pattern.test(text))?.id ?? null;
}

export type RankedStation = ChargingStation & { favorite: boolean };

/** Réseaux favoris d'abord, puissance décroissante dans chaque groupe. */
export function rankStations(
  stations: ChargingStation[],
  favorites: string[],
  onlyFavorites: boolean,
): RankedStation[] {
  return stations
    .map((station) => ({
      ...station,
      favorite: Boolean(station.network && favorites.includes(station.network)),
    }))
    .filter(({ favorite }) => favorite || !onlyFavorites)
    .toSorted(
      (a, b) => Number(b.favorite) - Number(a.favorite) || b.maxPowerKw - a.maxPowerKw,
    );
}
