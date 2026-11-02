import { useDraggable } from '@dnd-kit/core';
import { CalendarPlus, Dog, GripVertical, Plus, Trash2, Upload } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { ChargingList } from '@/components/ChargingList';
import { PlaceIcon } from '@/components/PlaceIcon';
import { PoiList } from '@/components/PoiList';
import { hikeSummary } from '@/components/StopDetails';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BOOKING_LABELS, DOG_LABELS, PLACE_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { formatDay } from '../../shared/format';
import type { ChargingStation, Hike, Place, PlaceType, Poi, Trip } from '../../shared/schema';
import { unplanned } from '../../shared/trip';

export const libraryDragId = (hikeId: string) => `library-${hikeId}`;
export const libraryPlaceDragId = (placeId: string) => `library-place-${placeId}`;

function PlanInDayMenu({
  trip,
  name,
  onPick,
}: {
  trip: Trip;
  name: string;
  onPick: (dayIndex: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Planifier ${name}`}>
          <CalendarPlus aria-hidden />
          Planifier
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {trip.days.map((day) => (
          <DropdownMenuItem key={day.date} onSelect={() => onPick(day.index)}>
            J{day.index} · {formatDay(day.date)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LibraryHike({
  trip,
  hike,
  isUnplanned,
  onOpen,
  onPlan,
}: {
  trip: Trip;
  hike: Hike;
  isUnplanned: boolean;
  onOpen: () => void;
  onPlan: (dayIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: libraryDragId(hike.id),
  });

  return (
    <li className={cn('flex items-start justify-between gap-2', isDragging && 'opacity-40')}>
      <div className="flex min-w-0 items-start gap-1">
        <button
          ref={setNodeRef}
          type="button"
          aria-label={`Glisser ${hike.name} vers un jour`}
          className="-ml-2 mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <button
            type="button"
            className="truncate text-left font-medium hover:underline"
            onClick={onOpen}
          >
            {hike.name}
          </button>
          <p className="text-sm text-muted-foreground tabular-nums">{hikeSummary(hike)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isUnplanned && <Badge variant="outline">Non planifiée</Badge>}
            {hike.stats.elevationGainM === null && <Badge variant="outline">Sans altitude</Badge>}
            {hike.dogPolicy !== 'unknown' && (
              <span title={DOG_LABELS[hike.dogPolicy]} className="text-muted-foreground">
                <Dog className="size-4" aria-label={DOG_LABELS[hike.dogPolicy]} />
              </span>
            )}
          </div>
        </div>
      </div>
      {isUnplanned && <PlanInDayMenu trip={trip} name={hike.name} onPick={onPlan} />}
    </li>
  );
}

function LibraryPlace({
  trip,
  place,
  isUnplanned,
  onOpen,
  onPlan,
  onDelete,
}: {
  trip: Trip;
  place: Place;
  isUnplanned: boolean;
  onOpen: () => void;
  onPlan: (dayIndex: number) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: libraryPlaceDragId(place.id),
  });

  return (
    <li className={cn('flex items-start justify-between gap-2', isDragging && 'opacity-40')}>
      <div className="flex min-w-0 items-start gap-1">
        <button
          ref={setNodeRef}
          type="button"
          aria-label={`Glisser ${place.name} vers un jour`}
          className="-ml-2 mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <button type="button" className="text-left font-medium hover:underline" onClick={onOpen}>
            {place.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isUnplanned && <Badge variant="outline">Non planifiée</Badge>}
            {place.bookingStatus && (
              <Badge variant="secondary">{BOOKING_LABELS[place.bookingStatus]}</Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isUnplanned && <PlanInDayMenu trip={trip} name={place.name} onPick={onPlan} />}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Supprimer ${place.name}`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function LibraryPanel({
  trip,
  onImport,
  onOpenHike,
  onPlanHike,
  onPlanPlace,
  onOpenPlace,
  onAddPlace,
  onDeletePlace,
  chargingMinKw,
  onChargingMinKwChange,
  onAddStation,
  poiRequested,
  onRequestPoi,
  onAddPoi,
}: {
  trip: Trip;
  onImport: (files: File[]) => void;
  onOpenHike: (hike: Hike) => void;
  onPlanHike: (hikeId: string, dayIndex: number) => void;
  onPlanPlace: (placeId: string, dayIndex: number) => void;
  onOpenPlace: (place: Place) => void;
  onAddPlace: () => void;
  onDeletePlace: (placeId: string) => void;
  chargingMinKw: number;
  onChargingMinKwChange: (minKw: number) => void;
  onAddStation: (station: ChargingStation) => void;
  poiRequested: boolean;
  onRequestPoi: () => void;
  onAddPoi: (poi: Poi) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const library = unplanned(trip);
  const unplannedIds = new Set([...library.hikes, ...library.places].map(({ id }) => id));
  const placeTypes = Object.keys(PLACE_TYPE_LABELS) as PlaceType[];

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    onImport([...event.dataTransfer.files]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bibliothèque</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="hikes">
          <TabsList>
            <TabsTrigger value="hikes">Randos ({trip.hikes.length})</TabsTrigger>
            <TabsTrigger value="places">Lieux ({trip.places.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="hikes" className="grid gap-3">
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground transition-colors hover:border-primary',
                dragOver && 'border-primary bg-accent',
              )}
            >
              <Upload className="size-4" aria-hidden />
              Déposez vos GPX ici, ou cliquez pour les choisir
              <input
                type="file"
                accept=".gpx"
                multiple
                aria-label="Importer des GPX"
                className="sr-only"
                onChange={(event) => {
                  onImport([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
            </label>
            {trip.hikes.length > 0 && (
              <ul className="grid gap-3">
                {trip.hikes.map((hike) => (
                  <LibraryHike
                    key={hike.id}
                    trip={trip}
                    hike={hike}
                    isUnplanned={unplannedIds.has(hike.id)}
                    onOpen={() => onOpenHike(hike)}
                    onPlan={(dayIndex) => onPlanHike(hike.id, dayIndex)}
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="places" className="grid gap-3">
            <Button variant="outline" size="sm" className="w-fit" onClick={onAddPlace}>
              <Plus aria-hidden />
              Lieu
            </Button>
            {placeTypes.map((type) => {
              const places = trip.places.filter((place) => place.type === type);
              if (places.length === 0) return null;
              return (
                <section key={type} className="grid gap-2">
                  <h3 className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <PlaceIcon type={type} className="size-4" />
                    {PLACE_TYPE_LABELS[type]}
                  </h3>
                  <ul className="grid gap-3">
                    {places.map((place) => (
                      <LibraryPlace
                        key={place.id}
                        trip={trip}
                        place={place}
                        isUnplanned={unplannedIds.has(place.id)}
                        onOpen={() => onOpenPlace(place)}
                        onPlan={(dayIndex) => onPlanPlace(place.id, dayIndex)}
                        onDelete={() => onDeletePlace(place.id)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
            <PoiList
              trip={trip}
              requested={poiRequested}
              onRequest={onRequestPoi}
              onAdd={onAddPoi}
            />
            {trip.travelers.electricVehicle && (
              <ChargingList
                trip={trip}
                minKw={chargingMinKw}
                onMinKwChange={onChargingMinKwChange}
                onAdd={onAddStation}
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
