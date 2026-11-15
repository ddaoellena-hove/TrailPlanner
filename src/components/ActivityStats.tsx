import { Footprints, Mountain, Timer, TrendingDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StatBadge, type StatTone, TONE_ICON_CLASSES } from '@/components/StatBadge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  formatElevationGain,
  formatMeters,
  formatSeconds,
} from '../../shared/format';
import type { ActivityDraft, ActivitySource } from '../../shared/schema';

export const SOURCE_LABELS: Record<ActivitySource, string> = {
  alltrails: 'AllTrails',
  gpx: 'GPX',
};

export function SourceBadge({ source }: { source: ActivitySource }) {
  return (
    <Badge variant="outline" title={source === 'gpx' ? "Le fichier n'indique pas AllTrails" : undefined}>
      {SOURCE_LABELS[source]}
    </Badge>
  );
}

/** Pastilles compactes de la liste. Une valeur inconnue est dite, jamais remplacée. */
export function ActivityBadges({ activity }: { activity: ActivityDraft }) {
  return (
    <>
      <StatBadge icon={Footprints} tone="distance">
        {formatMeters(activity.distanceMeters)}
      </StatBadge>
      <StatBadge icon={Mountain} tone="ascent">
        {activity.elevationGainMeters === null
          ? 'D+ inconnu'
          : formatElevationGain(activity.elevationGainMeters)}
      </StatBadge>
      <StatBadge icon={Timer} tone="duration">
        {activity.durationSeconds === null ? 'Durée inconnue' : formatSeconds(activity.durationSeconds)}
      </StatBadge>
    </>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  tone: StatTone;
  label: string;
  value: string | null;
  note: string;
}) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn('flex size-5 items-center justify-center rounded', TONE_ICON_CLASSES[tone])}>
          <Icon className="size-3" aria-hidden />
        </span>
        {label}
      </dt>
      <dd className={cn('text-lg font-semibold tabular-nums', value === null && 'text-muted-foreground')}>
        {value ?? 'Inconnu'}
      </dd>
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

/** Mesures détaillées, avec leur origine : calculées depuis la trace, ou inconnues. */
export function ActivityStats({ activity }: { activity: ActivityDraft }) {
  const elevationKnown = activity.elevationGainMeters !== null;
  return (
    <dl className="grid grid-cols-2 gap-2">
      <Stat
        icon={Footprints}
        tone="distance"
        label="Distance"
        value={formatMeters(activity.distanceMeters)}
        note={
          activity.segmentCount > 1
            ? `Calculée, ${activity.segmentCount} segments sans les écarts`
            : 'Calculée depuis la trace'
        }
      />
      <Stat
        icon={Timer}
        tone="duration"
        label="Durée totale"
        value={activity.durationSeconds === null ? null : formatSeconds(activity.durationSeconds)}
        note={
          activity.durationSeconds === null
            ? 'Heures absentes ou incohérentes dans le fichier'
            : 'Calculée, pauses comprises'
        }
      />
      <Stat
        icon={Mountain}
        tone="ascent"
        label="Dénivelé positif"
        value={elevationKnown ? `${activity.elevationGainMeters} m` : null}
        note={elevationKnown ? 'Calculé, altitudes lissées' : 'Pas d’altitude dans le fichier'}
      />
      <Stat
        icon={TrendingDown}
        tone="ascent"
        label="Dénivelé négatif"
        value={elevationKnown ? `${activity.elevationLossMeters} m` : null}
        note={elevationKnown ? 'Calculé, altitudes lissées' : 'Pas d’altitude dans le fichier'}
      />
    </dl>
  );
}
