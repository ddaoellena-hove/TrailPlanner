import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ActivityBadges, SourceBadge } from '@/components/ActivityStats';
import { ActivityImportDialog } from '@/components/ActivityImportDialog';
import { ActivitySheet } from '@/components/ActivitySheet';
import { SyncPanel } from '@/components/SyncPanel';
import { TrackMap } from '@/components/TrackMap';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useActivities } from '@/lib/hooks';
import { downloadJson } from '@/lib/utils';
import { sortActivities } from '../../shared/activity';
import { formatShortDate, formatTimeOfDay } from '../../shared/format';
import { activityBundleExportFileName } from '../../shared/lifeos-export';
import type { Activity } from '../../shared/schema';

/** Historique des sorties enregistrées, distinct des randos prévues (« Mes randos »). */
export function ActivitiesPage() {
  const queryClient = useQueryClient();
  const activities = useActivities();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // « ?sortie=<id> » ouvre une fiche : lien depuis la rando prévue liée.
  const [searchParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(searchParams.get('sortie'));
  const list = useMemo(() => sortActivities(activities.data ?? []), [activities.data]);
  const tracks = useMemo(
    () => list.map(({ id, profile }) => ({ id, lines: [profile.map(({ lng, lat }) => [lng, lat])] })),
    [list],
  );
  const open = list.find(({ id }) => id === openId);

  const exportBundle = async () => {
    setExporting(true);
    try {
      const bundle = await api.exportActivities();
      downloadJson(activityBundleExportFileName(bundle.exportedAt), bundle);
      toast.success(
        bundle.count > 1
          ? `${bundle.count} sorties exportées en JSON`
          : '1 sortie exportée en JSON',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export impossible');
    } finally {
      setExporting(false);
    }
  };

  const imported = async (activity: Activity) => {
    queryClient.setQueryData<Activity[]>(['activities'], (current) => [...(current ?? []), activity]);
    await queryClient.invalidateQueries({ queryKey: ['activities'] });
    setImporting(false);
    setOpenId(activity.id);
    toast.success(`Sortie « ${activity.title} » importée`);
  };

  return (
    <main className="mx-auto grid max-w-[1600px] gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mes sorties</h1>
        <div className="flex flex-wrap items-center gap-2">
          {list.length > 0 && (
            <Button type="button" variant="outline" disabled={exporting} onClick={exportBundle}>
              <Download aria-hidden />
              Exporter JSON
            </Button>
          )}
          <Button onClick={() => setImporting(true)}>
            <Upload aria-hidden />
            Importer une sortie
          </Button>
        </div>
      </div>

      <SyncPanel activities={list} onOpen={setOpenId} />

      {activities.isPending && <Skeleton className="h-44" />}
      {activities.isError && (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les sorties : {activities.error.message}
        </p>
      )}
      {activities.data?.length === 0 && (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            Aucune sortie pour l'instant. Exportez une sortie enregistrée depuis AllTrails au format
            GPX, puis importez-la ici.
          </p>
          <Button variant="outline" onClick={() => setImporting(true)}>
            Importer une sortie
          </Button>
        </div>
      )}

      {list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="grid min-w-0 content-start gap-2">
            <p className="text-sm text-muted-foreground">
              {list.length} {list.length > 1 ? 'sorties' : 'sortie'}
            </p>
            {/* minmax(0, 1fr) : un titre long se tronque au lieu d'élargir la colonne. */}
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {list.map((activity) => (
                <li key={activity.id}>
                  <button
                    type="button"
                    className="grid w-full gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50"
                    onClick={() => setOpenId(activity.id)}
                  >
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{activity.title}</span>
                      <SourceBadge source={activity.source} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {activity.activityDate
                        ? `${formatShortDate(activity.activityDate)} à ${formatTimeOfDay(activity.activityDate)}`
                        : 'Date inconnue'}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ActivityBadges activity={activity} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="h-[36rem] overflow-hidden rounded-xl border lg:sticky lg:top-4">
            <TrackMap tracks={tracks} onOpen={setOpenId} />
          </div>
        </div>
      )}

      {importing && (
        <ActivityImportDialog
          activities={list}
          onClose={() => setImporting(false)}
          onImported={imported}
          onOpenExisting={(id) => {
            setImporting(false);
            setOpenId(id);
          }}
        />
      )}
      {open && <ActivitySheet key={open.id} activity={open} onClose={() => setOpenId(null)} />}
    </main>
  );
}
