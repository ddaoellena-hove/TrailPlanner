export const HISTORY_LIMIT = 50;

export type History<T> = { past: T[]; future: T[] };

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/** Mémorise `current` avant une modification ; toute modification efface le « rétablir ». */
export function record<T>(history: History<T>, current: T): History<T> {
  return { past: [...history.past, current].slice(-HISTORY_LIMIT), future: [] };
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  const value = history.past.at(-1);
  if (value === undefined) return null;
  return {
    value,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
  };
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  const [value, ...future] = history.future;
  if (value === undefined) return null;
  return { value, history: { past: [...history.past, current], future } };
}
