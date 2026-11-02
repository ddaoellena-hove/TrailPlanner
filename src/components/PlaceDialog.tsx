import { type FormEvent, useState } from 'react';
import { AddressField } from '@/components/AddressField';
import { LabeledSelect } from '@/components/HikeSelects';
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
import { Textarea } from '@/components/ui/textarea';
import { BOOKING_LABELS, PLACE_TYPE_LABELS } from '@/lib/labels';
import type { LatLng, Place, PlaceType } from '../../shared/schema';

const BOOKING_OPTIONS = { none: 'Non renseigné', ...BOOKING_LABELS };
const DOG_OPTIONS = {
  unknown: 'À confirmer',
  allowed: 'Chiens autorisés',
  forbidden: 'Chiens interdits',
};

export function PlaceDialog({
  place,
  initialLocation,
  onClose,
  onSubmit,
  onDelete,
}: {
  place?: Place;
  initialLocation?: LatLng;
  onClose: () => void;
  onSubmit: (values: Omit<Place, 'id'>) => Promise<void>;
  onDelete: (placeId: string) => void;
}) {
  const [type, setType] = useState<PlaceType>(place?.type ?? 'poi');
  const [name, setName] = useState(place?.name ?? '');
  const [location, setLocation] = useState(place?.location ?? initialLocation ?? null);
  const [url, setUrl] = useState(place?.url ?? '');
  const [price, setPrice] = useState(place?.price?.toString() ?? '');
  const [bookingStatus, setBookingStatus] = useState<keyof typeof BOOKING_OPTIONS>(
    place?.bookingStatus ?? 'none',
  );
  const [dogPolicy, setDogPolicy] = useState<keyof typeof DOG_OPTIONS>(
    place?.dogPolicy ?? 'unknown',
  );
  const [notes, setNotes] = useState(place?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isLodging = type === 'lodging';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!location) {
      setError("Choisissez l'adresse dans la liste");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        type,
        name: name.trim(),
        location,
        url: url.trim() || undefined,
        notes: notes.trim() || undefined,
        price: isLodging && price !== '' ? Number(price) : undefined,
        bookingStatus: isLodging && bookingStatus !== 'none' ? bookingStatus : undefined,
        dogPolicy: isLodging ? dogPolicy : undefined,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{place ? 'Modifier le lieu' : 'Nouveau lieu'}</DialogTitle>
            <DialogDescription>
              {initialLocation ? 'Position choisie sur la carte.' : 'Hébergement, recharge, ravitaillement, parking ou point d’intérêt.'}
            </DialogDescription>
          </DialogHeader>

          <LabeledSelect
            id="place-type"
            label="Type de lieu"
            value={type}
            options={PLACE_TYPE_LABELS}
            onChange={setType}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="place-name">Nom du lieu</Label>
            <Input
              id="place-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <AddressField
            id="place-address"
            label="Adresse"
            placeholder={location ? "Laisser vide pour garder la position" : 'Gap, 05000'}
            onType={() => setLocation(place?.location ?? initialLocation ?? null)}
            onSelect={(result) => {
              setLocation(result.location);
              setName((current) => current || result.label);
            }}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="place-url">Lien</Label>
            <Input
              id="place-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          {isLodging && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="place-price">Prix par nuit (€)</Label>
                  <Input
                    id="place-price"
                    type="number"
                    min={0}
                    step="any"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </div>
                <LabeledSelect
                  id="place-booking"
                  label="Réservation"
                  value={bookingStatus}
                  options={BOOKING_OPTIONS}
                  onChange={setBookingStatus}
                />
              </div>
              <LabeledSelect
                id="place-dog"
                label="Politique chiens du lieu"
                value={dogPolicy}
                options={DOG_OPTIONS}
                onChange={setDogPolicy}
              />
            </>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="place-notes">Notes du lieu</Label>
            <Textarea
              id="place-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="sm:justify-between">
            {place ? (
              <Button type="button" variant="destructive" onClick={() => onDelete(place.id)}>
                Supprimer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" disabled={saving}>
                Enregistrer
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
