import type { LatLng } from './schema';

export type ParsedMapLink = { location: LatLng | null; name?: string; query?: string };

const COORDS = String.raw`(-?\d{1,3}\.\d+)[,\s+]+(-?\d{1,3}\.\d+)`;

function toLatLng(lat: string | undefined, lng: string | undefined): LatLng | null {
  const location = { lat: Number(lat), lng: Number(lng) };
  const valid =
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    Math.abs(location.lat) <= 90 &&
    Math.abs(location.lng) <= 180;
  return valid ? location : null;
}

function coordinatesIn(text: string): LatLng | null {
  const match = new RegExp(`^\\s*${COORDS}\\s*$`).exec(text);
  return match ? toLatLng(match[1], match[2]) : null;
}

function decode(segment: string): string {
  return decodeURIComponent(segment.replaceAll('+', ' ')).trim();
}

/**
 * Lit une position dans un lien Google Maps, par ordre de précision : le point du lieu (!3d!4d),
 * puis les paramètres de recherche ou d'itinéraire, puis le centre de la vue (@).
 */
export function parseMapLink(link: string): ParsedMapLink {
  const url = new URL(link);
  const path = decodeURIComponent(url.pathname);
  const name = /\/place\/([^/]+)/.exec(url.pathname)?.[1];
  const placeName = name ? decode(name) : undefined;
  const label = placeName && !coordinatesIn(placeName) ? placeName : undefined;

  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(link);
  if (pin) return { location: toLatLng(pin[1], pin[2]), name: label };

  const params = ['q', 'query', 'destination', 'daddr', 'll', 'center'].flatMap((key) => {
    const value = url.searchParams.get(key);
    return value ? [value] : [];
  });
  for (const value of params) {
    const location = coordinatesIn(value);
    if (location) return { location, name: label };
  }

  const inPath = /\/(?:place|search|dir)\/([^/@]+)/.exec(path)?.[1];
  const pathLocation = inPath ? coordinatesIn(inPath.replaceAll('+', ' ')) : null;
  if (pathLocation) return { location: pathLocation, name: label };

  const view = new RegExp(`@${COORDS}`).exec(path);
  if (view) return { location: toLatLng(view[1], view[2]), name: label };

  return { location: null, name: label, query: params[0] ?? label };
}
