import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { POI_LABELS, usePois } from '@/lib/hooks';
import type { Poi, Trip } from '../../shared/schema';

const FILTERS = { all: 'Tous', ...POI_LABELS };
const LIST_LIMIT = 30;

/** Points utiles OpenStreetMap autour des randos, cherchés à la demande. */
export function PoiList({
  trip,
  requested,
  onRequest,
  onAdd,
}: {
  trip: Trip;
  requested: boolean;
  onRequest: () => void;
  onAdd: (poi: Poi) => void;
}) {
  const pois = usePois(trip, requested);
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const matching = (pois.data ?? []).filter(({ kind }) => filter === 'all' || kind === filter);

  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">Points utiles autour des randos</h3>
      {!requested ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={trip.hikes.length === 0}
          onClick={onRequest}
        >
          <Search aria-hidden />
          Chercher eau, refuges, campings
        </Button>
      ) : (
        <LabeledSelect
          id="poi-filter"
          label="Type"
          value={filter}
          options={FILTERS}
          onChange={setFilter}
        />
      )}
      {pois.isFetching && !pois.data && (
        <p className="text-sm text-muted-foreground">Recherche en cours, jusqu’à 40 secondes…</p>
      )}
      {pois.isError && (
        <div className="grid gap-1">
          <p role="alert" className="text-sm text-destructive">
            {pois.error.message}
          </p>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => void pois.refetch()}>
            Réessayer
          </Button>
        </div>
      )}
      {pois.data && (
        <p className="text-xs text-muted-foreground">
          {matching.length} points, en bleu sur la carte
        </p>
      )}
      <ul className="grid gap-2">
        {matching.slice(0, LIST_LIMIT).map((poi) => (
          <li key={poi.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {poi.name}
              <span className="text-xs text-muted-foreground"> · {POI_LABELS[poi.kind]}</span>
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Ajouter ${poi.name} au voyage`}
              onClick={() => onAdd(poi)}
            >
              <Plus aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
