import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderSync, Loader2, RefreshCw } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useSettings, useSyncStatus } from '@/lib/hooks';
import { formatShortDate, formatTimeOfDay } from '../../shared/format';
import type { Activity, SyncReport } from '../../shared/schema';
import { isAbsoluteFolder, summarizeSyncReport } from '../../shared/sync';

function FolderForm({ initial, onDone }: { initial: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [folder, setFolder] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string | undefined) =>
      api.saveSettings({ ...settings, activityImportFolder: value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['activity-sync'] });
      onDone();
    },
    onError: (cause) => setError(cause.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = folder.trim();
    if (value !== '' && !isAbsoluteFolder(value)) {
      setError('Indiquez le chemin complet du dossier, par exemple /Users/vous/Downloads/AllTrails.');
      return;
    }
    setError(null);
    save.mutate(value === '' ? undefined : value);
  };

  return (
    <form onSubmit={submit} className="grid gap-2">
      <Label htmlFor="sync-folder">Dossier des exports AllTrails</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="sync-folder"
          className="min-w-64 flex-1 font-mono text-sm"
          placeholder="/Users/vous/Downloads/AllTrails"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        />
        <Button type="submit" disabled={save.isPending}>
          Enregistrer
        </Button>
        {initial !== '' && (
          <Button type="button" variant="outline" onClick={onDone}>
            Annuler
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        TrailPlanner lit les fichiers .gpx de ce dossier sans jamais les modifier, les déplacer ni
        les supprimer. Laissez vide pour arrêter la synchronisation.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function RunReport({ report }: { report: SyncReport }) {
  return (
    <div className="grid gap-1 text-sm">
      <p>
        <span className="text-muted-foreground">
          Dernière synchronisation le {formatShortDate(report.finishedAt)} à{' '}
          {formatTimeOfDay(report.finishedAt)} :
        </span>{' '}
        {summarizeSyncReport(report)}
      </p>
      {report.failed.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-destructive">
          {report.failed.map(({ fileName, error }) => (
            <li key={fileName}>
              {fileName} : {error}. Le fichier sera réessayé à la prochaine synchronisation.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AutoSyncSwitch({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const save = useMutation({
    mutationFn: (activityAutoSync: boolean) => api.saveSettings({ ...settings, activityAutoSync }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['activity-sync'] });
    },
    onError: (error) => toast.error(`Réglage non enregistré : ${error.message}`),
  });
  return (
    <div className="flex items-center gap-2">
      <Switch
        id="auto-sync"
        checked={enabled}
        disabled={save.isPending}
        onCheckedChange={(checked) => save.mutate(checked)}
      />
      <Label htmlFor="auto-sync" className="font-normal">
        Synchroniser automatiquement toutes les 5 minutes
      </Label>
    </div>
  );
}

/**
 * Synchronisation depuis le dossier surveillé : réglage du dossier, passage à la demande,
 * compte rendu, et choix sur les doublons probables mis en attente.
 */
export function SyncPanel({
  activities,
  onOpen,
}: {
  activities: Activity[];
  onOpen: (activityId: string) => void;
}) {
  const queryClient = useQueryClient();
  const status = useSyncStatus();
  const [editing, setEditing] = useState(false);
  // Un passage automatique a pu importer des sorties : la liste suit le dernier passage.
  const lastFinished = status.data?.lastRun?.finishedAt;
  const seenRun = useRef(lastFinished);
  useEffect(() => {
    if (lastFinished === seenRun.current) return;
    seenRun.current = lastFinished;
    void queryClient.invalidateQueries({ queryKey: ['activities'] });
  }, [lastFinished, queryClient]);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['activity-sync'] });
    await queryClient.invalidateQueries({ queryKey: ['activities'] });
  };

  const run = useMutation({
    mutationFn: api.runSync,
    onSuccess: async (report) => {
      await refresh();
      toast.success(`Synchronisation terminée : ${summarizeSyncReport(report)}`);
    },
    onError: (error) => toast.error(`Synchronisation impossible : ${error.message}`),
  });
  const decide = useMutation({
    mutationFn: ({ hash, action }: { hash: string; action: 'import' | 'ignore' }) =>
      api.decideSync(hash, action),
    onSuccess: refresh,
    onError: (error) => toast.error(`Choix non enregistré : ${error.message}`),
  });

  if (status.isPending) return null;
  if (status.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        État de la synchronisation indisponible : {status.error.message}
      </p>
    );
  }
  const { folder, lastRun, lastError, pending, autoSync } = status.data;
  const running = run.isPending || status.data.running;

  return (
    <section aria-label="Synchronisation" className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <FolderSync className="size-4 text-muted-foreground" aria-hidden />
          Synchronisation
        </h2>
        {folder && !editing && (
          <Button size="sm" disabled={running} onClick={() => run.mutate()}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {running ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </Button>
        )}
      </div>

      {!folder || editing ? (
        <>
          {!folder && (
            <p className="text-sm text-muted-foreground">
              AllTrails ne permet pas de récupérer vos sorties automatiquement. Exportez-les en GPX
              dans un dossier : TrailPlanner importera les nouvelles à chaque synchronisation.
            </p>
          )}
          <FolderForm initial={folder ?? ''} onDone={() => setEditing(false)} />
        </>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted-foreground">Dossier :</span>
          <code className="break-all text-xs">{folder}</code>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setEditing(true)}>
            Modifier
          </Button>
        </p>
      )}

      {folder && !editing && <AutoSyncSwitch enabled={autoSync} />}

      {lastError && (
        <p role="alert" className="text-sm text-destructive">
          Synchronisation impossible le {formatShortDate(lastError.at)} à{' '}
          {formatTimeOfDay(lastError.at)} : {lastError.message}. Vérifiez le dossier, puis
          relancez.
        </p>
      )}

      {lastRun && lastRun.folder === folder && <RunReport report={lastRun} />}

      {pending.length > 0 && (
        <div className="grid gap-2 rounded-md border border-tone-warning/40 bg-tone-warning/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-tone-warning">
            <AlertTriangle className="size-4" aria-hidden />
            {pending.length > 1
              ? `${pending.length} fichiers ressemblent à des sorties déjà importées`
              : 'Un fichier ressemble à une sortie déjà importée'}
          </p>
          <ul className="grid gap-2">
            {pending.map((file) => {
              const match = activities.find(({ id }) => id === file.activityId);
              return (
                <li key={file.hash} className="grid gap-1.5 text-sm">
                  <span>
                    <code className="text-xs">{file.fileName}</code>{' '}
                    <span className="text-muted-foreground">ressemble à</span>{' '}
                    {match ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => onOpen(match.id)}
                      >
                        « {match.title} »
                      </Button>
                    ) : (
                      'une sortie existante'
                    )}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ hash: file.hash, action: 'import' })}
                    >
                      Importer quand même
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ hash: file.hash, action: 'ignore' })}
                    >
                      Ignorer
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
