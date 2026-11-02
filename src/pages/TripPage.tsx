import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpenText, Footprints, Pencil, Redo2, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AlertBadges, AlertsPanel } from '@/components/AlertsPanel';
import { DayBoard } from '@/components/DayBoard';
import { DaySummary } from '@/components/DaySummary';
import { ExportDialog } from '@/components/ExportDialog';
import { HikeSheet } from '@/components/HikeSheet';
import { ImportDialog } from '@/components/ImportDialog';
import { ItineraryPanel } from '@/components/ItineraryPanel';
import { LegRows } from '@/components/LegRows';
import { LibraryPanel } from '@/components/LibraryPanel';
import { PlaceDialog } from '@/components/PlaceDialog';
import { PlaceIcon } from '@/components/PlaceIcon';
import { hikeSummary, StopDetails } from '@/components/StopDetails';
import { StopDialog, type StopValues } from '@/components/StopDialog';
import { TripFields } from '@/components/TripFields';
import type { MapFocus } from '@/components/TripMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useItinerary, useSettings } from '@/lib/hooks';
import { PLACE_TYPE_LABELS } from '@/lib/labels';
import { type Alert, computeAlerts } from '../../shared/alerts';
import { emptyHistory, record, redo, undo } from '../../shared/history';
import type { Day, Hike, LatLng, Place, Stop, Trip } from '../../shared/schema';
import { dayTotals } from '../../shared/totals';
import {
  addHikes,
  addHikeStop,
  addPlace,
  addPlaceStop,
  addRecoveryStop,
  convertToOutAndBack,
  moveStop,
  planHike,
  planPlace,
  removeHike,
  removePlace,
  removeStop,
  replaceHikeTrack,
  setStopDuration,
  setStopPlaces,
  updateDay,
  updateHike,
  updatePlace,
} from '../../shared/trip';

type Editing = { kind: 'add'; day: Day } | { kind: 'edit'; stop: Stop };
type PlaceEditing = { place?: Place; location?: LatLng };

function TripWorkspace({ trip, slug }: { trip: Trip; slug: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['trip', slug];
  const settings = useSettings();
  const itinerary = useItinerary(trip);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [openHikeId, setOpenHikeId] = useState<string | null>(null);
  const [importing, setImporting] = useState<Hike[] | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [profileTitle, setProfileTitle] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [placeEditing, setPlaceEditing] = useState<PlaceEditing | null>(null);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState(emptyHistory<Trip>);

  // Mise à jour optimiste pour qu'une étape déposée ne revienne pas à sa place en attendant le
  // serveur. Le scope sérialise les sauvegardes, pour qu'une ancienne n'écrase pas une récente.
  const saveTrip = useMutation({
    mutationFn: api.saveTrip,
    scope: { id: `trip-${slug}` },
    onMutate: async (next: Trip) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Trip>(queryKey);
      queryClient.setQueryData(queryKey, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData<Trip>(
        queryKey,
        (current) => current && { ...current, updatedAt: saved.updatedAt },
      );
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  /** Enregistre une modification annulable. */
  const commit = (next: Trip) => {
    setHistory((current) => record(current, trip));
    return saveTrip.mutateAsync(next);
  };

  const save = (next: Trip) => {
    commit(next).catch((error: Error) =>
      toast.error(`Enregistrement impossible : ${error.message}`),
    );
  };

  const stepHistory = (step: typeof undo) => {
    const result = step(history, trip);
    if (!result) return;
    setHistory(result.history);
    saveTrip.mutate(result.value);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        // Quitter le champ en cours enregistre sa saisie avant la sauvegarde forcée.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        saveTrip.mutate(trip);
      } else if (key === 'z') {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        stepHistory(event.shiftKey ? redo : undo);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const addStop = async (day: Day, values: StopValues) => {
    let next: Trip;
    if (values.withTrail) {
      if (!values.file) throw new Error('Fichier GPX manquant');
      next = addHikeStop(trip, day.index, await api.uploadGpx(slug, values.file, values));
    } else {
      if (!values.places.stay) throw new Error('Lieu de séjour manquant');
      const place: Place = { id: crypto.randomUUID(), type: 'lodging', ...values.places.stay };
      next = addPlaceStop(trip, day.index, place);
    }
    const stopId = next.days[day.index - 1]?.stops.at(-1)?.id ?? '';
    await commit(setStopPlaces(next, stopId, values.places));
  };

  const editStop = async (stop: Stop, values: StopValues) => {
    const next = setStopPlaces(trip, stop.id, values.places);
    await commit(
      stop.kind === 'hike'
        ? updateHike(next, stop.hikeId, {
            name: values.name,
            alltrailsUrl: values.alltrailsUrl || undefined,
          })
        : next,
    );
  };

  /** Un fichier invalide n'empêche pas les autres (SPEC US1). */
  const importFiles = async (files: File[]) => {
    const imported: Hike[] = [];
    for (const file of files) {
      try {
        imported.push(await api.uploadGpx(slug, file));
      } catch (error) {
        toast.error(`${file.name} : ${error instanceof Error ? error.message : 'import impossible'}`);
      }
    }
    if (imported.length > 0) setImporting(imported);
  };

  const dropHike = (hikeId: string, dayIndex: number, position: number) => {
    const next = planHike(trip, dayIndex, hikeId);
    const stopId = next.days[dayIndex - 1]?.stops.at(-1)?.id ?? '';
    save(moveStop(next, stopId, dayIndex, position));
  };

  const dropPlace = (placeId: string, dayIndex: number, position: number) => {
    const next = planPlace(trip, dayIndex, placeId);
    const stopId = next.days[dayIndex - 1]?.stops.at(-1)?.id ?? '';
    save(moveStop(next, stopId, dayIndex, position));
  };

  const selectHike = (hike: Hike) => {
    setDayFilter(null);
    setProfileTitle(hike.name);
    setFocus((previous) => ({
      hikeIds: [hike.id],
      fit: true,
      request: (previous?.request ?? 0) + 1,
    }));
  };

  /** La carte se cadre seule sur le jour filtré ; le profil enchaîne ses randos. */
  const selectDay = (dayIndex: number | null) => {
    const day = trip.days.find(({ index }) => index === dayIndex);
    setDayFilter(day?.index ?? null);
    setProfileTitle(day ? `Profil du J${day.index}` : null);
    setFocus((previous) => ({
      hikeIds: day?.stops.flatMap((stop) => (stop.kind === 'hike' ? [stop.hikeId] : [])) ?? [],
      fit: false,
      request: (previous?.request ?? 0) + 1,
    }));
  };

  const focusAlert = (alert: Alert) => {
    if (alert.dayIndex) {
      document
        .getElementById(`day-${alert.dayIndex}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const hike = alert.hikeId ? findHike(alert.hikeId) : undefined;
    if (hike) selectHike(hike);
    if (hike && (alert.code === 'A3' || alert.code === 'A4')) setOpenHikeId(hike.id);
    const place = findPlace(alert.placeId);
    if (place) setPlaceEditing({ place });
  };

  const savePlace = async (values: Omit<Place, 'id'>) => {
    const existing = placeEditing?.place;
    await commit(
      existing
        ? updatePlace(trip, existing.id, values)
        : addPlace(trip, { ...values, id: crypto.randomUUID() }),
    );
  };

  const legs = useMemo(() => itinerary.data?.legs ?? [], [itinerary.data]);
  const alerts = useMemo(() => computeAlerts(trip, legs, settings), [trip, legs, settings]);

  const findPlace = (id: string | undefined) => trip.places.find((place) => place.id === id);
  const findHike = (id: string) => trip.hikes.find((hike) => hike.id === id);
  const stopStay = (stop: Stop) =>
    findPlace(stop.kind === 'hike' ? stop.stayPlaceId : stop.placeId);
  const stopName = (stop: Stop) =>
    (stop.kind === 'hike' ? findHike(stop.hikeId)?.name : undefined) ?? stopStay(stop)?.name;
  const openHike = openHikeId ? findHike(openHikeId) : undefined;

  const renderStop = (stop: Stop) => {
    const hike = stop.kind === 'hike' ? findHike(stop.hikeId) : undefined;
    const stay = stopStay(stop);
    const departure = findPlace(stop.departurePlaceId);
    const name = stopName(stop);
    return (
      <>
        {hike ? (
          <StopDetails
            icon={<Footprints aria-hidden />}
            name={hike.name}
            summary={hikeSummary(hike)}
            directionsTo={hike.start}
            alltrailsUrl={hike.alltrailsUrl}
            departure={departure}
            stay={stay}
            onOpen={() => setOpenHikeId(hike.id)}
            onShowOnMap={() => selectHike(hike)}
          />
        ) : (
          stay && (
            <StopDetails
              icon={<PlaceIcon type={stay.type} />}
              name={stay.name}
              summary={PLACE_TYPE_LABELS[stay.type]}
              directionsTo={stay.location}
              departure={departure}
              stay={stay}
              onOpen={() => setPlaceEditing({ place: stay })}
              extra={
                stop.kind === 'place' && (
                  <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    Pause (min)
                    <Input
                      key={stop.durationMin}
                      type="number"
                      min={0}
                      step={5}
                      className="h-7 w-20"
                      defaultValue={stop.durationMin}
                      onBlur={(event) => {
                        const value = event.target.value;
                        const durationMin = value === '' ? undefined : Number(value);
                        if (durationMin !== stop.durationMin) {
                          save(setStopDuration(trip, stop.id, durationMin));
                        }
                      }}
                    />
                  </label>
                )
              }
            />
          )
        )}
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Modifier ${name}`}
            onClick={() =>
              stay && stop.kind === 'place' && stay.type !== 'lodging'
                ? setPlaceEditing({ place: stay })
                : setEditing({ kind: 'edit', stop })
            }
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Retirer ${name}`}
            onClick={() => save(removeStop(trip, stop.id))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </>
    );
  };

  const status = saveTrip.isPending
    ? 'Enregistrement…'
    : saveTrip.isError
      ? 'Non enregistré'
      : 'Enregistré';

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="grid min-w-0 gap-4">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link to="/">
              <ArrowLeft aria-hidden />
              Mes voyages
            </Link>
          </Button>
          <div className="flex items-center gap-1">
            <span role="status" className="mr-2 text-sm text-muted-foreground">
              {status}
            </span>
            <Button variant="outline" size="sm" onClick={() => setExporting(true)}>
              <BookOpenText aria-hidden />
              Exporter vers Notion
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Annuler la dernière modification"
              disabled={history.past.length === 0}
              onClick={() => stepHistory(undo)}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rétablir"
              disabled={history.future.length === 0}
              onClick={() => stepHistory(redo)}
            >
              <Redo2 aria-hidden />
            </Button>
          </div>
        </div>

        <TripFields trip={trip} onSave={save} />

        <AlertsPanel
          alerts={alerts}
          onFocus={focusAlert}
          onConvert={(hikeId) => save(convertToOutAndBack(trip, hikeId, settings.pace))}
          onAddRecovery={(stopId) => save(addRecoveryStop(trip, stopId))}
        />

        <DayBoard
          trip={trip}
          stopLabel={stopName}
          renderStop={renderStop}
          renderSummary={(day) => (
            <DaySummary
              trip={trip}
              day={day}
              totals={dayTotals(trip, day, legs, settings.dayStartTime)}
              thresholds={settings.thresholds}
              onChange={(changes) => save(updateDay(trip, day.index, changes))}
            />
          )}
          renderBadges={(day) => (
            <AlertBadges alerts={alerts.filter(({ dayIndex }) => dayIndex === day.index)} />
          )}
          renderLegs={(stop, phase) => (
            <LegRows
              legs={legs.filter((leg) => leg.stopId === stop.id && leg.phase === phase)}
            />
          )}
          renderDayEnd={(day) => {
            const dayEnd = legs.filter(
              (leg) => leg.dayIndex === day.index && leg.phase === 'end',
            );
            return dayEnd.length > 0 ? (
              <ul>
                <LegRows legs={dayEnd} />
              </ul>
            ) : null;
          }}
          library={
            <LibraryPanel
              trip={trip}
              onImport={(files) => void importFiles(files)}
              onOpenHike={(hike) => setOpenHikeId(hike.id)}
              onPlanHike={(hikeId, dayIndex) => save(planHike(trip, dayIndex, hikeId))}
              onPlanPlace={(placeId, dayIndex) => save(planPlace(trip, dayIndex, placeId))}
              onOpenPlace={(place) => setPlaceEditing({ place })}
              onAddPlace={() => setPlaceEditing({})}
            />
          }
          onMove={save}
          onDropHike={dropHike}
          onDropPlace={dropPlace}
          onSelectDay={(day) => selectDay(day.index)}
          onAddStop={(day) => setEditing({ kind: 'add', day })}
        />
      </div>

      <ItineraryPanel
        trip={trip}
        focus={focus}
        profileTitle={profileTitle}
        dayFilter={dayFilter}
        onDayFilterChange={selectDay}
        onAddPlaceAt={(location) => setPlaceEditing({ location })}
      />

      {editing?.kind === 'add' && (
        <StopDialog
          title={`Nouvelle étape · J${editing.day.index}`}
          onClose={() => setEditing(null)}
          onSubmit={(values) => addStop(editing.day, values)}
        />
      )}
      {editing?.kind === 'edit' && (
        <StopDialog
          hike={editing.stop.kind === 'hike' ? findHike(editing.stop.hikeId) : undefined}
          isStay={editing.stop.kind === 'place'}
          departure={findPlace(editing.stop.departurePlaceId)}
          stay={stopStay(editing.stop)}
          title="Modifier l'étape"
          onClose={() => setEditing(null)}
          onSubmit={(values) => editStop(editing.stop, values)}
        />
      )}
      {exporting && <ExportDialog trip={trip} onClose={() => setExporting(false)} />}
      {placeEditing && (
        <PlaceDialog
          place={placeEditing.place}
          initialLocation={placeEditing.location}
          onClose={() => setPlaceEditing(null)}
          onSubmit={savePlace}
          onDelete={(placeId) => {
            setPlaceEditing(null);
            save(removePlace(trip, placeId));
          }}
        />
      )}
      {importing && (
        <ImportDialog
          hikes={importing}
          onClose={() => setImporting(null)}
          onConfirm={(hikes) => {
            setImporting(null);
            save(addHikes(trip, hikes));
          }}
        />
      )}
      {openHike && (
        <HikeSheet
          key={openHike.gpxFile}
          hike={openHike}
          onClose={() => setOpenHikeId(null)}
          onSave={(changes) => commit(updateHike(trip, openHike.id, changes))}
          onReplaceGpx={async (file) => {
            const track = await api.uploadGpx(slug, file);
            await commit(replaceHikeTrack(trip, openHike.id, track));
          }}
          onDelete={() => {
            setOpenHikeId(null);
            save(removeHike(trip, openHike.id));
          }}
        />
      )}
    </div>
  );
}

export function TripPage() {
  const { slug = '' } = useParams();
  const trip = useQuery({ queryKey: ['trip', slug], queryFn: () => api.getTrip(slug) });

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-4">
      {trip.isPending && <Skeleton className="h-24" />}
      {trip.isError && (
        <p role="alert" className="text-sm text-destructive">
          {trip.error.message}
        </p>
      )}
      {trip.data && <TripWorkspace trip={trip.data} slug={slug} />}
    </main>
  );
}
