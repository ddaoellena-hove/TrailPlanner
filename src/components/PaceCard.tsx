import { useQueryClient } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSaveSettings, useSettings } from '@/lib/hooks';
import { MIN_OUTINGS_FOR_PACE, paceComparison, suggestPace } from '../../shared/library';
import type { LibraryHike } from '../../shared/schema';

function comparisonText(ratio: number, outingCount: number): string {
  const gap = Math.round(Math.abs(ratio - 1) * 100);
  const sample = `sur ${outingCount} ${outingCount > 1 ? 'sorties' : 'sortie'}`;
  if (gap === 0) return `Votre rythme correspond aux estimations, ${sample}.`;
  return `Vous marchez ${gap} % plus ${ratio < 1 ? 'vite' : 'lentement'} que prévu, ${sample}.`;
}

/** Prévu contre réel. Le rythme ne change que sur un clic. */
export function PaceCard({ hikes }: { hikes: LibraryHike[] }) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const comparison = paceComparison(hikes);
  const pace = suggestPace(settings.pace, comparison);
  const count = comparison?.outingCount ?? 0;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
        <p className="flex items-center gap-2">
          <Gauge className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {comparison
            ? comparisonText(comparison.ratio, count)
            : 'Enregistrez la durée de vos sorties pour comparer le prévu au réel.'}
          {count > 0 && count < MIN_OUTINGS_FOR_PACE && (
            <span className="text-muted-foreground">
              Ajustement proposé dès {MIN_OUTINGS_FOR_PACE} sorties.
            </span>
          )}
        </p>
        {pace && (
          <Button
            size="sm"
            variant="outline"
            disabled={saveSettings.isPending}
            onClick={() =>
              saveSettings.mutate(
                { ...settings, pace },
                { onSuccess: () => queryClient.invalidateQueries() },
              )
            }
          >
            Ajuster mon rythme
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
