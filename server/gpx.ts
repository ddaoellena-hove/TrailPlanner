import { gpx } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import { computeHikeStats, detectKind, type TrackPoint } from '../shared/gpx';
import type { Hike, Settings } from '../shared/schema';

export class GpxError extends Error {}

type ParsedGpx = Pick<Hike, 'kind' | 'stats' | 'start' | 'end'> & {
  name?: string;
  coordinates: number[][];
};

function toTrackPoint(position: number[]): TrackPoint {
  return { lng: position[0]!, lat: position[1]!, altM: position[2] ?? null };
}

export function parseGpx(xml: string, pace: Settings['pace']): ParsedGpx {
  let features;
  try {
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    // togeojson n'utilise que l'API DOM commune à xmldom et au navigateur.
    features = gpx(document as unknown as Document).features;
  } catch {
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
