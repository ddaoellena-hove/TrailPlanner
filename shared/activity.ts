import { lineString, point, pointToLineDistance } from '@turf/turf';
import {
  cumulativeKm,
  elevationChange,
  round,
  sampleIndexes,
  smoothAltitudes,
  type TrackPoint,
} from './gpx';
import type { Activity, ActivityDraft, ActivitySource, DuplicateCheck, HikeStats } from './schema';

/** Point d'une trace enregistrée ; `time` est la chaîne du fichier, null si absente ou illisible. */
export type RecordedPoint = TrackPoint & { time: string | null };

export type RecordedTrack = {
  name: string | null;
  creator: string | null;
  /** Segments `trkseg` non vides, dans l'ordre du fichier. */
  segments: RecordedPoint[][];
};

/** Mesures d'une trace enregistrée. Distance et dénivelé sont cumulés segment par segment. */
export type RecordedMetrics = Pick<
  ActivityDraft,
  | 'activityDate'
  | 'endedAt'
  | 'distanceMeters'
  | 'durationSeconds'
  | 'elevationGainMeters'
  | 'elevationLossMeters'
  | 'pointCount'
  | 'segmentCount'
  | 'start'
  | 'end'
  | 'profile'
>;

function timedPoints(points: RecordedPoint[]): { time: string; ms: number }[] {
  return points.flatMap(({ time }) => (time === null ? [] : [{ time, ms: Date.parse(time) }]));
}

/**
 * Durée écoulée (pas de « temps en mouvement ») : dernière heure − première heure.
 * Null s'il manque des heures ou si elles reculent : on ne devine pas.
 */
function elapsed(points: RecordedPoint[]): {
  first: string | null;
  last: string | null;
  seconds: number | null;
} {
  const times = timedPoints(points);
  const first = times[0];
  const last = times.at(-1);
  if (!first || !last) return { first: null, last: null, seconds: null };
  const seconds = (last.ms - first.ms) / 1000;
  const monotonic = times.every((entry, i) => i === 0 || entry.ms >= times[i - 1]!.ms);
  return {
    first: first.time,
    last: last.time,
    seconds: monotonic && times.length === points.length ? Math.round(seconds) : null,
  };
}

/**
 * Seuil d'hystérésis des traces enregistrées, plus fin que celui des randos (5 m) : choisi par
 * David le 14 novembre 2026 sur une sortie AllTrails réelle (D+ 87 m contre 85 m affichés,
 * 66 m avec 5 m). À confirmer sur des sorties plus montagneuses.
 */
export const RECORDED_HYSTERESIS_M = 2;

/**
 * Le dénivelé reprend la moyenne glissante des randos (50 m, `shared/gpx.ts`) avec le seuil
 * `RECORDED_HYSTERESIS_M`, segment par segment. Sans altitude partout : null.
 */
export function recordedMetrics(track: RecordedTrack): RecordedMetrics {
  const { segments } = track;
  const points = segments.flat();
  const withAltitude = points.every(({ altM }) => altM !== null);
  let totalKm = 0;
  let gainM = 0;
  let lossM = 0;
  const profilePoints: HikeStats['profile'] = [];

  for (const segment of segments) {
    const distances = cumulativeKm(segment);
    const smoothed = withAltitude
      ? smoothAltitudes(
          segment.map(({ altM }) => altM!),
          distances,
        )
      : null;
    if (smoothed) {
      const change = elevationChange(smoothed, RECORDED_HYSTERESIS_M);
      gainM += change.gainM;
      lossM += change.lossM;
    }
    segment.forEach((p, i) =>
      profilePoints.push({
        distKm: totalKm + distances[i]!,
        altM: smoothed && smoothed[i]!,
        lat: p.lat,
        lng: p.lng,
      }),
    );
    totalKm += distances.at(-1) ?? 0;
  }

  const time = elapsed(points);
  const start = points[0]!;
  const end = points.at(-1)!;
  return {
    activityDate: time.first,
    endedAt: time.last,
    distanceMeters: Math.round(totalKm * 1000),
    durationSeconds: time.seconds,
    elevationGainMeters: withAltitude ? Math.round(gainM) : null,
    elevationLossMeters: withAltitude ? Math.round(lossM) : null,
    pointCount: points.length,
    segmentCount: segments.length,
    start: { lat: start.lat, lng: start.lng },
    end: { lat: end.lat, lng: end.lng },
    profile: sampleIndexes(profilePoints.length).map((i) => {
      const entry = profilePoints[i]!;
      return {
        ...entry,
        distKm: round(entry.distKm, 3),
        altM: entry.altM === null ? null : round(entry.altM, 1),
      };
    }),
  };
}

/** Provenance lue dans l'attribut `creator` du GPX, sans la supposer. */
export function activitySource(track: RecordedTrack): ActivitySource {
  return track.creator && /alltrails/i.test(track.creator) ? 'alltrails' : 'gpx';
}

/** Titre : nom du fichier GPX (métadonnées puis piste), sinon nom du fichier sans extension. */
export function activityTitle(track: RecordedTrack, fileName: string): string {
  const fromFile = fileName.replace(/\.gpx$/i, '').trim();
  return track.name?.trim() || fromFile || 'Activité sans nom';
}

// Doublon probable (décision D6 de ALLTRAILS-AUDIT.md) : toutes les conditions doivent tenir.
export const DUPLICATE_MAX_START_GAP_MIN = 10;
export const DUPLICATE_MAX_DISTANCE_GAP = 0.05;
export const DUPLICATE_MAX_TRACK_GAP_M = 50;
export const DUPLICATE_MIN_CLOSE_SHARE = 0.8;
const DUPLICATE_SAMPLES = 50;

type Comparable = Pick<ActivityDraft, 'activityDate' | 'distanceMeters' | 'profile'>;

function startsTogether(a: Comparable, b: Comparable): boolean {
  // Sans heure d'un côté, la date ne peut ni confirmer ni écarter : la géométrie décide.
  if (a.activityDate === null || b.activityDate === null) return true;
  const gapMin = Math.abs(Date.parse(a.activityDate) - Date.parse(b.activityDate)) / 60_000;
  return gapMin <= DUPLICATE_MAX_START_GAP_MIN;
}

function similarDistance(a: Comparable, b: Comparable): boolean {
  const longest = Math.max(a.distanceMeters, b.distanceMeters);
  if (longest === 0) return true;
  return Math.abs(a.distanceMeters - b.distanceMeters) / longest <= DUPLICATE_MAX_DISTANCE_GAP;
}

/** Part des points échantillonnés de `a` à moins de 50 m de la ligne de `b`. */
export function closeShare(a: Comparable, b: Comparable): number {
  if (a.profile.length === 0 || b.profile.length < 2) return 0;
  const line = lineString(b.profile.map(({ lat, lng }) => [lng, lat]));
  const step = Math.max(1, Math.floor(a.profile.length / DUPLICATE_SAMPLES));
  const samples = a.profile.filter((_, i) => i % step === 0);
  const close = samples.filter(
    ({ lat, lng }) =>
      pointToLineDistance(point([lng, lat]), line, { units: 'meters' }) <=
      DUPLICATE_MAX_TRACK_GAP_M,
  );
  return close.length / samples.length;
}

/** Proches dans le temps, la distance ET la géométrie : une trace voisine seule ne suffit pas. */
export function isProbableDuplicate(a: Comparable, b: Comparable): boolean {
  return (
    startsTogether(a, b) &&
    similarDistance(a, b) &&
    closeShare(a, b) >= DUPLICATE_MIN_CLOSE_SHARE &&
    closeShare(b, a) >= DUPLICATE_MIN_CLOSE_SHARE
  );
}

/** Même fichier = doublon exact ; sinon le premier doublon probable ; jamais de fusion. */
export function findDuplicate(
  draft: Comparable & Pick<ActivityDraft, 'fingerprint'>,
  existing: Activity[],
): DuplicateCheck {
  const exact = existing.find(({ fingerprint }) => fingerprint === draft.fingerprint);
  if (exact) return { status: 'exact', activityId: exact.id };
  const probable = existing.find((activity) => isProbableDuplicate(draft, activity));
  return probable ? { status: 'probable', activityId: probable.id } : { status: 'none' };
}
