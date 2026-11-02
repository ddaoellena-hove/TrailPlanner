import { useState } from 'react';
import { HikeSelects } from '@/components/HikeSelects';
import { hikeSummary } from '@/components/StopDetails';
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
import type { Hike } from '../../shared/schema';

/** Confirmation après dépôt : nom, lien AllTrails, type et politique chiens de chaque rando. */
export function ImportDialog({
  hikes,
  onClose,
  onConfirm,
}: {
  hikes: Hike[];
  onClose: () => void;
  onConfirm: (hikes: Hike[]) => void;
}) {
  const [drafts, setDrafts] = useState(hikes);
  const [alltrailsUrls, setAlltrailsUrls] = useState<Record<string, string>>({});

  const update = (id: string, changes: Partial<Hike>) =>
    setDrafts((current) =>
      current.map((hike) => (hike.id === id ? { ...hike, ...changes } : hike)),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(
              drafts.map((hike) => ({
                ...hike,
                alltrailsUrl: alltrailsUrls[hike.id]?.trim() || undefined,
              })),
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {drafts.length > 1 ? `Importer ${drafts.length} randos` : 'Importer la rando'}
            </DialogTitle>
            <DialogDescription>Le type est déduit du tracé, à corriger si besoin.</DialogDescription>
          </DialogHeader>

          {drafts.map((hike) => (
            <section key={hike.id} className="grid gap-3 border-b pb-4 last:border-b-0 last:pb-0">
              <p className="text-sm text-muted-foreground tabular-nums">{hikeSummary(hike)}</p>
              <div className="grid gap-1.5">
                <Label htmlFor={`import-${hike.id}-name`}>Nom</Label>
                <Input
                  id={`import-${hike.id}-name`}
                  required
                  value={hike.name}
                  onChange={(event) => update(hike.id, { name: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`import-${hike.id}-url`}>Lien AllTrails</Label>
                <Input
                  id={`import-${hike.id}-url`}
                  type="url"
                  placeholder="https://www.alltrails.com/fr/randonnee/…"
                  value={alltrailsUrls[hike.id] ?? ''}
                  onChange={(event) =>
                    setAlltrailsUrls((current) => ({
                      ...current,
                      [hike.id]: event.target.value,
                    }))
                  }
                />
              </div>
              <HikeSelects
                idPrefix={`import-${hike.id}`}
                kind={hike.kind}
                dogPolicy={hike.dogPolicy}
                onChange={(changes) => update(hike.id, changes)}
              />
            </section>
          ))}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">Ajouter à la bibliothèque</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
