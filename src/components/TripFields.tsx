import { X } from 'lucide-react';
import { useState } from 'react';
import { AddressField } from '@/components/AddressField';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VehicleFields } from '@/components/VehicleFields';
import { formatDayCount } from '../../shared/format';
import type { Place, Trip } from '../../shared/schema';
import {
  changeDates,
  countDays,
  countDroppedDays,
  isRoundTrip,
  setDestination,
  setOrigin,
} from '../../shared/trip';

const MAX_TRIP_DAYS = 366;

function TripEndField({
  id,
  label,
  place,
  onChange,
}: {
  id: string;
  label: string;
  place: Place | undefined;
  onChange: (place: Place | undefined) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <AddressField
          key={place?.id}
          id={id}
          label={label}
          initialValue={place?.name}
          placeholder="Lyon"
          onType={() => {}}
          onSelect={({ label: name, location }) =>
            onChange({ id: crypto.randomUUID(), type: 'poi', name, location })
          }
        />
      </div>
      {place && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Retirer ${label.toLowerCase()}`}
          onClick={() => onChange(undefined)}
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** Champs du voyage, enregistrés quand on quitte le champ. */
export function TripFields({ trip, onSave }: { trip: Trip; onSave: (trip: Trip) => void }) {
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [error, setError] = useState<string | null>(null);
  const [droppedDays, setDroppedDays] = useState(0);
  const [separateArrival, setSeparateArrival] = useState(!isRoundTrip(trip));

  // Un « annuler » change le voyage de l'extérieur : les champs suivent.
  const [synced, setSynced] = useState(trip);
  if (trip !== synced) {
    setSynced(trip);
    if (trip.name !== synced.name) setName(trip.name);
    if (trip.startDate !== synced.startDate) setStartDate(trip.startDate);
    if (trip.endDate !== synced.endDate) setEndDate(trip.endDate);
  }

  const commitName = () => {
    const trimmed = name.trim();
    setName(trimmed || trip.name);
    if (trimmed && trimmed !== trip.name) onSave({ ...trip, name: trimmed });
  };

  // Les dates partent ensemble : décaler un voyage demande de changer les deux, et enregistrer
  // la première seule le raccourcirait ou l'allongerait.
  const commitDates = () => {
    if (startDate === trip.startDate && endDate === trip.endDate) {
      setError(null);
      return;
    }
    if (!startDate || !endDate || endDate < startDate) {
      setError('La date de fin doit être postérieure ou égale à la date de début');
      return;
    }
    if (countDays(startDate, endDate) > MAX_TRIP_DAYS) {
      setError(`Un voyage dure au plus ${MAX_TRIP_DAYS} jours`);
      return;
    }
    setError(null);
    const dropped = countDroppedDays(trip, startDate, endDate);
    if (dropped > 0) setDroppedDays(dropped);
    else onSave(changeDates(trip, startDate, endDate));
  };

  const cancelDates = () => {
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    setDroppedDays(0);
  };

  const dayCount =
    startDate && endDate && endDate >= startDate ? countDays(startDate, endDate) : trip.days.length;

  return (
    <section className="grid gap-3">
      <div>
        <Label htmlFor="trip-name" className="sr-only">
          Nom du voyage
        </Label>
        <Input
          id="trip-name"
          value={name}
          className="h-11 border-transparent bg-transparent px-2 -ml-2 text-2xl font-semibold tracking-tight shadow-none hover:border-input md:text-2xl"
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div
          className="flex items-end gap-3"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) commitDates();
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="trip-start" className="text-xs text-muted-foreground">
              Début
            </Label>
            <Input
              id="trip-start"
              type="date"
              value={startDate}
              className="w-40"
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="trip-end" className="text-xs text-muted-foreground">
              Fin
            </Label>
            <Input
              id="trip-end"
              type="date"
              value={endDate}
              className="w-40"
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>
        <span className="pb-2 text-sm text-muted-foreground">{formatDayCount(dayCount)}</span>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="trip-dog"
            checked={trip.travelers.withDog}
            onCheckedChange={(checked) =>
              onSave({ ...trip, travelers: { ...trip.travelers, withDog: checked === true } })
            }
          />
          <Label htmlFor="trip-dog">Avec chien</Label>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="trip-ev"
            checked={Boolean(trip.travelers.electricVehicle)}
            onCheckedChange={(checked) =>
              onSave({
                ...trip,
                travelers: { ...trip.travelers, electricVehicle: checked === true },
              })
            }
          />
          <Label htmlFor="trip-ev">Voiture électrique</Label>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {trip.travelers.electricVehicle && (
        <VehicleFields key={JSON.stringify(trip.vehicle)} trip={trip} onSave={onSave} />
      )}

      <div className="grid gap-2">
        <TripEndField
          id="trip-origin"
          label="Départ"
          place={trip.origin}
          onChange={(place) => onSave(setOrigin(trip, place))}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="trip-same-arrival"
            checked={!separateArrival}
            onCheckedChange={(checked) => {
              setSeparateArrival(checked !== true);
              if (checked === true) onSave(setDestination(trip, trip.origin));
            }}
          />
          <Label htmlFor="trip-same-arrival">Arrivée identique au départ</Label>
        </div>
        {separateArrival && (
          <TripEndField
            id="trip-destination"
            label="Arrivée"
            place={isRoundTrip(trip) ? undefined : trip.destination}
            onChange={(place) => onSave(setDestination(trip, place))}
          />
        )}
      </div>

      <AlertDialog open={droppedDays > 0} onOpenChange={(open) => !open && cancelDates()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Retirer {droppedDays > 1 ? `${droppedDays} jours avec des étapes` : 'un jour avec des étapes'} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Leurs étapes passeront dans « Non planifiées », d'où vous pourrez les replacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={(event) => {
                // Sans cela, la fermeture du dialog passe par onOpenChange et annule les dates.
                event.preventDefault();
                setDroppedDays(0);
                onSave(changeDates(trip, startDate, endDate));
              }}
            >
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
