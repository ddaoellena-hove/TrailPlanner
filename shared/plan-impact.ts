import { z } from 'zod';
import { computeAlerts } from './alerts';
import { AssistantOpSchema } from './assistant-ops';
import { deriveLegs, routeCacheKey, straightLineLeg } from './itinerary';
import type { DriveLeg, ItineraryLeg, Settings, Trip } from './schema';
import { dayTotals, type DayTotals } from './totals';

const DayFiguresSchema = z.object({
  hikingKm: z.number(),
  elevationGainM: z.number(),
  hikingMin: z.number(),
  drivingMin: z.number(),
  end: z.string(),
});
type DayFigures = z.infer<typeof DayFiguresSchema>;

export const PlanImpactSchema = z.object({
  days: z.array(
    z.object({ dayIndex: z.number(), before: DayFiguresSchema, after: DayFiguresSchema }),
  ),
  alertsResolved: z.array(z.string()),
  alertsAdded: z.array(z.string()),
});
export type PlanImpact = z.infer<typeof PlanImpactSchema>;

export const ProposalSchema = z.object({
  summary: z.string(),
  ops: z.array(AssistantOpSchema),
  descriptions: z.array(z.string()),
  impact: PlanImpactSchema,
  basedOn: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** Trajets d'un planning, depuis le cache de routage, ou estimés s'ils sont nouveaux. */
export function estimateLegs(trip: Trip, cache: Record<string, DriveLeg>): ItineraryLeg[] {
  return deriveLegs(trip).map(({ from, to, ...names }) => ({
    ...(cache[routeCacheKey({ from, to })] ?? straightLineLeg({ from, to })),
    ...names,
  }));
}

function figures(totals: DayTotals): DayFigures {
  return {
    hikingKm: Math.round(totals.hikingKm * 10) / 10,
    elevationGainM: Math.round(totals.elevationGainM),
    hikingMin: Math.round(totals.hikingMin),
    drivingMin: Math.round(totals.drivingMin),
    end: totals.estimatedEndTime,
  };
}

/** Ce que change un planning : jours modifiés, alertes résolues et créées. */
export function planImpact(
  before: Trip,
  after: Trip,
  cache: Record<string, DriveLeg>,
  settings: Settings,
): PlanImpact {
  const legsBefore = estimateLegs(before, cache);
  const legsAfter = estimateLegs(after, cache);
  const days = after.days.flatMap((day) => {
    const previous = before.days.find(({ index }) => index === day.index);
    if (!previous) return [];
    const was = figures(dayTotals(before, previous, legsBefore, settings.dayStartTime));
    const now = figures(dayTotals(after, day, legsAfter, settings.dayStartTime));
    return JSON.stringify(was) === JSON.stringify(now)
      ? []
      : [{ dayIndex: day.index, before: was, after: now }];
  });
  const messages = (trip: Trip, legs: ItineraryLeg[]) =>
    new Set(
      computeAlerts(trip, legs, settings)
        .filter(({ code }) => code !== 'A7')
        .map(({ message }) => message),
    );
  const was = messages(before, legsBefore);
  const now = messages(after, legsAfter);
  return {
    days,
    alertsResolved: [...was].filter((message) => !now.has(message)),
    alertsAdded: [...now].filter((message) => !was.has(message)),
  };
}
