import { Plus, Star, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { MapLinkField } from '@/components/MapLinkField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSaveSettings, useSettings } from '@/lib/hooks';
import { stationFromLink, toggleFavoriteStation } from '../../shared/charging-networks';
import type { FavoriteStation, MapLinkResult } from '../../shared/schema';

/** Bornes favorites, communes à tous les voyages, ajoutées d'une étoile ou par lien. */
export function FavoriteStations({ onAdd }: { onAdd: (station: FavoriteStation) => void }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const favorites = settings.favoriteStations ?? [];
  const [linked, setLinked] = useState<MapLinkResult | null>(null);
  const [name, setName] = useState('');
  const [formKey, setFormKey] = useState(0);

  const toggle = (station: FavoriteStation) =>
    save.mutate({ ...settings, favoriteStations: toggleFavoriteStation(favorites, station) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!linked) return;
    toggle(stationFromLink(linked, name.trim() || 'Borne favorite', crypto.randomUUID()));
    setLinked(null);
    setName('');
    setFormKey((key) => key + 1);
  };

  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">Mes bornes favorites ({favorites.length})</h3>
      {favorites.length > 0 && (
        <ul className="grid gap-2">
          {favorites.map((station) => (
            <li key={station.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1 font-medium">
                <Star className="size-3.5 shrink-0 fill-yellow-500 text-yellow-500" aria-hidden />
                <span className="truncate">{station.name}</span>
              </span>
              <span className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Ajouter ${station.name} au voyage`}
                  onClick={() => onAdd(station)}
                >
                  <Plus aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Retirer ${station.name} des favoris`}
                  onClick={() => toggle(station)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form key={formKey} onSubmit={submit} className="grid gap-2">
        <MapLinkField
          onResolved={(result) => {
            setLinked(result);
            setName(result.name);
          }}
          onClear={() => setLinked(null)}
        />
        {linked && (
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="favorite-name">Nom de la borne</Label>
              <Input
                id="favorite-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline">
              <Star aria-hidden />
              Ajouter aux favoris
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
