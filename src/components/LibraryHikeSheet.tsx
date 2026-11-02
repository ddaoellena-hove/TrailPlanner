import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { HikeSelects } from '@/components/HikeSelects';
import { OutingsSection } from '@/components/OutingsSection';
import { ProfileChart } from '@/components/ProfileChart';
import { RatingStars } from '@/components/RatingStars';
import { HikeBadges } from '@/components/StopDetails';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { KIND_LABELS } from '@/lib/labels';
import { buildProfile } from '../../shared/profile';
import type { LibraryHike } from '../../shared/schema';

export function LibraryHikeSheet({ hike, onClose }: { hike: LibraryHike; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(hike.name);
  const [alltrailsUrl, setAlltrailsUrl] = useState(hike.alltrailsUrl ?? '');
  const [dogPolicy, setDogPolicy] = useState(hike.dogPolicy);
  const [rating, setRating] = useState(hike.rating);
  const [notes, setNotes] = useState(hike.notes ?? '');
  const [tags, setTags] = useState(hike.tags?.join(', ') ?? '');
  const [cursor, setCursor] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const points = useMemo(() => buildProfile([hike]), [hike]);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['library'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      return api.updateLibraryHike(hike.id, {
        name: name.trim() || hike.name,
        alltrailsUrl: alltrailsUrl.trim() || undefined,
        dogPolicy,
        notes: notes.trim() || undefined,
        tags: tagList.length > 0 ? tagList : undefined,
        rating,
      });
    },
    onSuccess: done,
    onError: (error) => toast.error(`Enregistrement impossible : ${error.message}`),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteLibraryHike(hike.id),
    onSuccess: done,
    onError: (error) => toast.error(`Suppression impossible : ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{hike.name}</SheetTitle>
          <SheetDescription>{KIND_LABELS[hike.kind]}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap gap-1.5">
            <HikeBadges hike={hike} />
          </div>

          {hike.stats.elevationGainM !== null && (
            <div className="h-36">
              <ProfileChart points={points} cursorIndex={cursor} onCursorChange={setCursor} />
            </div>
          )}

          <OutingsSection hike={hike} defaultDate={new Date().toISOString().slice(0, 10)} />

          <form onSubmit={submit} className="grid gap-4 border-t pt-4">
            <div className="grid gap-1.5">
              <Label>Note</Label>
              <RatingStars value={rating} onChange={setRating} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="library-name">Nom</Label>
              <Input
                id="library-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="library-url">Lien AllTrails</Label>
              <Input
                id="library-url"
                type="url"
                value={alltrailsUrl}
                onChange={(event) => setAlltrailsUrl(event.target.value)}
              />
              {hike.alltrailsUrl && (
                <a
                  href={hike.alltrailsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  Ouvrir sur AllTrails
                </a>
              )}
            </div>

            <HikeSelects
              idPrefix="library"
              kind={hike.kind}
              dogPolicy={dogPolicy}
              onChange={(changes) => {
                if (changes.dogPolicy) setDogPolicy(changes.dogPolicy);
              }}
            />

            <div className="grid gap-1.5">
              <Label htmlFor="library-notes">Notes</Label>
              <Textarea
                id="library-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="library-tags">Tags</Label>
              <Input
                id="library-tags"
                placeholder="hiver, panoramique"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </div>

            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Supprimer
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Enregistrer
              </Button>
            </div>
          </form>
        </div>

        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retirer « {hike.name} » de la bibliothèque ?</AlertDialogTitle>
              <AlertDialogDescription>
                Sa note et ses sorties disparaissent. Les voyages qui l'utilisent gardent leur
                copie.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => remove.mutate()}
              >
                Retirer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
