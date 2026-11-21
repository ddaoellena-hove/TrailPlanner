import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  CalendarPlus,
  Car,
  Clock,
  Footprints,
  Home,
  Info,
  Landmark,
  Mountain,
  Route,
} from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useBonusStops } from '@/lib/hooks';
import {
  assembleEscapadeTimeline,
  BONUS_CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  DOG_POLICY_LABELS,
  UNCERTAINTY_LABELS,
} from '../../shared/escapade';
import {
  formatClock,
  formatDuration,
  formatElevationGain,
  formatKm,
  formatMeters,
} from '../../shared/format';
import type {
  BonusStop,
  EscapadeOrigin,
  EscapadeTimelineItem,
  SuggestionResult,
} from '../../shared/schema';

export type EscapadeDraft = {
  id?: string;
  title: string;
  origin: EscapadeOrigin;
  startTime: string;
  suggestion: SuggestionResult;
  bonusStop: BonusStop | null;
  bonusDurationMin: number;
  notes: string;
};

const BONUS_DURATION_CHOICES = [30, 45, 60, 90] as const;

function TimelineIcon({ kind }: { kind: EscapadeTimelineItem['kind'] }) {
  switch (kind) {
    case 'origin':
      return <Home className="size-3.5 text-primary" aria-hidden />;
    case 'approach':
    case 'bonus-drive':
    case 'return':
      return <Car className="size-3.5 text-muted-foreground" aria-hidden />;
    case 'anchor':
      return <Footprints className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden />;
    case 'bonus-visit':
      return <Landmark className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />;
  }
}

export function EscapadePreparePanel({
  draft,
  variants,
  isSaving,
  onChange,
  onSelectVariant,
  onBack,
  onSave,
  onOpenAddToTrip,
}: {
  draft: EscapadeDraft;
  variants: SuggestionResult[];
  isSaving: boolean;
  onChange: (next: EscapadeDraft) => void;
  onSelectVariant: (variant: SuggestionResult) => void;
  onBack: () => void;
  onSave: () => void;
  onOpenAddToTrip: () => void;
}) {
  const bonusStops = useBonusStops(draft.suggestion.start, draft.origin.location);

  const assembled = useMemo(
    () =>
      assembleEscapadeTimeline({
        origin: draft.origin,
        startTime: draft.startTime,
        suggestion: draft.suggestion,
        bonusStop: draft.bonusStop,
        bonusDurationMin: draft.bonusDurationMin,
      }),
    [draft],
  );

  // Merge currently selected bonus stop (if loaded from a saved escapade) with live catalog candidates.
  const bonusOptions = useMemo(() => {
    const list = bonusStops.data ?? [];
    if (draft.bonusStop && !list.some((b) => b.placeId === draft.bonusStop?.placeId)) {
      return [draft.bonusStop, ...list];
    }
    return list;
  }, [bonusStops.data, draft.bonusStop]);

  const otherVariants = useMemo(
    () => variants.filter((v) => v.trailId !== draft.suggestion.trailId).slice(0, 4),
    [variants, draft.suggestion.trailId],
  );

  return (
    <div className="grid gap-5 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Retour
        </Button>
        <Badge variant="secondary">Préparer l’escapade</Badge>
      </div>

      {/* Titre & résumé de la boucle ancre */}
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="escapade-title">Titre de l’escapade</Label>
          <Input
            id="escapade-title"
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1 font-medium">
            <Route className="size-3.5" aria-hidden />
            {formatMeters(draft.suggestion.distanceMeters)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Mountain className="size-3.5" aria-hidden />
            {draft.suggestion.elevationGainMeters !== null
              ? formatElevationGain(draft.suggestion.elevationGainMeters)
              : 'D+ inconnu'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {formatDuration(draft.suggestion.estimatedDurationMin)}
          </span>
          <Badge variant="outline" className="text-[11px]">
            {DIFFICULTY_LABELS[draft.suggestion.difficulty]}
          </Badge>
          <Badge variant="outline" className="text-[11px]">
            {DOG_POLICY_LABELS[draft.suggestion.dogPolicy]}
          </Badge>
        </div>
      </div>

      {/* Chronologie porte-à-porte */}
      <section className="grid gap-3" aria-label="Chronologie porte-à-porte">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Chronologie porte-à-porte</h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="escapade-start-time" className="text-xs text-muted-foreground">
              Départ
            </Label>
            <Input
              id="escapade-start-time"
              type="time"
              className="h-8 w-28 text-xs"
              value={draft.startTime}
              onChange={(event) =>
                event.target.value && onChange({ ...draft, startTime: event.target.value })
              }
            />
          </div>
        </div>

        <ol className="grid gap-2 border-l-2 border-muted pl-3">
          {assembled.timeline.map((item, idx) => (
            <li key={`${item.kind}-${idx}`} className="flex items-start justify-between gap-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  <TimelineIcon kind={item.kind} />
                </span>
                <div>
                  <p className="font-medium leading-snug">{item.label}</p>
                  <p className="text-muted-foreground">
                    {item.durationMin > 0 ? formatDuration(item.durationMin) : 'Point de départ'}
                    {item.distanceKm !== undefined ? ` · ${formatKm(item.distanceKm)}` : ''}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {item.durationMin > 0
                  ? `${formatClock(item.startMin)} → ${formatClock(item.endMin)}`
                  : formatClock(item.startMin)}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span>
            Route totale :{' '}
            <strong className="font-medium">{formatDuration(assembled.totalDriveMin)}</strong>
          </span>
          <span>
            Durée totale :{' '}
            <strong className="font-medium">{formatDuration(assembled.totalDurationMin)}</strong>
          </span>
        </div>
      </section>

      {/* Étape bonus (< 15 min de détour) */}
      <section className="grid gap-2.5" aria-label="Étape bonus">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Étape bonus (&lt; 15 min de détour)</h2>
          {draft.bonusStop && (
            <div className="flex items-center gap-1">
              {BONUS_DURATION_CHOICES.map((mins) => (
                <Button
                  key={mins}
                  type="button"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  variant={draft.bonusDurationMin === mins ? 'secondary' : 'ghost'}
                  onClick={() => onChange({ ...draft, bonusDurationMin: mins })}
                >
                  {mins} min
                </Button>
              ))}
            </div>
          )}
        </div>

        {bonusStops.isPending && <Skeleton className="h-16 w-full" />}

        {!bonusStops.isPending && (
          <div className="grid gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ ...draft, bonusStop: null })}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                draft.bonusStop === null
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'hover:bg-muted/50'
              }`}
            >
              <span>Aucune étape bonus (retour direct)</span>
              <span className="text-muted-foreground">+0 min</span>
            </button>

            {bonusOptions.map((stop) => {
              const selected = draft.bonusStop?.placeId === stop.placeId;
              return (
                <button
                  key={stop.placeId}
                  type="button"
                  onClick={() => onChange({ ...draft, bonusStop: stop })}
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    selected ? 'border-amber-600 bg-amber-500/10' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{stop.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {BONUS_CATEGORY_LABELS[stop.category]} · à {formatKm(stop.distanceFromTrailKm)} du
                      départ
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 tabular-nums text-[11px]">
                    +{stop.detourMin} min
                  </Badge>
                </button>
              );
            })}

            {bonusOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune étape bonus cataloguée à moins de 15 min de détour autour de ce départ.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Variantes à proximité */}
      {otherVariants.length > 0 && (
        <section className="grid gap-2" aria-label="Variantes">
          <h2 className="text-sm font-semibold">Variantes de la recherche</h2>
          <div className="flex flex-wrap gap-1.5">
            {otherVariants.map((variant) => (
              <Button
                key={variant.trailId}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto py-1 text-xs"
                onClick={() => onSelectVariant(variant)}
              >
                {variant.name} ({formatMeters(variant.distanceMeters)})
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* Incertitudes & provenance */}
      <section className="grid gap-2 text-xs">
        {draft.suggestion.explanation.uncertainties.length > 0 && (
          <div className="grid gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-900 dark:text-amber-200">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5" aria-hidden />
              Points à vérifier sur place
            </p>
            <ul className="grid gap-0.5 pl-5 list-disc">
              {draft.suggestion.explanation.uncertainties.map((code) => (
                <li key={code}>{UNCERTAINTY_LABELS[code]}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span>
            Sources : {draft.suggestion.provenance.sources.join(' · ')} (catalogue{' '}
            {draft.suggestion.provenance.snapshotId})
          </span>
        </p>
      </section>

      {/* Notes */}
      <div className="grid gap-1.5">
        <Label htmlFor="escapade-notes" className="text-xs">
          Notes personnelles (facultatif)
        </Label>
        <Textarea
          id="escapade-notes"
          rows={2}
          placeholder="Ex. parking près de l’église, boulangerie sur le retour..."
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button type="button" className="flex-1" disabled={isSaving || !draft.title.trim()} onClick={onSave}>
          <Bookmark className="size-4" aria-hidden />
          {isSaving
            ? 'Enregistrement...'
            : draft.id
              ? 'Mettre à jour l’escapade'
              : 'Enregistrer l’escapade'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSaving || !draft.title.trim()}
          onClick={onOpenAddToTrip}
        >
          <CalendarPlus className="size-4" aria-hidden />
          Ajouter à un voyage
        </Button>
      </div>
    </div>
  );
}
