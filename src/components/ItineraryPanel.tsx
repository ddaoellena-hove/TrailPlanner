import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ProfileChart } from '@/components/ProfileChart';
import { type MapFocus, TripMap } from '@/components/TripMap';
import { LabeledSelect } from '@/components/HikeSelects';
import { LayersMenu } from '@/components/LayersMenu';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  itineraryKey,
  useRankedStations,
  useItinerary,
  usePois,
  useSettings,
} from '@/lib/hooks';
import { TRAIL_TO_STAY_COLOR } from '@/lib/labels';
import { mapViewOf } from '@/lib/map-layers';
import { cn } from '@/lib/utils';
import { formatDuration, formatKm } from '../../shared/format';
import { itineraryTotals } from '../../shared/itinerary';
import { buildProfile, nearestPointIndex } from '../../shared/profile';
import type { ChargingStation, LatLng, Poi, Trip } from '../../shared/schema';

export function ItineraryPanel({
  trip,
  focus,
  profileTitle,
  dayFilter,
  onDayFilterChange,
  onAddPlaceAt,
  onOpenPlace,
  chargingMinKw,
  onAddStation,
  poiRequested,
  onAddPoi,
}: {
  trip: Trip;
  focus: MapFocus | null;
  profileTitle: string | null;
  dayFilter: number | null;
  onDayFilterChange: (dayIndex: number | null) => void;
  onAddPlaceAt: (location: LatLng) => void;
  onOpenPlace: (placeId: string) => void;
  chargingMinKw: number;
  onAddStation: (station: ChargingStation) => void;
  poiRequested: boolean;
  onAddPoi: (poi: Poi) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const itinerary = useItinerary(trip);
  const stations = useRankedStations(trip, chargingMinKw);
  const pois = usePois(trip, poiRequested);
  const [hoveredHikeId, setHoveredHikeId] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);

  const refresh = useMutation({
    mutationFn: () => api.computeItinerary(trip.slug, true),
    onSuccess: (result) => queryClient.setQueryData(itineraryKey(trip), result),
    onError: (error) => toast.error(`Actualisation impossible : ${error.message}`),
  });

  const selectedIds = useMemo(() => focus?.hikeIds ?? [], [focus]);
  const hikesOf = (ids: string[]) =>
    ids.flatMap((id) => trip.hikes.filter((hike) => hike.id === id));
  const shownIds = hoveredHikeId ? [hoveredHikeId] : selectedIds;
  const points = buildProfile(hikesOf(shownIds));
  const shownHike = hoveredHikeId ? trip.hikes.find(({ id }) => id === hoveredHikeId) : undefined;
  const title = shownHike?.name ?? profileTitle;
  const hasAltitude = points.some((point) => point.altM !== null);
  const cursorPoint = cursorIndex === null ? undefined : points[cursorIndex];

  // Survoler une rando du profil affiché déplace le point ; une autre rando prend le profil.
  const handleHikeHover = (hikeId: string | null, position: LatLng) => {
    if (!hikeId) {
      setHoveredHikeId(null);
      setCursorIndex(null);
      return;
    }
    const inSelection = selectedIds.includes(hikeId);
    setHoveredHikeId(inSelection ? null : hikeId);
    const target = buildProfile(hikesOf(inSelection ? selectedIds : [hikeId]));
    setCursorIndex(nearestPointIndex(target, position));
  };

  const allLegs = itinerary.data?.legs ?? [];
  const legs = dayFilter
    ? allLegs.filter((leg) => leg.dayIndex === dayFilter)
    : allLegs;
  const filterOptions: Record<string, string> = {
    all: 'Tout le voyage',
    ...Object.fromEntries(trip.days.map((day) => [String(day.index), `J${day.index}`])),
  };
  const totals = itineraryTotals(legs);
  const busy = itinerary.isFetching || refresh.isPending;

  return (
    <aside className="flex h-[40rem] flex-col gap-3 rounded-xl border bg-card p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-medium tabular-nums">
          {legs.length === 0
            ? 'Aucun trajet en voiture'
            : `${legs.length > 1 ? `${legs.length} trajets` : '1 trajet'} · ${formatKm(totals.distanceKm)} · ${formatDuration(totals.durationMin)} de route`}
        </p>
        <div className="flex shrink-0 items-end gap-2">
          <div className="w-36 [&_label]:sr-only">
            <LabeledSelect
              id="map-filter"
              label="Filtrer la carte"
              value={dayFilter ? String(dayFilter) : 'all'}
              options={filterOptions}
              onChange={(value) => onDayFilterChange(value === 'all' ? null : Number(value))}
            />
          </div>
          <LayersMenu settings={settings} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => refresh.mutate()}>
            <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden />
            Actualiser
          </Button>
        </div>
      </div>

      {itinerary.isError && (
        <p role="alert" className="text-sm text-destructive">
          Calcul impossible : {itinerary.error.message}
        </p>
      )}
      {totals.estimated && (
        <p className="text-sm text-muted-foreground">
          Routage indisponible pour certains trajets : ils sont estimés à vol d'oiseau et tracés
          en ligne droite.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <TripMap
          trip={trip}
          legs={legs}
          focus={focus}
          dayFilter={dayFilter}
          onAddPlaceAt={onAddPlaceAt}
          onOpenPlace={onOpenPlace}
          stations={trip.travelers.electricVehicle ? stations.stations : []}
          onAddStation={onAddStation}
          pois={pois.data ?? []}
          onAddPoi={onAddPoi}
          baseLayer={settings.mapBaseLayer}
          view={mapViewOf(settings)}
          highlightedHikeId={hoveredHikeId ?? (selectedIds.length === 1 ? selectedIds[0]! : null)}
          cursor={cursorPoint ?? null}
          onHikeHover={handleHikeHover}
        />
      </div>

      <div className="h-36 shrink-0">
        {title ? (
          <div className="flex h-full flex-col gap-1">
            <p className="truncate text-sm font-medium">{title}</p>
            {hasAltitude ? (
              <div className="min-h-0 flex-1">
                <ProfileChart
                  points={points}
                  cursorIndex={cursorIndex}
                  onCursorChange={setCursorIndex}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pas de profil : ce GPX n'a pas d'altitude, ou ce jour n'a pas de rando.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Survolez une rando sur la carte, ou choisissez une rando ou un jour, pour voir le
            profil.
          </p>
        )}
      </div>

      {legs.length > 0 && (
        <ol className="grid max-h-24 shrink-0 gap-1 overflow-y-auto text-sm">
          {legs.map((leg, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span className="flex min-w-0 items-center gap-1.5">
                {leg.trailToStay && (
                  <span
                    title="Du trail à l'hébergement"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TRAIL_TO_STAY_COLOR }}
                  />
                )}
                <span className="truncate">
                  {leg.fromName} → {leg.toName}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatKm(leg.distanceKm)} · {formatDuration(leg.durationMin)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
