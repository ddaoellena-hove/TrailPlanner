import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { NotionExportRequest, Trip } from '../../shared/schema';

export function ExportDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const queryClient = useQueryClient();
  const alreadyLinked = Boolean(trip.notion?.projectPageId);
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [projectPageId, setProjectPageId] = useState<string | null>(null);
  const [updateStartDate, setUpdateStartDate] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const health = useQuery({ queryKey: ['health'], queryFn: api.getHealth });
  const preview = useQuery({
    queryKey: ['notion-preview', trip.slug, trip.updatedAt],
    queryFn: () => api.notionPreview(trip.slug),
  });
  const hasToken = health.data !== undefined && health.data.notion !== 'missing';
  const projects = useQuery({
    queryKey: ['notion-projects', debounced],
    queryFn: () => api.notionProjects(debounced),
    enabled: hasToken && mode === 'link' && !alreadyLinked,
    retry: false,
  });

  const exportTrip = useMutation({
    mutationFn: (body: NotionExportRequest) => api.notionExport(trip.slug, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['trip', trip.slug] });
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
      toast.success('Carnet exporté vers Notion');
      onClose();
    },
  });

  const request: NotionExportRequest | null =
    alreadyLinked || mode === 'create'
      ? { mode: 'create' }
      : projectPageId
        ? { mode: 'link', projectPageId, updateStartDate }
        : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exporter vers Notion</DialogTitle>
          <DialogDescription>
            {alreadyLinked
              ? 'Ce voyage est déjà lié : seule la sous-page carnet sera remplacée.'
              : 'Le contenu de la page projet n’est jamais modifié : seule une sous-page carnet est écrite.'}
          </DialogDescription>
        </DialogHeader>

        {!hasToken && health.data && (
          <p role="alert" className="text-sm text-destructive">
            Export désactivé : renseignez NOTION_TOKEN dans .env, puis partagez l'intégration avec
            la base Projects. L'aperçu reste disponible.
          </p>
        )}
        {health.data?.notion === 'invalid' && (
          <p role="alert" className="text-sm text-destructive">
            Notion refuse ce token : vérifiez NOTION_TOKEN dans .env.
          </p>
        )}

        {!alreadyLinked && hasToken && (
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'create' | 'link')}>
            <TabsList>
              <TabsTrigger value="create">Créer un nouveau projet</TabsTrigger>
              <TabsTrigger value="link">Lier à un projet existant</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
              <p className="text-sm text-muted-foreground">{preview.data?.outcome}</p>
            </TabsContent>
            <TabsContent value="link" className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="notion-search">Rechercher dans Travel & Outdoors</Label>
                <Input
                  id="notion-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              {projects.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {projects.error.message}
                </p>
              )}
              <ul className="grid max-h-40 gap-1 overflow-y-auto text-sm">
                {projects.data?.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      aria-pressed={projectPageId === project.id}
                      className={cn(
                        'w-full rounded px-2 py-1 text-left hover:bg-accent',
                        projectPageId === project.id && 'bg-accent font-medium',
                      )}
                      onClick={() => setProjectPageId(project.id)}
                    >
                      {project.title}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="notion-dates"
                  checked={updateStartDate}
                  onCheckedChange={(checked) => setUpdateStartDate(checked === true)}
                />
                <Label htmlFor="notion-dates">Mettre à jour la propriété Start date</Label>
              </div>
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
            disabled={!hasToken || !request || exportTrip.isPending}
            onClick={() => request && exportTrip.mutate(request)}
          >
            {alreadyLinked ? 'Remplacer le carnet' : 'Exporter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
