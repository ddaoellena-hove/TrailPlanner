import { BatteryMedium, Car } from 'lucide-react';
import { TRAIL_TO_STAY_COLOR } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { type BatteryStep, isBelowReserve } from '../../shared/battery';
import { formatDuration, formatKm } from '../../shared/format';
import type { ItineraryLeg } from '../../shared/schema';

/** Trajets dérivés de la timeline : affichés entre les étapes, jamais déplaçables. */
export function LegRows({
  legs,
  battery,
}: {
  legs: ItineraryLeg[];
  battery: BatteryStep[] | null;
}) {
  return legs.map((leg) => {
    const step = battery?.find((candidate) => candidate.leg === leg);
    return (
      <li
        key={`${leg.fromName}-${leg.toName}`}
        className="flex items-center gap-2 pl-5 text-xs text-muted-foreground tabular-nums"
      >
        <Car
          className="size-3.5 shrink-0"
          style={leg.trailToStay ? { color: TRAIL_TO_STAY_COLOR } : undefined}
          aria-hidden
        />
        <span className="min-w-0 truncate">
          {formatDuration(leg.durationMin)} · {formatKm(leg.distanceKm)} vers {leg.toName}
          {leg.source === 'straight-line-fallback' && ' (estimé)'}
        </span>
        {step && (
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-1',
              isBelowReserve(step) && 'font-medium text-tone-warning',
            )}
          >
            <BatteryMedium className="size-3.5" aria-hidden />
            {Math.round(step.fromPercent)} % → {Math.round(step.toPercent)} %
          </span>
        )}
      </li>
    );
  });
}
