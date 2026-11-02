import { ExternalLink, TriangleAlert } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { HikeSelects } from '@/components/HikeSelects';
import { ProfileChart } from '@/components/ProfileChart';
import { Button } from '@/components/ui/button';
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
import { KIND_LABELS } from '@/lib/labels';
import { formatDuration, formatKm } from '../../shared/format';
import { buildProfile } from '../../shared/profile';
import type { Hike } from '../../shared/schema';

function altitude(value: number | null): string {
  return value === null ? 'Inconnu' : `${value} m`;
}

export function HikeSheet({
  hike,
  onClose,
  onSave,
  onReplaceGpx,
  onDelete,
  outings,
}: {
  hike: Hike;
  onClose: () => void;
  onSave: (changes: Partial<Hike>) => Promise<unknown>;
  onReplaceGpx: (file: File) => Promise<unknown>;
  onDelete: () => void;
  outings?: ReactNode;
}) {
  const [name, setName] = useState(hike.name);
  const [alltrailsUrl, setAlltrailsUrl] = useState(hike.alltrailsUrl ?? '');
  const [kind, setKind] = useState(hike.kind);
  const [dogPolicy, setDogPolicy] = useState(hike.dogPolicy);
  const [notes, setNotes] = useState(hike.notes ?? '');
  const [tags, setTags] = useState(hike.tags?.join(', ') ?? '');
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const points = useMemo(() => buildProfile([hike]), [hike]);
  const { stats } = hike;
  const hasAltitude = stats.elevationGainM !== null;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    void run(async () => {
      await onSave({
        name: name.trim() || hike.name,
        alltrailsUrl: alltrailsUrl.trim() || undefined,
        kind,
        dogPolicy,
        notes: notes.trim() || undefined,
        tags: tagList.length > 0 ? tagList : undefined,
      });
      onClose();
    });
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{hike.name}</SheetTitle>
          <SheetDescription>{KIND_LABELS[hike.kind]}</SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="mt-4 grid gap-4">
          {!hasAltitude && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              Ce GPX n'a pas d'altitude : dénivelé inconnu, durée calculée sur la distance seule.
            </p>
          )}

          <dl className="grid grid-cols-3 gap-3 text-sm tabular-nums">
            {[
              ['Distance', formatKm(stats.distanceKm)],
              ['Durée estimée', formatDuration(stats.estimatedDurationMin)],
              ['D+', altitude(stats.elevationGainM)],
              ['D−', altitude(stats.elevationLossM)],
              ['Altitude max', altitude(stats.maxAltitudeM)],
              ['Altitude min', altitude(stats.minAltitudeM)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {hasAltitude && (
            <div className="h-36">
              <ProfileChart points={points} cursorIndex={cursor} onCursorChange={setCursor} />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="hike-name">Nom</Label>
            <Input id="hike-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="hike-url">Lien AllTrails</Label>
            <Input
              id="hike-url"
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
            idPrefix="hike"
            kind={kind}
            dogPolicy={dogPolicy}
            onChange={(changes) => {
              if (changes.kind) setKind(changes.kind);
              if (changes.dogPolicy) setDogPolicy(changes.dogPolicy);
            }}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="hike-notes">Notes</Label>
            <Textarea
              id="hike-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="hike-tags">Tags</Label>
            <Input
              id="hike-tags"
              placeholder="hiver, panoramique"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="hike-replace">Remplacer le GPX</Label>
            <Input
              id="hike-replace"
              type="file"
              accept=".gpx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void run(() => onReplaceGpx(file));
              }}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-between gap-2">
            <Button type="button" variant="destructive" onClick={onDelete}>
              Supprimer
            </Button>
            <Button type="submit">Enregistrer</Button>
          </div>
        </form>
        {outings && <div className="mt-4">{outings}</div>}
      </SheetContent>
    </Sheet>
  );
}
