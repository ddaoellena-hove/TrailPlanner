import { type FormEvent, useState } from 'react';
import { AddressField } from '@/components/AddressField';
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
import { Switch } from '@/components/ui/switch';
import type { Hike, LatLng, Place, StopPlaces } from '../../shared/schema';

export type StopValues = {
  withTrail: boolean;
  name: string;
  alltrailsUrl: string;
  file: File | null;
  places: StopPlaces;
};

/** Sans `hike` ni `isStay`, ajoute une étape ; sinon modifie celle-ci, sans changer son type. */
export function StopDialog({
  hike,
  isStay = false,
  departure,
  stay,
  title,
  onClose,
  onSubmit,
}: {
  hike?: Hike;
  isStay?: boolean;
  departure?: Place;
  stay?: Place;
  title: string;
  onClose: () => void;
  onSubmit: (values: StopValues) => Promise<void>;
}) {
  const editing = Boolean(hike) || isStay;
  const [withTrail, setWithTrail] = useState(!isStay);
  const [name, setName] = useState(hike?.name ?? '');
  const [alltrailsUrl, setAlltrailsUrl] = useState(hike?.alltrailsUrl ?? '');
  const [file, setFile] = useState<File | null>(null);

  const [fromPreviousStay, setFromPreviousStay] = useState(!departure);
  const [departureLocation, setDepartureLocation] = useState<LatLng | null>(
    departure?.location ?? null,
  );
  const [departureLabel, setDepartureLabel] = useState(departure?.name ?? '');

  const [hasStay, setHasStay] = useState(Boolean(stay));
  const [stayLocation, setStayLocation] = useState<LatLng | null>(stay?.location ?? null);
  const [stayLabel, setStayLabel] = useState('');
  const [stayName, setStayName] = useState(stay?.name ?? '');
  const [stayUrl, setStayUrl] = useState(stay?.url ?? '');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stayVisible = !withTrail || hasStay;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!fromPreviousStay && !departureLocation) {
      setError('Choisissez le lieu de départ dans la liste');
      return;
    }
    if (stayVisible && !stayLocation) {
      setError('Choisissez le lieu de séjour dans la liste');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        withTrail,
        name,
        alltrailsUrl,
        file,
        places: {
          departure:
            !fromPreviousStay && departureLocation
              ? { name: departureLabel, location: departureLocation }
              : null,
          stay:
            stayVisible && stayLocation
              ? {
                  name: stayName.trim() || stayLabel || (stay?.name ?? ''),
                  location: stayLocation,
                  url: stayUrl.trim() || undefined,
                }
              : null,
        },
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
        <form onSubmit={(event) => void submit(event)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Le trajet part du lieu de séjour de l'étape précédente, sauf si vous indiquez un
              autre départ.
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <div className="flex items-center gap-2">
              <Switch id="stop-trail" checked={withTrail} onCheckedChange={setWithTrail} />
              <Label htmlFor="stop-trail">Étape avec trail</Label>
            </div>
          )}

          <section className="grid gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="stop-from-previous"
                checked={fromPreviousStay}
                onCheckedChange={setFromPreviousStay}
              />
              <Label htmlFor="stop-from-previous">
                Partir du lieu de séjour de l'étape précédente
              </Label>
            </div>
            {!fromPreviousStay && (
              <AddressField
                id="stop-departure"
                label="Lieu de départ"
                initialValue={departure?.name}
                placeholder="Lyon"
                onType={() => setDepartureLocation(departure?.location ?? null)}
                onSelect={(result) => {
                  setDepartureLocation(result.location);
                  setDepartureLabel(result.label);
                }}
              />
            )}
          </section>

          {withTrail && (
            <section className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="stop-url">Lien AllTrails</Label>
                <Input
                  id="stop-url"
                  type="url"
                  placeholder="https://www.alltrails.com/fr/randonnee/…"
                  value={alltrailsUrl}
                  onChange={(event) => setAlltrailsUrl(event.target.value)}
                />
              </div>
              {!editing && (
                <div className="grid gap-1.5">
                  <Label htmlFor="stop-gpx">Fichier GPX</Label>
                  <Input
                    id="stop-gpx"
                    type="file"
                    accept=".gpx"
                    required
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="stop-name">Nom de la rando</Label>
                <Input
                  id="stop-name"
                  required={editing}
                  placeholder="Repris du GPX si vide"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </section>
          )}

          <section className="grid gap-3">
            {withTrail && (
              <div className="flex items-center gap-2">
                <Switch id="stop-has-stay" checked={hasStay} onCheckedChange={setHasStay} />
                <Label htmlFor="stop-has-stay">Lieu de séjour après cette étape</Label>
              </div>
            )}
            {stayVisible && (
              <>
                <AddressField
                  id="stop-stay"
                  label="Adresse du séjour"
                  placeholder={stay ? "Laisser vide pour garder l'adresse actuelle" : 'Gap, 05000'}
                  onType={() => setStayLocation(stay?.location ?? null)}
                  onSelect={(result) => {
                    setStayLocation(result.location);
                    setStayLabel(result.label);
                  }}
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="stop-stay-name">Nom du séjour</Label>
                  <Input
                    id="stop-stay-name"
                    placeholder="Repris de l'adresse si vide"
                    value={stayName}
                    onChange={(event) => setStayName(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="stop-stay-url">Lien du séjour</Label>
                  <Input
                    id="stop-stay-url"
                    type="url"
                    placeholder="https://… (hôtel, réservation)"
                    value={stayUrl}
                    onChange={(event) => setStayUrl(event.target.value)}
                  />
                </div>
              </>
            )}
          </section>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {editing ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
