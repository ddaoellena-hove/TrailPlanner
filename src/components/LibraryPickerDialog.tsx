import { useMemo, useState } from 'react';
import { HikeBadges } from '@/components/StopDetails';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useLibrary, useLibraryLinks } from '@/lib/hooks';
import { filterLibraryHikes, NO_FILTERS } from '../../shared/library';
import type { Trip } from '../../shared/schema';

/** Choisit des randos de la bibliothèque : elles sont copiées dans le voyage. */
export function LibraryPickerDialog({
  trip,
  onClose,
  onConfirm,
}: {
  trip: Trip;
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void>;
}) {
  const library = useLibrary();
  const links = useLibraryLinks(trip);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const present = useMemo(() => new Set(Object.values(links.data ?? {})), [links.data]);
  const hikes = filterLibraryHikes(library.data ?? [], { ...NO_FILTERS, query });

  const confirm = async () => {
    setSaving(true);
    await onConfirm(selected);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Depuis ma bibliothèque</DialogTitle>
          <DialogDescription>
            Chaque rando choisie est copiée dans le voyage, qui ne dépend plus de la bibliothèque.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Rechercher une rando"
          placeholder="Nom ou tag"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {hikes.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune rando trouvée.</p>
        )}
        <ul className="grid gap-3">
          {hikes.map((hike) => {
            const isPresent = present.has(hike.id);
            return (
              <li key={hike.id} className="flex items-start gap-2">
                <Checkbox
                  id={`pick-${hike.id}`}
                  disabled={isPresent}
                  checked={selected.includes(hike.id)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked === true
                        ? [...current, hike.id]
                        : current.filter((id) => id !== hike.id),
                    )
                  }
                />
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`pick-${hike.id}`} className="truncate">
                    {hike.name}
                  </Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <HikeBadges hike={hike} />
                    {isPresent && <Badge variant="outline">Déjà dans ce voyage</Badge>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={selected.length === 0 || saving} onClick={() => void confirm()}>
            Ajouter au voyage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
