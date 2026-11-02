import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { libraryDragId, libraryPlaceDragId } from '@/components/LibraryPanel';
import { dayColor } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { formatDay } from '../../shared/format';
import type { Day, Stop, Trip } from '../../shared/schema';
import { moveStop } from '../../shared/trip';

const dayDropId = (day: Day) => `day-${day.index}`;

/** Une étape survolée l'emporte sur son jour, pour déposer à une position précise. */
const collisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const hits = pointerWithin(args);
  const stop = hits.find(({ id }) => !String(id).startsWith('day-'));
  return stop ? [stop] : hits;
};

function SortableStop({
  stop,
  label,
  children,
}: {
  stop: Stop;
  label: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex items-start gap-1', isDragging && 'opacity-40')}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Déplacer ${label}`}
        className="-ml-2 mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">{children}</div>
    </li>
  );
}

function DayCard({
  day,
  highlighted,
  summary,
  badges,
  end,
  action,
  onSelect,
  onAddStop,
  children,
}: {
  day: Day;
  highlighted: boolean;
  summary: ReactNode;
  badges: ReactNode;
  end: ReactNode;
  action: ReactNode;
  onSelect: () => void;
  onAddStop: () => void;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: dayDropId(day) });

  return (
    <Card
      ref={setNodeRef}
      id={`day-${day.index}`}
      style={{ borderLeftColor: dayColor(day.index) }}
      className={cn('scroll-mt-4 border-l-4', highlighted && 'ring-2 ring-primary')}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
          <button type="button" className="flex items-center gap-2 hover:underline" onClick={onSelect}>
            <span
              className="rounded-md px-1.5 py-0.5 text-xs font-bold text-white"
              style={{ backgroundColor: dayColor(day.index) }}
            >
              J{day.index}
            </span>
            <span className="inline-block first-letter:uppercase">{formatDay(day.date)}</span>
          </button>
          {badges}
        </CardTitle>
        <div className="flex shrink-0 gap-2">
          {action}
          <Button
            variant="outline"
            size="sm"
            aria-label={`Ajouter une étape au jour ${day.index}`}
            onClick={onAddStop}
          >
            <Plus aria-hidden />
            Étape
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {summary}
        {day.stops.length > 0 && (
          <SortableContext items={day.stops} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-3">{children}</ul>
          </SortableContext>
        )}
        {end}
      </CardContent>
    </Card>
  );
}

export function DayBoard({
  trip,
  stopLabel,
  renderStop,
  renderSummary,
  renderBadges,
  renderLegs,
  renderDayEnd,
  renderDayAction,
  library,
  onMove,
  onDropHike,
  onDropPlace,
  onSelectDay,
  onAddStop,
}: {
  trip: Trip;
  stopLabel: (stop: Stop) => string | undefined;
  renderStop: (stop: Stop) => ReactNode;
  renderSummary: (day: Day) => ReactNode;
  renderBadges: (day: Day) => ReactNode;
  renderLegs: (stop: Stop, phase: 'enter' | 'stay') => ReactNode;
  renderDayEnd: (day: Day) => ReactNode;
  renderDayAction: (day: Day) => ReactNode;
  library: ReactNode;
  onMove: (trip: Trip) => void;
  onDropHike: (hikeId: string, dayIndex: number, position: number) => void;
  onDropPlace: (placeId: string, dayIndex: number, position: number) => void;
  onSelectDay: (day: Day) => void;
  onAddStop: (day: Day) => void;
}) {
  const [activeLabel, setActiveLabel] = useState<string | undefined>();
  const [overDayIndex, setOverDayIndex] = useState<number | null>(null);
  const sensors = useSensors(
    // Le seuil laisse passer un simple clic sur la poignée.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dayOfDropTarget = (id: string) =>
    trip.days.find(
      (day) => dayDropId(day) === id || day.stops.some((stop) => stop.id === id),
    );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveLabel(undefined);
    setOverDayIndex(null);
    if (!over || active.id === over.id) return;
    const day = dayOfDropTarget(String(over.id));
    if (!day) return;
    const overPosition = day.stops.findIndex(({ id }) => id === over.id);
    const position = overPosition === -1 ? day.stops.length : overPosition;
    const libraryHike = trip.hikes.find(({ id }) => libraryDragId(id) === active.id);
    const libraryPlace = trip.places.find(({ id }) => libraryPlaceDragId(id) === active.id);
    if (libraryHike) onDropHike(libraryHike.id, day.index, position);
    else if (libraryPlace) onDropPlace(libraryPlace.id, day.index, position);
    else onMove(moveStop(trip, String(active.id), day.index, position));
  };

  const labelOf = (id: string) => {
    const stop = trip.days.flatMap((day) => day.stops).find((item) => item.id === id);
    if (stop) return stopLabel(stop);
    return (
      trip.hikes.find((hike) => libraryDragId(hike.id) === id)?.name ??
      trip.places.find((place) => libraryPlaceDragId(place.id) === id)?.name
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) => setActiveLabel(labelOf(String(active.id)))}
      onDragOver={({ over }) =>
        setOverDayIndex(over ? (dayOfDropTarget(String(over.id))?.index ?? null) : null)
      }
      onDragCancel={() => {
        setActiveLabel(undefined);
        setOverDayIndex(null);
      }}
      onDragEnd={handleDragEnd}
    >
      {library}
      <div className="grid gap-4">
        {trip.days.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            highlighted={overDayIndex === day.index}
            summary={renderSummary(day)}
            badges={renderBadges(day)}
            end={renderDayEnd(day)}
            action={renderDayAction(day)}
            onSelect={() => onSelectDay(day)}
            onAddStop={() => onAddStop(day)}
          >
            {day.stops.map((stop) => {
              const label = stopLabel(stop);
              return label ? (
                <Fragment key={stop.id}>
                  {renderLegs(stop, 'enter')}
                  <SortableStop stop={stop} label={label}>
                    {renderStop(stop)}
                  </SortableStop>
                  {renderLegs(stop, 'stay')}
                </Fragment>
              ) : null;
            })}
          </DayCard>
        ))}
      </div>
      <DragOverlay>
        {activeLabel && (
          <div className="rounded-md border bg-popover px-3 py-2 text-sm font-medium shadow-lg">
            {activeLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
