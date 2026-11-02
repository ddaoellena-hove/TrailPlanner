import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LabeledSelect } from '@/components/HikeSelects';
import { api } from '@/lib/api';
import { ASSISTANT_LABELS } from '@/lib/labels';
import {
  CHARGING_NETWORKS,
  DEFAULT_FAVORITE_NETWORKS,
  NETWORKS_NOT_IN_IRVE,
} from '../../shared/charging-networks';
import { formatDuration } from '../../shared/format';
import { estimateDurationMin } from '../../shared/gpx';
import type { Health, Settings } from '../../shared/schema';
import { SettingsSchema } from '../../shared/schema';

const PACE_FIELDS = [
  ['flatKmh', 'Allure à plat (km/h)', '0.1'],
  ['ascentMPerH', 'Montée (m/h)', '10'],
  ['descentMPerH', 'Descente (m/h)', '10'],
  ['breakFactor', 'Facteur de pauses', '0.05'],
] as const;

const THRESHOLD_FIELDS = [
  ['maxHikingHoursPerDay', 'Marche max (h/jour)'],
  ['maxElevationGainPerDay', 'D+ max (m/jour)'],
  ['maxDrivingHoursPerDay', 'Route max (h/jour)'],
  ['maxTotalActiveHoursPerDay', 'Marche + route max (h/jour)'],
] as const;

const KEY_STATUS: Record<Health['ors'], string> = {
  configured: 'OK',
  missing: 'Manquante',
  invalid: 'Invalide',
};

/** Montant par défaut de l'avertissement de coût de l'assistant. */
export const DEFAULT_ASSISTANT_BUDGET_USD = 1;

function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

export function SettingsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: api.getHealth });
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
    onError: (cause) => setError(cause.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = SettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setError('Vérifiez les valeurs : le rythme doit être supérieur à zéro.');
      return;
    }
    save.mutate(parsed.data);
  };

  const favorites = draft.favoriteNetworks ?? DEFAULT_FAVORITE_NETWORKS;

  const example = estimateDurationMin(10, 800, 800, draft.pace);
  const preview = Number.isFinite(example) ? formatDuration(Math.round(example / 5) * 5) : '–';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Réglages</DialogTitle>
            <DialogDescription>
              Modifier le rythme recalcule les durées de toutes les randos.
            </DialogDescription>
          </DialogHeader>

          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Rythme de marche</h3>
            <div className="grid grid-cols-2 gap-3">
              {PACE_FIELDS.map(([key, label, step]) => (
                <div key={key} className="grid gap-1.5">
                  <Label htmlFor={`pace-${key}`}>{label}</Label>
                  <Input
                    id={`pace-${key}`}
                    type="number"
                    min={0}
                    step={step}
                    required
                    value={draft.pace[key]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        pace: { ...draft.pace, [key]: Number(event.target.value) },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              Boucle 10 km, +800 m / −800 m → ≈ {preview}
            </p>
          </section>

          <section className="grid gap-1.5">
            <Label htmlFor="day-start">Heure de départ type</Label>
            <Input
              id="day-start"
              type="time"
              required
              className="w-32"
              value={draft.dayStartTime}
              onChange={(event) => setDraft({ ...draft, dayStartTime: event.target.value })}
            />
          </section>

          <section className="grid gap-3">
            <div>
              <h3 className="text-sm font-medium">Seuils</h3>
              <p className="text-sm text-muted-foreground">
                Aucune alerte tant qu'un seuil n'est pas défini.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {THRESHOLD_FIELDS.map(([key, label]) => (
                <div key={key} className="grid gap-1.5">
                  <Label htmlFor={`threshold-${key}`}>{label}</Label>
                  <Input
                    id={`threshold-${key}`}
                    type="number"
                    min={0}
                    step="any"
                    value={draft.thresholds[key] ?? ''}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        thresholds: {
                          ...draft.thresholds,
                          [key]: optionalNumber(event.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
              <div className="grid gap-1.5">
                <Label htmlFor="threshold-end">Fin de journée au plus tard</Label>
                <Input
                  id="threshold-end"
                  type="time"
                  value={draft.thresholds.latestEndTime ?? ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      thresholds: {
                        ...draft.thresholds,
                        latestEndTime: event.target.value || undefined,
                      },
                    })
                  }
                />
              </div>
            </div>
          </section>

          {health.data && health.data.assistantProviders.length > 1 && (
            <LabeledSelect<string>
              id="assistant-provider"
              label="Modèle de l'assistant"
              value={draft.assistantProvider ?? health.data.assistantProviders[0]!}
              options={Object.fromEntries(
                health.data.assistantProviders.map((id) => [id, ASSISTANT_LABELS[id].name]),
              )}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  assistantProvider: health.data?.assistantProviders.find((id) => id === value),
                })
              }
            />
          )}

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Réseaux de recharge favoris</h3>
            <div className="grid grid-cols-2 gap-2">
              {CHARGING_NETWORKS.map(({ id, label }) => (
                <div key={id} className="flex items-center gap-2">
                  <Checkbox
                    id={`network-${id}`}
                    checked={favorites.includes(id)}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        favoriteNetworks:
                          checked === true
                            ? [...favorites, id]
                            : favorites.filter((network) => network !== id),
                      })
                    }
                  />
                  <Label htmlFor={`network-${id}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {NETWORKS_NOT_IN_IRVE.join(' et ')} ne sont pas dans la base nationale : ajoutez leurs
              bornes par lien Google Maps.
            </p>
          </section>

          <section className="grid gap-1.5">
            <Label htmlFor="assistant-budget">Prévenir au-delà de ($ par conversation)</Label>
            <Input
              id="assistant-budget"
              type="number"
              min={0}
              step="0.5"
              className="w-32"
              placeholder={String(DEFAULT_ASSISTANT_BUDGET_USD)}
              value={draft.assistantBudgetUsd ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, assistantBudgetUsd: optionalNumber(event.target.value) })
              }
            />
          </section>

          <section className="grid gap-1.5">
            <Label htmlFor="map-base">Fond de carte</Label>
            <Select
              value={draft.mapBaseLayer}
              onValueChange={(value) =>
                setDraft({ ...draft, mapBaseLayer: value as Settings['mapBaseLayer'] })
              }
            >
              <SelectTrigger id="map-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ign-plan">Plan IGN</SelectItem>
                <SelectItem value="ortho">Photos aériennes</SelectItem>
                <SelectItem value="osm">OpenStreetMap</SelectItem>
              </SelectContent>
            </Select>
          </section>

          {health.data && (
            <section className="text-sm">
              <h3 className="font-medium">Clés</h3>
              <p className="text-muted-foreground">
                OpenRouteService : {KEY_STATUS[health.data.ors]} · Notion :{' '}
                {KEY_STATUS[health.data.notion]} · Assistant :{' '}
                {KEY_STATUS[health.data.assistant]}
              </p>
            </section>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
