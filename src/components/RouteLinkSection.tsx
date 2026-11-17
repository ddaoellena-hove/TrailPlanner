import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, Route } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useRouteSuggestions } from '@/lib/hooks';
import {
  formatDuration,
  formatElevationGain,
  formatMeters,
  formatSeconds,
} from '../../shared/format';
import type { Activity, LibraryHike } from '../../shared/schema';

const NONE = 'none';

function Comparison({ activity, route }: { activity: Activity; route: LibraryHike }) {
  const rows: [string, string, string][] = [
    ['Distance', formatMeters(route.stats.distanceKm * 1000), formatMeters(activity.distanceMeters)],
    [
      'Dénivelé positif',
      route.stats.elevationGainM === null ? 'inconnu' : formatElevationGain(route.stats.elevationGainM),
      activity.elevationGainMeters === null
        ? 'inconnu'
        : formatElevationGain(activity.elevationGainMeters),
    ],
    [
      'Durée',
      `${formatDuration(route.stats.estimatedDurationMin)} (estimée)`,
      activity.durationSeconds === null
        ? 'inconnue'
        : `${formatSeconds(activity.durationSeconds)} (pauses comprises)`,
    ],
  ];
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-normal" />
          <th className="py-1 font-normal">Prévu</th>
          <th className="py-1 font-normal">Réalisé</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, planned, done]) => (
          <tr key={label} className="border-t">
            <td className="py-1 text-muted-foreground">{label}</td>
            <td className="py-1">{planned}</td>
            <td className="py-1">{done}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Lien manuel entre une sortie enregistrée et une rando prévue de la bibliothèque. Les
 * propositions ne lient rien d'elles-mêmes : il faut cliquer sur « Lier ».
 */
export function RouteLinkSection({
  activity,
  routes,
}: {
  activity: Activity;
  routes: LibraryHike[];
}) {
  const queryClient = useQueryClient();
  const suggestions = useRouteSuggestions(activity.id, activity.linkedRouteId);
  const [choice, setChoice] = useState(NONE);
  const link = useMutation({
    mutationFn: (routeId: string | null) => api.linkActivity(activity.id, routeId),
    onSuccess: async (updated) => {
      setChoice(NONE);
      await queryClient.invalidateQueries({ queryKey: ['activities'] });
      toast.success(updated.linkedRouteId ? 'Sortie liée à la rando prévue' : 'Lien retiré');
    },
    onError: (error) => toast.error(`Lien non enregistré : ${error.message}`),
  });

  const linked = activity.linkedRouteId
    ? routes.find(({ id }) => id === activity.linkedRouteId)
    : undefined;

  if (activity.linkedRouteId) {
    return (
      <section aria-label="Rando prévue" className="grid gap-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Route className="size-4 text-muted-foreground" aria-hidden />
            {linked ? `Rando prévue : ${linked.name}` : 'Rando prévue retirée de la bibliothèque'}
          </h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={link.isPending}
            onClick={() => link.mutate(null)}
          >
            <Link2Off aria-hidden />
            Retirer le lien
          </Button>
        </div>
        {linked && <Comparison activity={activity} route={linked} />}
        {linked && (
          <p className="text-xs text-muted-foreground">
            Sur la carte : trace enregistrée en trait plein, rando prévue en pointillé.
          </p>
        )}
      </section>
    );
  }

  const suggested = (suggestions.data ?? []).flatMap(({ routeId, share }) => {
    const route = routes.find(({ id }) => id === routeId);
    return route ? [{ route, share }] : [];
  });
  const options = Object.fromEntries([
    [NONE, routes.length > 0 ? 'Choisir une rando…' : 'Bibliothèque vide'],
    ...routes.map(({ id, name }) => [id, name]),
  ]) as Record<string, string>;

  return (
    <section aria-label="Rando prévue" className="grid gap-3 rounded-lg border p-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Route className="size-4 text-muted-foreground" aria-hidden />
        Rando prévue
      </h3>
      <p className="text-xs text-muted-foreground">
        Facultatif : liez la sortie à la rando de « Mes randos » que vous avez suivie pour comparer
        le prévu et le réalisé. La sortie compte alors comme faite.
      </p>

      {suggested.length > 0 && (
        <ul className="grid gap-1.5">
          {suggested.map(({ route, share }) => (
            <li key={route.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Correspond probablement à <span className="font-medium">« {route.name} »</span>{' '}
                <span className="text-xs text-muted-foreground">
                  ({Math.round(share * 100)} % de trace commune)
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={link.isPending}
                onClick={() => link.mutate(route.id)}
              >
                <Link2 aria-hidden />
                Lier
              </Button>
            </li>
          ))}
        </ul>
      )}

      {routes.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <LabeledSelect
              id={`route-${activity.id}`}
              label="Lier à une autre rando"
              value={choice}
              options={options}
              onChange={setChoice}
            />
          </div>
          <Button
            variant="outline"
            disabled={choice === NONE || link.isPending}
            onClick={() => link.mutate(choice)}
          >
            Lier
          </Button>
        </div>
      )}
    </section>
  );
}
