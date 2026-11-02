import { type FormEvent, useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { MapLinkField } from '@/components/MapLinkField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChargingStations } from '@/lib/hooks';
import { formatStation, stationNotes } from '@/lib/stations';
import { distanceKm } from '../../shared/charging';
import type { ChargingStation, MapLinkResult, Place, Trip } from '../../shared/schema';
import { type StopSlot, stopSlots } from '../../shared/trip';

const NO_SLOT = 'none';
const DEFAULT_PAUSE_MIN = 30;
const LIST_LIMIT = 40;

/** Ouverture depuis une étape (`slotKey`) ou depuis une borne (`station`). */
export type ChargeTarget = { slotKey?: string; station?: ChargingStation };

type Option = { key: string; label: string; toPlace: () => Place; km: number | null };

function stationPlace(station: ChargingStation): Place {
  return {
    id: crypto.randomUUID(),
    type: 'charging',
    name: station.name,
    location: station.location,
    notes: stationNotes(station),
  };
}

function nearestSlot(slots: StopSlot[], station: ChargingStation): StopSlot | undefined {
  return slots
    .filter((slot) => slot.location)
    .toSorted(
      (a, b) =>
        distanceKm(a.location!, station.location) - distanceKm(b.location!, station.location),
    )[0];
}

export function ChargeDialog({
  trip,
  target,
  minKw,
  onClose,
  onConfirm,
}: {
  trip: Trip;
  target: ChargeTarget;
  minKw: number;
  onClose: () => void;
  onConfirm: (place: Place, slot: StopSlot | null, durationMin: number | undefined) => void;
}) {
  const stations = useChargingStations(trip, minKw);
  const slots = stopSlots(trip);
  const [slotKey, setSlotKey] = useState(
    target.slotKey ??
      (target.station && nearestSlot(slots, target.station)?.key) ??
      slots[0]?.key ??
      NO_SLOT,
  );
  const [bornePick, setBornePick] = useState<string | null>(
    target.station ? `station:${target.station.id}` : null,
  );
  const [pause, setPause] = useState(String(DEFAULT_PAUSE_MIN));
  const [linked, setLinked] = useState<MapLinkResult | null>(null);
  const [linkedName, setLinkedName] = useState('');

  const slot = slots.find(({ key }) => key === slotKey) ?? null;
  const reference = slot?.location;
  const kmFrom = (location: Place['location']) =>
    reference ? distanceKm(reference, location) : null;

  const known = trip.places.filter(({ type }) => type === 'charging');
  const knownNames = new Set(known.map(({ name }) => name));
  const candidates = [
    ...(target.station ? [target.station] : []),
    ...(stations.data ?? []).filter(({ id }) => id !== target.station?.id),
  ].filter(({ name }) => !knownNames.has(name));

  const options: Option[] = [
    ...known.map((place) => ({
      key: `place:${place.id}`,
      label: place.name,
      toPlace: () => place,
      km: kmFrom(place.location),
    })),
    ...candidates.map((station) => ({
      key: `station:${station.id}`,
      label: `${station.name} · ${formatStation(station)}`,
      toPlace: () => stationPlace(station),
      km: kmFrom(station.location),
    })),
  ]
    .toSorted((a, b) => (a.km ?? 0) - (b.km ?? 0))
    .slice(0, LIST_LIMIT);

  const linkedPlace = (): Place | null =>
    linked && {
      id: crypto.randomUUID(),
      type: 'charging',
      name: linkedName.trim() || 'Borne de recharge',
      location: linked.location,
      url: linked.url,
    };

  const selected =
    options.find(({ key }) => key === bornePick) ??
    (target.station ? undefined : options[0]);
  const canSubmit = Boolean(linked ?? selected);

  const slotOptions: Record<string, string> = {
    ...Object.fromEntries(slots.map(({ key, label }) => [key, label])),
    [NO_SLOT]: 'Dans les lieux seulement',
  };
  const borneOptions: Record<string, string> = Object.fromEntries(
    options.map(({ key, label, km }) => [
      key,
      km === null ? label : `${Math.round(km)} km · ${label}`,
    ]),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const place = linkedPlace() ?? selected?.toPlace();
    if (!place) return;
    onConfirm(place, slot, slot && pause !== '' ? Number(pause) : undefined);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Ajouter une recharge</DialogTitle>
            <DialogDescription>
              La borne devient une étape du planning, comptée avec sa pause.
            </DialogDescription>
          </DialogHeader>

          <LabeledSelect
            id="charge-slot"
            label="Emplacement"
            value={slotKey}
            options={slotOptions}
            onChange={setSlotKey}
          />

          {!linked &&
            (options.length > 0 ? (
              <LabeledSelect
                id="charge-borne"
                label="Borne"
                value={selected?.key ?? ''}
                options={borneOptions}
                onChange={setBornePick}
              />
            ) : (
              !stations.isError && (
                <p className="text-sm text-muted-foreground">
                  {stations.isFetching
                    ? 'Recherche des bornes…'
                    : 'Aucune borne à cette puissance : baissez-la dans Lieux, ou collez un lien.'}
                </p>
              )
            ))}
          {stations.isError && (
            <p role="alert" className="text-sm text-destructive">
              {stations.error.message}. Vous pouvez coller un lien Google Maps.
            </p>
          )}

          <MapLinkField
            onResolved={(result) => {
              setLinked(result);
              setLinkedName(result.name);
            }}
            onClear={() => setLinked(null)}
          />
          {linked && (
            <div className="grid gap-1.5">
              <Label htmlFor="charge-name">Nom de la borne</Label>
              <Input
                id="charge-name"
                required
                value={linkedName}
                onChange={(event) => setLinkedName(event.target.value)}
              />
            </div>
          )}

          {slot && (
            <div className="grid gap-1.5">
              <Label htmlFor="charge-pause">Pause (min)</Label>
              <Input
                id="charge-pause"
                type="number"
                min={0}
                step={5}
                className="w-28"
                value={pause}
                onChange={(event) => setPause(event.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Ajouter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
