import { Car } from 'lucide-react';
import { TRAIL_TO_STAY_COLOR } from '@/lib/labels';
import { formatDuration, formatKm } from '../../shared/format';
import type { ItineraryLeg } from '../../shared/schema';

/** Trajets dérivés de la timeline : affichés entre les étapes, jamais déplaçables. */
export function LegRows({ legs }: { legs: ItineraryLeg[] }) {
  return legs.map((leg) => (
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
    </li>
  ));
}
