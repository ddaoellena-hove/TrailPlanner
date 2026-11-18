import { Link } from 'react-router';
import { useActivities } from '@/lib/hooks';
import { sortActivities } from '../../shared/activity';
import { formatMeters, formatSeconds, formatShortDate } from '../../shared/format';
import { linkedActivities } from '../../shared/library';
import type { LibraryHike } from '../../shared/schema';

/** Sorties enregistrées liées à une rando prévue, depuis sa fiche dans « Mes randos ». */
export function LinkedActivities({ hike }: { hike: LibraryHike }) {
  const activities = useActivities();
  const linked = sortActivities(linkedActivities(hike, activities.data ?? []));
  if (linked.length === 0) return null;

  return (
    <section className="grid gap-2 border-t pt-4">
      <h3 className="text-sm font-medium">Sorties enregistrées</h3>
      <ul className="grid gap-1 text-sm">
        {linked.map((activity) => (
          <li key={activity.id}>
            <Link
              to={`/sorties?sortie=${activity.id}`}
              className="flex flex-wrap gap-x-2 text-primary hover:underline"
            >
              <span>{activity.activityDate ? formatShortDate(activity.activityDate) : 'Date inconnue'}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatMeters(activity.distanceMeters)}
                {activity.durationSeconds !== null && ` · ${formatSeconds(activity.durationSeconds)}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
