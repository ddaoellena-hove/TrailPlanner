import { AlertTriangle, FileUp, Loader2 } from 'lucide-react';
import { type DragEvent, type FormEvent, useId, useRef, useState } from 'react';
import { ActivityStats, SourceBadge } from '@/components/ActivityStats';
import { TrackMap } from '@/components/TrackMap';
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
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatActivityDate, formatTimeOfDay } from '../../shared/format';
import { MAX_GPX_BYTES } from '../../shared/gpx';
import type { Activity, ActivityPreview } from '../../shared/schema';

type State =
  | { step: 'empty' }
  | { step: 'reading'; fileName: string }
  | { step: 'error'; fileName: string; message: string }
  | { step: 'ready'; file: File; preview: ActivityPreview; importing: boolean; importError?: string };

function describe(activity: Pick<Activity, 'title' | 'activityDate'>): string {
  return activity.activityDate
    ? `« ${activity.title} », ${formatActivityDate(activity.activityDate)}`
    : `« ${activity.title} »`;
}

/** Choix du fichier, glisser-déposer compris. */
function FilePicker({
  onFile,
  compact = false,
}: {
  onFile: (file: File) => void;
  compact?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cn(
        'grid justify-items-center gap-3 rounded-lg border border-dashed text-center',
        compact ? 'p-3' : 'px-4 py-10',
        dragging && 'border-primary bg-primary/5',
      )}
    >
      {!compact && <FileUp className="size-8 text-muted-foreground" aria-hidden />}
      {!compact && (
        <p className="max-w-sm text-sm text-muted-foreground">
          Déposez le GPX d'une sortie enregistrée avec AllTrails (pas celui d'un itinéraire), ou
          choisissez-le. 10 Mo au plus.
        </p>
      )}
      <Label htmlFor={inputId} className="sr-only">
        Fichier GPX
      </Label>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept=".gpx,application/gpx+xml"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button type="button" variant={compact ? 'outline' : 'default'} size="sm" onClick={() => input.current?.click()}>
        {compact ? 'Choisir un autre fichier' : 'Choisir un fichier GPX'}
      </Button>
    </div>
  );
}

/**
 * Import d'une sortie : fichier → lecture → aperçu (avec doublon éventuel) → confirmation.
 * Rien n'est enregistré avant le clic sur « Importer ».
 */
export function ActivityImportDialog({
  activities,
  onClose,
  onImported,
  onOpenExisting,
}: {
  activities: Activity[];
  onClose: () => void;
  onImported: (activity: Activity) => void;
  onOpenExisting: (activityId: string) => void;
}) {
  const [state, setState] = useState<State>({ step: 'empty' });
  const [title, setTitle] = useState('');

  const read = async (file: File) => {
    if (file.size > MAX_GPX_BYTES) {
      setState({ step: 'error', fileName: file.name, message: 'Fichier trop volumineux (10 Mo maximum)' });
      return;
    }
    setState({ step: 'reading', fileName: file.name });
    try {
      const preview = await api.previewActivity(file);
      setTitle(preview.draft.title);
      setState({ step: 'ready', file, preview, importing: false });
    } catch (error) {
      setState({
        step: 'error',
        fileName: file.name,
        message: error instanceof Error ? error.message : 'Lecture impossible',
      });
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (state.step !== 'ready') return;
    setState({ ...state, importing: true, importError: undefined });
    try {
      const activity = await api.importActivity(state.file, {
        title: title.trim(),
        confirmProbableDuplicate: state.preview.duplicate.status === 'probable',
      });
      onImported(activity);
    } catch (error) {
      setState({
        ...state,
        importing: false,
        importError: error instanceof Error ? error.message : 'Import impossible',
      });
    }
  };

  const duplicate = state.step === 'ready' ? state.preview.duplicate : null;
  const existing =
    duplicate && duplicate.status !== 'none'
      ? activities.find(({ id }) => id === duplicate.activityId)
      : undefined;
  const draft = state.step === 'ready' ? state.preview.draft : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={confirm}>
          <DialogHeader>
            <DialogTitle>Importer une sortie</DialogTitle>
            <DialogDescription>
              Vérifiez l'aperçu avant d'importer : rien n'est enregistré avant votre confirmation.
            </DialogDescription>
          </DialogHeader>

          {state.step === 'empty' && <FilePicker onFile={read} />}

          {state.step === 'reading' && (
            <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Lecture de {state.fileName}…
            </p>
          )}

          {state.step === 'error' && (
            <div className="grid gap-3">
              <div role="alert" className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">Import impossible : {state.message}</p>
                <p className="text-muted-foreground">
                  {state.fileName}. Exportez la sortie depuis AllTrails au format GPX, puis
                  réessayez avec ce fichier. Vos sorties existantes ne sont pas touchées.
                </p>
              </div>
              <FilePicker onFile={read} compact />
            </div>
          )}

          {state.step === 'ready' && draft && (
            <div className="grid gap-4">
              {duplicate?.status === 'exact' && (
                <div role="alert" className="grid gap-2 rounded-lg border border-tone-warning/40 bg-tone-warning/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-tone-warning">
                    <AlertTriangle className="size-4" aria-hidden />
                    Ce fichier a déjà été importé
                  </p>
                  <p className="text-muted-foreground">
                    {existing ? describe(existing) : 'Une sortie'} vient exactement du même fichier.
                    Il ne sera pas importé une seconde fois.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => onOpenExisting(duplicate.activityId)}
                  >
                    Voir la sortie existante
                  </Button>
                </div>
              )}
              {duplicate?.status === 'probable' && (
                <div role="alert" className="grid gap-1 rounded-lg border border-tone-warning/40 bg-tone-warning/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-tone-warning">
                    <AlertTriangle className="size-4" aria-hidden />
                    Cette sortie ressemble à une sortie déjà importée
                  </p>
                  <p className="text-muted-foreground">
                    {existing ? describe(existing) : 'Une sortie'} a commencé à la même heure, sur
                    la même trace et la même distance. S'il s'agit bien d'une autre sortie,
                    importez-la quand même : l'existante ne sera pas modifiée.
                  </p>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="activity-title">Titre</Label>
                <Input
                  id="activity-title"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <SourceBadge source={draft.source} />
                <span>
                  {draft.activityDate
                    ? `${formatActivityDate(draft.activityDate)}, départ ${formatTimeOfDay(draft.activityDate)}`
                    : 'Date inconnue : le fichier ne contient pas d’heures'}
                </span>
              </div>
              {draft.source === 'gpx' && (
                <p className="text-xs text-muted-foreground">
                  Le fichier n'indique pas venir d'AllTrails : il sera marqué « GPX ».
                </p>
              )}

              <ActivityStats activity={draft} />

              <div className="h-56 overflow-hidden rounded-lg border">
                <TrackMap
                  tracks={[{ id: 'preview', lines: [draft.profile.map(({ lng, lat }) => [lng, lat])] }]}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {draft.originalFileName} · {draft.pointCount.toLocaleString('fr-FR')} points. Le
                fichier original sera conservé tel quel.
              </p>

              {state.importError && (
                <p role="alert" className="text-sm text-destructive">
                  Import impossible : {state.importError}
                </p>
              )}

              <FilePicker onFile={read} compact />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            {state.step === 'ready' && duplicate?.status !== 'exact' && (
              <Button type="submit" disabled={state.importing || title.trim() === ''}>
                {state.importing && <Loader2 className="animate-spin" aria-hidden />}
                {duplicate?.status === 'probable' ? 'Importer quand même' : 'Importer'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
