import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ObsidianTripExportRequest, Trip } from '../../shared/schema';

export function ExportDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const queryClient = useQueryClient();
  const alreadyLinked = Boolean(trip.obsidian?.projectName);
  const [mode, setMode] = useState<'create' | 'link'>('link');
  const [projectName, setProjectName] = useState(trip.name);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const health = useQuery({ queryKey: ['health'], queryFn: api.getHealth });
  const preview = useQuery({
    queryKey: ['obsidian-trip-preview', trip.slug, trip.updatedAt],
    queryFn: () => api.obsidianTripPreview(trip.slug),
  });
  const vaultReady = health.data?.obsidian === 'configured';
  const projects = useQuery({
    queryKey: ['obsidian-projects', debounced],
    queryFn: () => api.obsidianProjects(debounced),
    enabled: vaultReady && mode === 'link' && !alreadyLinked,
    retry: false,
  });

  const exportTrip = useMutation({
    mutationFn: (body: ObsidianTripExportRequest) => api.obsidianTripExport(trip.slug, body),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['trip', trip.slug] });
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
      toast.success(`Carnet exporté dans ${updated.obsidian?.carnetPath ?? 'Obsidian'}`);
      onClose();
    },
  });

  const request: ObsidianTripExportRequest | null = alreadyLinked
    ? { mode: 'link', projectName: trip.obsidian!.projectName }
    : mode === 'create'
      ? projectName.trim()
        ? { mode: 'create', projectName: projectName.trim() }
        : null
      : selectedProject
        ? { mode: 'link', projectName: selectedProject }
        : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exporter vers Obsidian</DialogTitle>
          <DialogDescription>
            {alreadyLinked
              ? `Lié au projet « ${trip.obsidian!.projectName} » : seul le sous-fichier carnet sera remplacé.`
              : 'Le contenu d’un projet existant n’est jamais modifié : seul un sous-fichier carnet dédié est écrit.'}
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

        {alreadyLinked && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Fichier cible : <code>{trip.obsidian!.carnetPath}</code>
          </p>
        )}

        {!alreadyLinked && vaultReady && (
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'create' | 'link')}>
            <TabsList>
              <TabsTrigger value="link">Lier à un projet existant</TabsTrigger>
              <TabsTrigger value="create">Créer un nouveau projet</TabsTrigger>
            </TabsList>
            <TabsContent value="link" className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="obsidian-search">Rechercher un projet dans Projects/</Label>
                <Input
                  id="obsidian-search"
                  placeholder="Ex. Road trip, Écrins…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              {projects.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {projects.error.message}
                </p>
              )}
              {projects.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aucun projet trouvé dans <code>Projects/</code>.
                </p>
              )}
              <ul className="grid max-h-44 gap-1 overflow-y-auto text-sm">
                {projects.data?.map((project) => (
                  <li key={project.name}>
                    <button
                      type="button"
                      aria-pressed={selectedProject === project.name}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent',
                        selectedProject === project.name && 'bg-accent font-medium',
                      )}
                      onClick={() => setSelectedProject(project.name)}
                    >
                      <span className="min-w-0 truncate">{project.name}</span>
                      {project.area && (
                        <Badge variant="outline" className="shrink-0 text-xs font-normal">
                          {project.area}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </TabsContent>
            <TabsContent value="create" className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="obsidian-project-name">Nom du nouveau projet</Label>
                <Input
                  id="obsidian-project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </div>
              <p className="text-sm text-muted-foreground">{preview.data?.outcome}</p>
            </TabsContent>
          </Tabs>
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

        {exportTrip.isError && (
          <p role="alert" className="text-sm text-destructive">
            {exportTrip.error.message}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button
            disabled={!vaultReady || !request || exportTrip.isPending}
            onClick={() => request && exportTrip.mutate(request)}
          >
            {alreadyLinked ? 'Remplacer le carnet' : 'Exporter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
