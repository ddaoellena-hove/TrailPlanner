import { sortActivities } from './activity';
import { DISPLAY_TIME_ZONE } from './format';
import {
  LIFE_OS_EXPORT_VERSION,
  type Activity,
  type ActivityExport,
  type ActivityExportBundle,
  type ActivityExportEntry,
  type ExportedPlannedRoute,
  type LibraryHike,
} from './schema';

export type LifeOsExportOptions = {
  /** Horodatage ISO 8601 de l'export ; passé explicitement pour garder la fonction pure. */
  exportedAt: string;
  /** Fuseau utilisé pour `localDate`, `localStartTime` et `localEndTime`. */
  timeZone?: string;
};

function localParts(iso: string | null, timeZone: string): { date: string; time: string } | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const map = new Map(parts.map(({ type, value }) => [type, value]));
  const year = map.get('year');
  const month = map.get('month');
  const day = map.get('day');
  const hour = map.get('hour');
  const minute = map.get('minute');
  if (!year || !month || !day || !hour || !minute) return null;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function buildPlannedRoute(route: LibraryHike): ExportedPlannedRoute {
  return {
    id: route.id,
    name: route.name,
    kind: route.kind,
    alltrailsUrl: route.alltrailsUrl ?? null,
    dogPolicy: route.dogPolicy,
    tags: [...(route.tags ?? [])],
    rating: route.rating ?? null,
    gpxHash: route.gpxHash,
    plannedMetrics: {
      distanceMeters: Math.round(route.stats.distanceKm * 1000),
      elevationGainMeters: route.stats.elevationGainM,
      elevationLossMeters: route.stats.elevationLossM,
      estimatedDurationSeconds: Math.round(route.stats.estimatedDurationMin * 60),
    },
  };
}

/**
 * Construit l'entrée exportée d'une sortie enregistrée.
 * La rando prévue n'est incluse que si son identifiant correspond au lien manuel
 * (`linkedRouteId`), et reste strictement séparée de la trace enregistrée.
 */
export function buildActivityExportEntry(
  activity: Activity,
  plannedRoute: LibraryHike | null | undefined,
  timeZone = DISPLAY_TIME_ZONE,
): ActivityExportEntry {
  const startLocal = localParts(activity.activityDate, timeZone);
  const endLocal = localParts(activity.endedAt, timeZone);
  const notes = activity.notes?.trim() ? activity.notes : null;
  const linked =
    plannedRoute && activity.linkedRouteId === plannedRoute.id
      ? buildPlannedRoute(plannedRoute)
      : null;

  return {
    activity: {
      id: activity.id,
      title: activity.title,
      source: activity.source,
      sourceId: activity.sourceId,
      activityDate: activity.activityDate,
      endedAt: activity.endedAt,
      localDate: startLocal?.date ?? null,
      localStartTime: startLocal?.time ?? null,
      localEndTime: endLocal?.time ?? null,
      timeZone,
      metrics: {
        distanceMeters: activity.distanceMeters,
        durationSeconds: activity.durationSeconds,
        elevationGainMeters: activity.elevationGainMeters,
        elevationLossMeters: activity.elevationLossMeters,
        pointCount: activity.pointCount,
        segmentCount: activity.segmentCount,
        origin: { ...activity.metricsOrigin },
      },
      start: { ...activity.start },
      end: { ...activity.end },
      provenance: {
        originalFileName: activity.originalFileName,
        originalFile: activity.originalFile,
        fingerprint: activity.fingerprint,
        importedAt: activity.importedAt,
      },
      notes,
    },
    plannedRoute: linked,
  };
}

/** Contrat JSON versionné (v1) pour une sortie enregistrée, sans écriture vers Obsidian. */
export function buildActivityExport(
  activity: Activity,
  plannedRoute: LibraryHike | null | undefined,
  { exportedAt, timeZone = DISPLAY_TIME_ZONE }: LifeOsExportOptions,
): ActivityExport {
  return {
    version: LIFE_OS_EXPORT_VERSION,
    kind: 'activity',
    target: 'obsidian',
    exportedAt,
    ...buildActivityExportEntry(activity, plannedRoute, timeZone),
  };
}

/** Lot JSON versionné (v1) de plusieurs sorties, triées de la plus récente à la plus ancienne. */
export function buildActivityExportBundle(
  activities: Activity[],
  routes: LibraryHike[],
  { exportedAt, timeZone = DISPLAY_TIME_ZONE }: LifeOsExportOptions,
): ActivityExportBundle {
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const items = sortActivities(activities).map((activity) =>
    buildActivityExportEntry(
      activity,
      activity.linkedRouteId ? routeById.get(activity.linkedRouteId) : null,
      timeZone,
    ),
  );
  return {
    version: LIFE_OS_EXPORT_VERSION,
    kind: 'activity-export-bundle',
    target: 'obsidian',
    exportedAt,
    count: items.length,
    items,
  };
}

function slugifyTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Nom de fichier lisible pour télécharger le contrat JSON d'une sortie. */
export function activityExportFileName(
  activity: Pick<Activity, 'id' | 'title' | 'activityDate'>,
  timeZone = DISPLAY_TIME_ZONE,
): string {
  const date = localParts(activity.activityDate, timeZone)?.date;
  const slug = slugifyTitle(activity.title) || activity.id.slice(0, 8);
  return date ? `${date}-${slug}.lifeos.json` : `sortie-${slug}.lifeos.json`;
}

/** Nom de fichier lisible pour télécharger le lot complet des sorties. */
export function activityBundleExportFileName(
  exportedAt: string,
  timeZone = DISPLAY_TIME_ZONE,
): string {
  const date = localParts(exportedAt, timeZone)?.date ?? 'export';
  return `itinera-sorties-${date}.lifeos.json`;
}
