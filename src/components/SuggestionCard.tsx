import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock,
  Compass,
  Mountain,
  Route,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DIFFICULTY_LABELS,
  UNCERTAINTY_LABELS,
} from '../../shared/escapade';
import {
  formatDuration,
  formatElevationGain,
  formatMeters,
} from '../../shared/format';
import type { SuggestionResult } from '../../shared/schema';

export function SuggestionCard({
  suggestion,
  active,
  feedbackVerdict,
  onSelect,
  onPrepare,
  onFeedback,
}: {
  suggestion: SuggestionResult;
  active: boolean;
  feedbackVerdict?: 'liked' | 'dismissed';
  onSelect: () => void;
  onPrepare: () => void;
  onFeedback: (verdict: 'liked' | 'dismissed') => void;
}) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${
        active ? 'border-primary ring-1 ring-primary/30' : 'hover:border-foreground/30'
      }`}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{suggestion.name}</CardTitle>
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums">
            {Math.round(suggestion.scores.total * 100)} / 100
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant={suggestion.sourceType === 'osm_relation' ? 'secondary' : 'outline'}>
            {suggestion.sourceType === 'osm_relation' ? 'Balisée OSM' : 'Boucle générée OSM'}
          </Badge>
          <Badge variant="outline">{DIFFICULTY_LABELS[suggestion.difficulty]}</Badge>
          {suggestion.noveltyStatus === 'new' && (
            <Badge variant="secondary">Nouvelle</Badge>
          )}
          {suggestion.noveltyStatus === 'done_before' && (
            <Badge variant="outline">Déjà parcourue</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 pt-0 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <Route className="size-3.5" aria-hidden />
            {formatMeters(suggestion.distanceMeters)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Mountain className="size-3.5" aria-hidden />
            {suggestion.elevationGainMeters !== null
              ? formatElevationGain(suggestion.elevationGainMeters)
              : 'D+ inconnu'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {formatDuration(suggestion.estimatedDurationMin)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Car className="size-3.5" aria-hidden />
            ~{suggestion.estimatedDriveMin} min
          </span>
          <span>{Math.round(suggestion.pavedRatio * 100)} % bitume</span>
        </div>

        {suggestion.explanation.positives.length > 0 && (
          <ul className="grid gap-1 text-xs">
            {suggestion.explanation.positives.slice(0, 3).map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {suggestion.explanation.tradeoffs.length > 0 && (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {suggestion.explanation.tradeoffs.slice(0, 2).map((item) => (
              <li key={item} className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {suggestion.explanation.uncertainties.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestion.explanation.uncertainties.map((code) => (
              <span
                key={code}
                title={UNCERTAINTY_LABELS[code]}
                className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300"
              >
                <AlertTriangle className="size-3 shrink-0" aria-hidden />
                {code === 'DOG_ACCESS_UNKNOWN'
                  ? 'Chien à vérifier'
                  : code === 'OSM_SURFACE_INCOMPLETE'
                    ? 'Surface partielle'
                    : code === 'RESERVE_REGULATION_CHECK'
                      ? 'Zone protégée'
                      : code === 'OSM_GEOMETRY_INCOMPLETE'
                        ? 'Tracé discontinu'
                        : code === 'ELEVATION_MISSING'
                          ? 'D+ absent'
                          : 'Accès restreint'}
              </span>
            ))}
          </div>
        )}

        <div
          className="flex items-center justify-between gap-2 border-t pt-2.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button type="button" size="sm" onClick={onPrepare}>
            <Compass className="size-4" aria-hidden />
            Préparer l’escapade
          </Button>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              className="size-8"
              variant={feedbackVerdict === 'liked' ? 'secondary' : 'ghost'}
              aria-label="J’aime cette boucle"
              title="J’aime cette boucle"
              onClick={() => onFeedback('liked')}
            >
              <ThumbsUp className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-8"
              variant={feedbackVerdict === 'dismissed' ? 'destructive' : 'ghost'}
              aria-label="Écarter cette boucle"
              title="Écarter cette boucle"
              onClick={() => onFeedback('dismissed')}
            >
              <ThumbsDown className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
