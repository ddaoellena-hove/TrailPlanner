import { useMemo, useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { LibraryHikeSheet } from '@/components/LibraryHikeSheet';
import { LibraryMap } from '@/components/LibraryMap';
import { PaceCard } from '@/components/PaceCard';
import { RatingStars } from '@/components/RatingStars';
import { HikeBadges } from '@/components/StopDetails';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useLibrary } from '@/lib/hooks';
import { filterLibraryHikes, type LibraryFilters, NO_FILTERS } from '../../shared/library';

const STATUS_OPTIONS: Record<LibraryFilters['status'], string> = {
  all: 'Toutes',
  done: 'Déjà faites',
  todo: 'Jamais faites',
};
const RATING_OPTIONS = { '0': 'Toutes les notes', '3': '3 et plus', '4': '4 et plus', '5': '5' };

const toLimit = (value: string) => (value === '' ? null : Number(value));

export function LibraryPage() {
  const library = useLibrary();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const hikes = useMemo(() => library.data ?? [], [library.data]);
  const shown = useMemo(() => filterLibraryHikes(hikes, filters), [hikes, filters]);
  const open = hikes.find(({ id }) => id === openId);
  const update = (changes: Partial<LibraryFilters>) =>
    setFilters((current) => ({ ...current, ...changes }));

  return (
    <main className="mx-auto grid max-w-[1600px] gap-4 px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Mes randos</h1>

      {library.isPending && <Skeleton className="h-44" />}
      {library.isError && (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger la bibliothèque : {library.error.message}
        </p>
      )}
      {library.data?.length === 0 && (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          Les GPX importés dans vos voyages apparaîtront ici.
        </p>
      )}

      {hikes.length > 0 && (
        <>
          <PaceCard hikes={hikes} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid w-56 gap-1">
              <Label htmlFor="library-search">Rechercher</Label>
              <Input
                id="library-search"
                placeholder="Nom ou tag"
                value={filters.query}
                onChange={(event) => update({ query: event.target.value })}
              />
            </div>
            <div className="w-40">
              <LabeledSelect
                id="library-status"
                label="Statut"
                value={filters.status}
                options={STATUS_OPTIONS}
                onChange={(status) => update({ status })}
              />
            </div>
            <div className="w-40">
              <LabeledSelect
                id="library-rating"
                label="Note"
                value={String(filters.minRating) as keyof typeof RATING_OPTIONS}
                options={RATING_OPTIONS}
                onChange={(rating) => update({ minRating: Number(rating) })}
              />
            </div>
            <div className="grid w-28 gap-1">
              <Label htmlFor="library-km">Km max</Label>
              <Input
                id="library-km"
                type="number"
                min={0}
                value={filters.maxKm ?? ''}
                onChange={(event) => update({ maxKm: toLimit(event.target.value) })}
              />
            </div>
            <div className="grid w-28 gap-1">
              <Label htmlFor="library-gain">D+ max (m)</Label>
              <Input
                id="library-gain"
                type="number"
                min={0}
                value={filters.maxElevationGainM ?? ''}
                onChange={(event) => update({ maxElevationGainM: toLimit(event.target.value) })}
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id="library-dog"
                checked={filters.withDog}
                onCheckedChange={(checked) => update({ withDog: checked === true })}
              />
              <Label htmlFor="library-dog">Avec chien</Label>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="grid content-start gap-2">
              <p className="text-sm text-muted-foreground">
                {shown.length} {shown.length > 1 ? 'randos' : 'rando'} sur {hikes.length}
              </p>
              <ul className="grid gap-2">
                {shown.map((hike) => (
                  <li key={hike.id}>
                    <button
                      type="button"
                      className="grid w-full gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50"
                      onClick={() => setOpenId(hike.id)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{hike.name}</span>
                        {hike.rating !== undefined && <RatingStars value={hike.rating} />}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <HikeBadges hike={hike} />
                        <Badge variant={hike.outings.length > 0 ? 'secondary' : 'outline'}>
                          {hike.outings.length > 0
                            ? `Faite ${hike.outings.length} fois`
                            : 'Jamais faite'}
                        </Badge>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="h-[36rem] overflow-hidden rounded-xl border lg:sticky lg:top-4">
              <LibraryMap hikes={shown} onOpen={setOpenId} />
            </div>
          </div>
        </>
      )}

      {open && <LibraryHikeSheet key={open.id} hike={open} onClose={() => setOpenId(null)} />}
    </main>
  );
}
