import { gpx } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import type { RecordedPoint, RecordedTrack } from '../shared/activity';
import { computeHikeStats, detectKind, type TrackPoint } from '../shared/gpx';
import type { Hike, Settings } from '../shared/schema';

export class GpxError extends Error {}

/** Taille maximale d'un GPX importé (voyage ou activité). */
export const MAX_GPX_BYTES = 10 * 1024 * 1024;

type ParsedGpx = Pick<Hike, 'kind' | 'stats' | 'start' | 'end'> & {
  name?: string;
  coordinates: number[][];
};

/**
 * Un GPX n'a jamais besoin de DTD : la refuser écarte les entités externes et l'expansion
 * d'entités (« billion laughs ») avant même que xmldom ne lise le fichier.
 */
function parseXml(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new GpxError('Ce GPX contient une déclaration DOCTYPE, refusée par sécurité');
  }
  try {
    const document = new DOMParser({ onError: () => undefined }).parseFromString(
      xml,
      'text/xml',
    );
    // togeojson n'utilise que l'API DOM commune à xmldom et au navigateur.
    return document as unknown as Document;
  } catch {
    throw new GpxError("Ce fichier n'est pas un GPX lisible");
  }
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

function toTrackPoint(position: number[]): TrackPoint {
  return { lng: position[0]!, lat: position[1]!, altM: position[2] ?? null };
}

export function parseGpx(xml: string, pace: Settings['pace']): ParsedGpx {
  let features;
  try {
    features = gpx(parseXml(xml)).features;
  } catch (error) {
    if (error instanceof GpxError) throw error;
    throw new GpxError("Ce fichier n'est pas un GPX lisible");
  }

  const points: TrackPoint[] = [];
  let name: string | undefined;
  for (const { geometry, properties } of features) {
    if (geometry?.type === 'LineString') {
      points.push(...geometry.coordinates.map(toTrackPoint));
    } else if (geometry?.type === 'MultiLineString') {
      points.push(...geometry.coordinates.flat().map(toTrackPoint));
    } else {
      continue;
    }
    if (typeof properties?.name === 'string') name ??= properties.name;
  }

  if (points.some(({ lat, lng }) => !isValidCoordinate(lat, lng))) {
    throw new GpxError('Ce GPX contient des coordonnées invalides');
  }
  const [start] = points;
  const end = points.at(-1);
  if (!start || !end || points.length < 2) {
    throw new GpxError('Ce GPX ne contient aucune trace');
  }
  return {
    name,
    kind: detectKind(points),
    stats: computeHikeStats(points, pace),
    start: { lat: start.lat, lng: start.lng },
    end: { lat: end.lat, lng: end.lng },
    coordinates: points.map(({ lng, lat }) => [lng, lat]),
  };
}

function children(parent: Element, tag: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).localName === tag,
  );
}

function childText(parent: Element, tag: string): string | null {
  const text = children(parent, tag)[0]?.textContent?.trim();
  return text ? text : null;
}

function readPoint(element: Element): RecordedPoint {
  const lat = Number.parseFloat(element.getAttribute('lat') ?? '');
  const lng = Number.parseFloat(element.getAttribute('lon') ?? '');
  if (!isValidCoordinate(lat, lng)) {
    throw new GpxError('Ce GPX contient des coordonnées invalides');
  }
  const ele = childText(element, 'ele');
  const altM = ele === null ? null : Number.parseFloat(ele);
  const time = childText(element, 'time');
  return {
    lat,
    lng,
    altM: altM !== null && Number.isFinite(altM) ? altM : null,
    // Une heure illisible vaut inconnue, sans invalider le point.
    time: time !== null && Number.isFinite(Date.parse(time)) ? time : null,
  };
}

/**
 * Trace enregistrée : segments séparés (une pause ne compte pas comme distance) et heures
 * gardées telles qu'écrites dans le fichier. Les `<rte>` et `<wpt>` ne sont pas des traces.
 */
export function parseRecordedGpx(xml: string): RecordedTrack {
  const root = parseXml(xml).documentElement;
  if (!root || root.localName !== 'gpx') {
    throw new GpxError("Ce fichier n'est pas un GPX lisible");
  }
  const tracks = children(root, 'trk');
  const segments = tracks
    .flatMap((track) => children(track, 'trkseg'))
    .map((segment) => children(segment, 'trkpt').map(readPoint))
    .filter((points) => points.length > 0);
  if (!segments.some((points) => points.length >= 2)) {
    throw new GpxError('Ce GPX ne contient aucune trace enregistrée');
  }
  const metadata = children(root, 'metadata')[0];
  const name =
    (metadata && childText(metadata, 'name')) ??
    tracks.map((track) => childText(track, 'name')).find((value) => value !== null) ??
    null;
  return { name, creator: root.getAttribute('creator') || null, segments };
}
