import type { Activity, LibraryHike, Settings } from './schema';

/** Sorties enregistrées liées à cette rando prévue. */
export function linkedActivities<T extends Pick<Activity, 'linkedRouteId'>>(
  hike: Pick<LibraryHike, 'id'>,
  activities: T[],
): T[] {
  return activities.filter(({ linkedRouteId }) => linkedRouteId === hike.id);
}

/** Fois où la rando a été faite : sorties saisies à la main et sorties enregistrées liées. */
export function timesDone(
  hike: Pick<LibraryHike, 'id' | 'outings'>,
  activities: Pick<Activity, 'linkedRouteId'>[],
): number {
  return hike.outings.length + linkedActivities(hike, activities).length;
}

export type LibraryFilters = {
  query: string;
  status: 'all' | 'done' | 'todo';
  /** Écarte les randos interdites aux chiens. */
  withDog: boolean;
  minRating: number;
  maxKm: number | null;
  maxElevationGainM: number | null;
};

export const NO_FILTERS: LibraryFilters = {
  query: '',
  status: 'all',
  withDog: false,
  minRating: 0,
  maxKm: null,
  maxElevationGainM: null,
};

/** Sans accents ni casse : « ecrins » retrouve « Écrins ». */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function filterLibraryHikes(
  hikes: LibraryHike[],
  filters: LibraryFilters,
  activities: Pick<Activity, 'linkedRouteId'>[] = [],
): LibraryHike[] {
  const query = normalize(filters.query.trim());
  return hikes.filter((hike) => {
    const { name, tags, stats, dogPolicy, rating } = hike;
    const done = timesDone(hike, activities) > 0;
    return (
      normalize([name, ...(tags ?? [])].join(' ')).includes(query) &&
      (filters.status === 'all' || done === (filters.status === 'done')) &&
      !(filters.withDog && dogPolicy === 'forbidden') &&
      (rating ?? 0) >= filters.minRating &&
      (filters.maxKm === null || stats.distanceKm <= filters.maxKm) &&
      (filters.maxElevationGainM === null ||
        (stats.elevationGainM ?? 0) <= filters.maxElevationGainM)
    );
  });
}

export type PaceComparison = {
  /** Médiane de durée réelle / durée estimée : sous 1, vous marchez plus vite que prévu. */
  ratio: number;
  outingCount: number;
};

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * La médiane évite qu'une sortie très lente, ou une durée mal saisie, fausse le rythme.
 * Une sortie enregistrée liée compte avec sa durée totale, pauses comprises, comme une
 * durée saisie à la main.
 */
export function paceComparison(
  hikes: LibraryHike[],
  activities: Pick<Activity, 'linkedRouteId' | 'durationSeconds'>[] = [],
): PaceComparison | null {
  const ratios = hikes.flatMap((hike) => {
    const estimated = hike.stats.estimatedDurationMin;
    if (estimated <= 0) return [];
    const durations = [
      ...hike.outings.flatMap(({ durationMin }) => (durationMin === undefined ? [] : [durationMin])),
      ...linkedActivities(hike, activities).flatMap(({ durationSeconds }) =>
        durationSeconds === null ? [] : [durationSeconds / 60],
      ),
    ];
    return durations.map((minutes) => minutes / estimated);
  });
  return ratios.length > 0 ? { ratio: median(ratios), outingCount: ratios.length } : null;
}

export const MIN_OUTINGS_FOR_PACE = 3;
const MIN_PACE_GAP = 0.03;

/** Ajuste `breakFactor`, seul multiplicateur global du rythme. Null sans écart assez fiable. */
export function suggestPace(
  pace: Settings['pace'],
  comparison: PaceComparison | null,
): Settings['pace'] | null {
  if (!comparison || comparison.outingCount < MIN_OUTINGS_FOR_PACE) return null;
  if (Math.abs(comparison.ratio - 1) < MIN_PACE_GAP) return null;
  return { ...pace, breakFactor: Math.round(pace.breakFactor * comparison.ratio * 100) / 100 };
}
