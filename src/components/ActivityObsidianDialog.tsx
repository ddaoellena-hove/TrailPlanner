import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { Activity } from '../../shared/schema';

const NO_PROJECT = '__none__';

export function ActivityObsidianDialog({
  activity,
  onClose,
}: {
  activity: Activity;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const alreadyExported = Boolean(activity.obsidian?.notePath);
  const [projectName, setProjectName] = useState<string | null>(
    activity.obsidian?.projectName ?? null,
  );

  const health = useQuery({ queryKey: ['health'], queryFn: api.getHealth });
  const vaultReady = health.data?.obsidian === 'configured';

  const projects = useQuery({
    queryKey: ['obsidian-projects', ''],
    queryFn: () => api.obsidianProjects(''),
    enabled: vaultReady,
    retry: false,
  });

  const preview = useQuery({
    queryKey: ['obsidian-activity-preview', activity.id, activity.linkedRouteId, projectName],
    queryFn: () => api.obsidianActivityPreview(activity.id, { projectName }),
  });

  const exportActivity = useMutation({
    mutationFn: () => api.obsidianActivityExport(activity.id, { projectName }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['activities'] });
      toast.success(`Sortie exportée dans ${updated.obsidian?.notePath ?? 'Sport/'}`);
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exporter la sortie vers Obsidian</DialogTitle>
          <DialogDescription>
            {alreadyExported
              ? 'Déjà exportée : les données seront mises à jour sans toucher à votre section Ressenti.'
              : 'Crée une note de séance dans Sport/ (Bases/Sport.base), avec lien optionnel vers un Projet.'}
          </DialogDescription>
        </DialogHeader>

        {health.data?.obsidian === 'missing' && (
          <p role="alert" className="text-sm text-destructive">
            Export désactivé : renseignez le dossier du vault Obsidian dans les Réglages (ou
            OBSIDIAN_VAULT_DIR dans .env). L’aperçu reste disponible.
          </p>
        )}
        {health.data?.obsidian === 'invalid' && (
          <p role="alert" className="text-sm text-destructive">
            Vault Obsidian introuvable : vérifiez le chemin configuré dans les Réglages (ou
            OBSIDIAN_VAULT_DIR dans .env).
          </p>
        )}

        {vaultReady && (
          <div className="grid gap-1.5">
            <Label htmlFor="activity-obsidian-project">Projet lié (optionnel)</Label>
            <Select
              value={projectName ?? NO_PROJECT}
              onValueChange={(value) => setProjectName(value === NO_PROJECT ? null : value)}
            >
              <SelectTrigger id="activity-obsidian-project">
                <SelectValue placeholder="Aucun projet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>Aucun projet</SelectItem>
                {projects.data?.map((project) => (
                  <SelectItem key={project.name} value={project.name}>
                    {project.name}
                    {project.area ? ` · ${project.area}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {preview.data && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Fichier cible : <code>{preview.data.relativePath}</code>
          </p>
        )}

        <section className="grid gap-1.5">
          <h3 className="text-sm font-medium">Aperçu</h3>
          {preview.isPending && <Skeleton className="h-40" />}
          {preview.isError && (
            <p role="alert" className="text-sm text-destructive">
              {preview.error.message}
            </p>
          )}
          {preview.data && (
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap">
              {preview.data.markdown}
            </pre>
          )}
        </section>

        {exportActivity.isError && (
          <p role="alert" className="text-sm text-destructive">
            {exportActivity.error.message}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button
            disabled={!vaultReady || exportActivity.isPending}
            onClick={() => exportActivity.mutate()}
          >
            {alreadyExported ? 'Mettre à jour dans Sport/' : 'Exporter dans Sport/'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
