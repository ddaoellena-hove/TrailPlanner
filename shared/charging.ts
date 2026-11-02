import { distance, point } from '@turf/turf';
import type { LatLng } from './schema';

const STEP_KM = 25;
const BOX_HALF_LAT = 0.05;
const BOX_HALF_LNG = 0.07;
export const MAX_BOXES = 60;

export function distanceKm(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]));
}

export type Box = { south: number; north: number; west: number; east: number };

function boxAround({ lat, lng }: LatLng): Box {
  return {
    south: lat - BOX_HALF_LAT,
    north: lat + BOX_HALF_LAT,
    west: lng - BOX_HALF_LNG,
    east: lng + BOX_HALF_LNG,
  };
}

/** Points espacés de STEP_KM le long d'une ligne, extrémités comprises. */
function sampleLine(coordinates: number[][]): LatLng[] {
  const samples: LatLng[] = [];
  let sinceLast = Infinity;
  coordinates.forEach((position, index) => {
    const previous = coordinates[index - 1];
    if (previous) sinceLast += distance(point(previous), point(position));
    if (sinceLast >= STEP_KM || index === coordinates.length - 1) {
      samples.push({ lat: position[1]!, lng: position[0]! });
      sinceLast = 0;
    }
  });
  return samples;
}

/** Zones à interroger : un couloir d'environ 5 km de part et d'autre des trajets, et chaque étape. */
export function corridorBoxes(lines: number[][][], stops: LatLng[]): Box[] {
  const boxes = new Map<string, Box>();
  for (const sample of [...lines.flatMap(sampleLine), ...stops]) {
    const key = `${sample.lat.toFixed(1)},${sample.lng.toFixed(1)}`;
    if (!boxes.has(key)) boxes.set(key, boxAround(sample));
  }
  return [...boxes.values()].slice(0, MAX_BOXES);
}
