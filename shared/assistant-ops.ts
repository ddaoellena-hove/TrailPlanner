import { z } from 'zod';
import type { Trip } from './schema';
import { moveStop, planHike, removeStop, setStopStartTime, updateDay } from './trip';

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DayIndexSchema = z.number().int().positive();

/** Seules modifications possibles : l'assistant ne peut rien faire d'autre. */
export const AssistantOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('move_stop'),
    stopId: z.string(),
    dayIndex: DayIndexSchema,
    position: z.number().int().nonnegative(),
  }),
  z.object({
    op: z.literal('plan_hike'),
    hikeId: z.string(),
    dayIndex: DayIndexSchema,
    position: z.number().int().nonnegative(),
  }),
  z.object({ op: z.literal('remove_stop'), stopId: z.string() }),
  z.object({
    op: z.literal('set_start_time'),
    stopId: z.string(),
    startTime: TimeSchema.nullable(),
  }),
  z.object({ op: z.literal('set_night'), dayIndex: DayIndexSchema, placeId: z.string().nullable() }),
  z.object({ op: z.literal('set_day_title'), dayIndex: DayIndexSchema, title: z.string().min(1) }),
  z.object({ op: z.literal('add_backup'), dayIndex: DayIndexSchema, hikeId: z.string() }),
  z.object({ op: z.literal('add_checklist_item'), label: z.string().min(1) }),
]);
export type AssistantOp = z.infer<typeof AssistantOpSchema>;

export type ApplyResult =
  | { ok: true; trip: Trip; descriptions: string[] }
  | { ok: false; error: string };

function stopName(trip: Trip, stopId: string): string | undefined {
  const stop = trip.days.flatMap((day) => day.stops).find(({ id }) => id === stopId);
  if (!stop) return undefined;
  const name =
    stop.kind === 'hike'
      ? trip.hikes.find(({ id }) => id === stop.hikeId)?.name
      : trip.places.find(({ id }) => id === stop.placeId)?.name;
  return name ?? 'Étape';
}

function applyOp(trip: Trip, op: AssistantOp): { trip: Trip; description: string } | string {
  const day = 'dayIndex' in op ? trip.days.find(({ index }) => index === op.dayIndex) : undefined;
  if ('dayIndex' in op && !day) return `Jour inconnu : J${op.dayIndex}`;
  const name = 'stopId' in op ? stopName(trip, op.stopId) : undefined;
  if ('stopId' in op && name === undefined) return `Étape inconnue : ${op.stopId}`;
  const hike = 'hikeId' in op ? trip.hikes.find(({ id }) => id === op.hikeId) : undefined;
  if ('hikeId' in op && !hike) return `Rando inconnue : ${op.hikeId}`;

  switch (op.op) {
    case 'move_stop':
      return {
        trip: moveStop(trip, op.stopId, op.dayIndex, op.position),
        description: `Déplacer ${name} au J${op.dayIndex}`,
      };
    case 'plan_hike': {
      const planned = planHike(trip, op.dayIndex, op.hikeId);
      const stopId = planned.days[op.dayIndex - 1]?.stops.at(-1)?.id ?? '';
      return {
        trip: moveStop(planned, stopId, op.dayIndex, op.position),
        description: `Planifier ${hike?.name} au J${op.dayIndex}`,
      };
    }
    case 'remove_stop':
      return { trip: removeStop(trip, op.stopId), description: `Retirer ${name}` };
    case 'set_start_time': {
      const stop = trip.days.flatMap((d) => d.stops).find(({ id }) => id === op.stopId);
      if (stop?.kind !== 'hike') return `Pas une rando : ${name}`;
      return {
        trip: setStopStartTime(trip, op.stopId, op.startTime ?? undefined),
        description: op.startTime
          ? `Partir à ${op.startTime} pour ${name}`
          : `Heure de départ automatique pour ${name}`,
      };
    }
    case 'set_night': {
      const place = trip.places.find(({ id }) => id === op.placeId);
      if (op.placeId && place?.type !== 'lodging') return `Hébergement inconnu : ${op.placeId}`;
      return {
        trip: updateDay(trip, op.dayIndex, { nightPlaceId: op.placeId ?? undefined }),
        description: place
          ? `Nuit du J${op.dayIndex} : ${place.name}`
          : `Nuit du J${op.dayIndex} : dernier séjour du jour`,
      };
    }
    case 'set_day_title':
      return {
        trip: updateDay(trip, op.dayIndex, { title: op.title }),
        description: `Titre du J${op.dayIndex} : ${op.title}`,
      };
    case 'add_backup':
      return {
        trip: updateDay(trip, op.dayIndex, {
          backupHikeIds: [...new Set([...(day?.backupHikeIds ?? []), op.hikeId])],
        }),
        description: `Repli du J${op.dayIndex} : ${hike?.name}`,
      };
    case 'add_checklist_item':
      return {
        trip: {
          ...trip,
          checklist: [
            ...(trip.checklist ?? []),
            { id: crypto.randomUUID(), label: op.label, done: false },
          ],
        },
        description: `Ajouter à la checklist : ${op.label}`,
      };
  }
}

/** Applique des opérations sur une copie. Une seule invalide annule tout. */
export function applyOps(trip: Trip, ops: AssistantOp[]): ApplyResult {
  let current = trip;
  const descriptions: string[] = [];
  for (const op of ops) {
    const result = applyOp(current, op);
    if (typeof result === 'string') return { ok: false, error: result };
    current = result.trip;
    descriptions.push(result.description);
  }
  return { ok: true, trip: current, descriptions };
}
