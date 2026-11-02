import type { Hike, LatLng } from './schema';

export type ProfilePoint = {
  distKm: number;
  altM: number | null;
  lat: number;
  lng: number;
  slopePct: number | null;
  hikeId: string;
};

/** Profil d'une rando, ou profil enchaîné de plusieurs (SPEC §7), avec la pente locale. */
export function buildProfile(hikes: Hike[]): ProfilePoint[] {
  const points: ProfilePoint[] = [];
  let offsetKm = 0;
  for (const hike of hikes) {
    hike.stats.profile.forEach((point, index) => {
      const previous = hike.stats.profile[index - 1];
      const stepM = previous ? (point.distKm - previous.distKm) * 1000 : 0;
      points.push({
        ...point,
        distKm: offsetKm + point.distKm,
        slopePct:
          previous && stepM > 0 && point.altM !== null && previous.altM !== null
            ? ((point.altM - previous.altM) / stepM) * 100
            : null,
        hikeId: hike.id,
      });
    });
    offsetKm += hike.stats.profile.at(-1)?.distKm ?? 0;
  }
  return points;
}

export function nearestPointIndex(points: ProfilePoint[], { lat, lng }: LatLng): number {
  let nearest = -1;
  let nearestGap = Infinity;
  points.forEach((point, index) => {
    const gap = (point.lat - lat) ** 2 + (point.lng - lng) ** 2;
    if (gap < nearestGap) {
      nearest = index;
      nearestGap = gap;
    }
  });
  return nearest;
}
