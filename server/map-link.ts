import { parseMapLink } from '../shared/map-link';
import type { MapLinkResult } from '../shared/schema';
import { geocode } from './geocode';

const MAX_REDIRECTS = 5;

export class MapLinkError extends Error {}

function isShortLink({ hostname, pathname }: URL): boolean {
  return (
    hostname === 'maps.app.goo.gl' ||
    (hostname === 'goo.gl' && pathname.startsWith('/maps')) ||
    hostname === 'g.co'
  );
}

/** Seuls les domaines de Google Maps sont suivis : le serveur n'ouvre pas une URL quelconque. */
function isGoogleMaps(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (isShortLink(url)) return true;
  return /^(www\.|maps\.|consent\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(url.hostname);
}

function parseUrl(link: string): URL {
  if (!URL.canParse(link)) throw new MapLinkError("Ce n'est pas une adresse web valide");
  const url = new URL(link);
  if (!isGoogleMaps(url)) throw new MapLinkError("Ce n'est pas un lien Google Maps");
  return url;
}

/** Suit les redirections d'un lien court, sans jamais lire le contenu d'une page. */
async function expand(link: string): Promise<URL> {
  let url = parseUrl(link);
  for (let hop = 0; hop < MAX_REDIRECTS && isShortLink(url); hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const location = response.headers.get('location');
    if (!location) throw new MapLinkError('Ce lien court ne mène à aucun lieu');
    url = parseUrl(new URL(location, url).href);
  }
  // Écran de consentement : la vraie adresse est dans `continue`.
  const next = url.hostname.startsWith('consent.') ? url.searchParams.get('continue') : null;
  return next ? parseUrl(next) : url;
}

export async function resolveMapLink(link: string): Promise<MapLinkResult> {
  const url = await expand(link.trim());
  const { location, name, query } = parseMapLink(url.href);
  if (location) {
    return { name: name ?? '', location, url: link.trim(), approximate: false };
  }
  const match = query ? (await geocode(query))[0] : undefined;
  if (!match) throw new MapLinkError('Ce lien ne contient pas de position exploitable');
  return { name: name ?? match.label, location: match.location, url: link.trim(), approximate: true };
}
