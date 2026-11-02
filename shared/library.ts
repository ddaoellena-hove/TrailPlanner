import type { LibraryHike, Settings } from './schema';

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

export function filterLibraryHikes(hikes: LibraryHike[], filters: LibraryFilters): LibraryHike[] {
  const query = normalize(filters.query.trim());
  return hikes.filter(({ name, tags, stats, dogPolicy, outings, rating }) => {
    const done = outings.length > 0;
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

/** La médiane évite qu'une sortie très lente, ou une durée mal saisie, fausse le rythme. */
export function paceComparison(hikes: LibraryHike[]): PaceComparison | null {
  const ratios = hikes.flatMap(({ outings, stats }) =>
    stats.estimatedDurationMin > 0
      ? outings.flatMap(({ durationMin }) =>
          durationMin === undefined ? [] : [durationMin / stats.estimatedDurationMin],
        )
      : [],
  );
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
