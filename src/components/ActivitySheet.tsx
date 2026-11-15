import { useMemo, useState } from 'react';
import { ActivityStats, SourceBadge } from '@/components/ActivityStats';
import { ProfileChart } from '@/components/ProfileChart';
import { TrackMap } from '@/components/TrackMap';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useActivityTrack } from '@/lib/hooks';
import { formatActivityDate, formatShortDate, formatTimeOfDay } from '../../shared/format';
import { buildProfile } from '../../shared/profile';
import type { Activity } from '../../shared/schema';

function timeRange({ activityDate, endedAt }: Activity): string {
  if (!activityDate) return 'Date inconnue : le fichier ne contient pas d’heures';
  const start = `${formatActivityDate(activityDate)}, ${formatTimeOfDay(activityDate)}`;
  return endedAt ? `${start} → ${formatTimeOfDay(endedAt)}` : start;
}

/** Fiche d'une sortie : mesures, trace complète sur la carte et profil synchronisé. */
export function ActivitySheet({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const track = useActivityTrack(activity.id);
  const [cursor, setCursor] = useState<number | null>(null);
  const points = useMemo(
    () => buildProfile([{ id: activity.id, stats: { profile: activity.profile } }]),
    [activity],
  );
  const cursorPoint = cursor === null ? null : (points[cursor] ?? null);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{activity.title}</SheetTitle>
          <SheetDescription>{timeRange(activity)}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SourceBadge source={activity.source} />
            <span>Trace enregistrée</span>
          </div>

          <div className="h-72 overflow-hidden rounded-lg border">
            {track.isPending && <Skeleton className="size-full" />}
            {track.isError && (
              <p role="alert" className="p-4 text-sm text-destructive">
                Trace illisible : {track.error.message}
              </p>
            )}
            {track.data && (
              <TrackMap tracks={[{ id: activity.id, lines: track.data }]} cursor={cursorPoint} />
            )}
          </div>

          {activity.elevationGainMeters !== null && (
            <div className="h-36">
              <ProfileChart points={points} cursorIndex={cursor} onCursorChange={setCursor} />
            </div>
          )}

          <ActivityStats activity={activity} />

          <p className="text-xs text-muted-foreground">
            Importée le {formatShortDate(activity.importedAt)} depuis {activity.originalFileName},{' '}
            {activity.pointCount.toLocaleString('fr-FR')} points. Le temps en mouvement n'est pas
            calculé.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
