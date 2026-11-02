import { ChevronDown, Footprints, Plus, X } from 'lucide-react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BOOKING_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { formatDuration, formatElevationGain, formatKm } from '../../shared/format';
import type { Day, Settings, Trip } from '../../shared/schema';
import { type DayTotals, loadRatio } from '../../shared/totals';
import { nightOf } from '../../shared/trip';

const AUTO_NIGHT = 'auto';

function LoadBar({
  label,
  minutes,
  maxHours,
}: {
  label: string;
  minutes: number;
  maxHours: number | undefined;
}) {
  const ratio = loadRatio(minutes, maxHours);
  if (ratio === null) return null;
  return (
    <div className="grid grid-cols-[4rem_1fr_auto] items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span>{label}</span>
      <div
        role="meter"
        aria-label={`${label} : part du seuil`}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', ratio > 1 ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
      <span>
        {formatDuration(minutes)} / {maxHours} h
      </span>
    </div>
  );
}

/** En-tête détaillé d'un jour : titre, totaux, charge, replis et notes. */
export function DaySummary({
  trip,
  day,
  totals,
  thresholds,
  onChange,
}: {
  trip: Trip;
  day: Day;
  totals: DayTotals;
  thresholds: Settings['thresholds'];
  onChange: (
    changes: Partial<Pick<Day, 'title' | 'notes' | 'backupHikeIds' | 'nightPlaceId'>>,
  ) => void;
}) {
  const backups = trip.hikes.filter(({ id }) => day.backupHikeIds.includes(id));
  const candidates = trip.hikes.filter(({ id }) => !day.backupHikeIds.includes(id));
  const isLastDay = day.index === trip.days.at(-1)?.index;
  const night = nightOf(trip, day);
  const lodgings = trip.places.filter(({ type }) => type === 'lodging');
  const nightOptions: Record<string, string> = {
    [AUTO_NIGHT]: 'Dernier séjour du jour',
    ...Object.fromEntries(lodgings.map(({ id, name }) => [id, name])),
  };

  return (
    <div className="grid gap-2">
      <Input
        key={day.title}
        aria-label={`Titre du jour ${day.index}`}
        placeholder="Titre du jour"
        defaultValue={day.title}
        className="h-8 border-transparent bg-transparent px-2 -ml-2 shadow-none hover:border-input"
        onBlur={(event) => {
          const title = event.target.value.trim() || undefined;
          if (title !== day.title) onChange({ title });
        }}
      />

      <p className="text-sm text-muted-foreground tabular-nums">
        {formatKm(totals.hikingKm)} · {formatElevationGain(totals.elevationGainM)} ·{' '}
        {formatDuration(totals.hikingMin)} de marche · {formatDuration(totals.drivingMin)} de route
        · fin ≈ {totals.estimatedEndTime}
      </p>

      {!isLastDay && (
        <div className="grid gap-1">
          <LabeledSelect
            id={`night-${day.index}`}
            label={`Nuit du J${day.index}`}
            value={day.nightPlaceId ?? AUTO_NIGHT}
            options={nightOptions}
            onChange={(value) =>
              onChange({ nightPlaceId: value === AUTO_NIGHT ? undefined : value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {night
              ? `${night.name}${night.bookingStatus ? ` · ${BOOKING_LABELS[night.bookingStatus]}` : ''}`
              : 'Aucune nuit définie'}
          </p>
        </div>
      )}

      <LoadBar
        label="Marche"
        minutes={totals.hikingMin}
        maxHours={thresholds.maxHikingHoursPerDay}
      />
      <LoadBar
        label="Route"
        minutes={totals.drivingMin}
        maxHours={thresholds.maxDrivingHoursPerDay}
      />

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-3 h-7 text-muted-foreground">
            <ChevronDown
              className="transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
            Replis{backups.length > 0 && ` (${backups.length})`} et notes
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2 pt-1">
          {backups.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {backups.map((hike) => (
                <li key={hike.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <Footprints className="size-3.5 shrink-0" aria-hidden />
                    {hike.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Retirer le repli ${hike.name}`}
                    onClick={() =>
                      onChange({
                        backupHikeIds: day.backupHikeIds.filter((id) => id !== hike.id),
                      })
                    }
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={candidates.length === 0}
              >
                <Plus aria-hidden />
                Ajouter un repli
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {candidates.map((hike) => (
                <DropdownMenuItem
                  key={hike.id}
                  onSelect={() => onChange({ backupHikeIds: [...day.backupHikeIds, hike.id] })}
                >
                  {hike.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Textarea
            key={day.notes}
            aria-label={`Notes du jour ${day.index}`}
            placeholder="Notes"
            defaultValue={day.notes}
            onBlur={(event) => {
              const notes = event.target.value.trim() || undefined;
              if (notes !== day.notes) onChange({ notes });
            }}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
