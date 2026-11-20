import { CARNET_TITLE, type CarnetBlock, carnetToMarkdown } from './carnet';
import { formatDuration, formatElevationGain, formatKm, formatSeconds } from './format';
import type { ActivityExportEntry, Trip } from './schema';

export const OBSIDIAN_PROJECTS_DIR = 'Projects';
export const OBSIDIAN_SPORT_DIR = 'Sport';
export const TRAVEL_AREA_NAME = 'Travel & Outdoors';
export const TRAVEL_AREA_LINK = `[[Areas/${TRAVEL_AREA_NAME}|${TRAVEL_AREA_NAME}]]`;

const FORBIDDEN_FILE_CHARS = /[/\\:*?"<>|#^[\]\r\n\t]/g;

/** Nettoie un nom pour un fichier ou dossier Obsidian (aucun séparateur de chemin ni syntaxe wikilink). */
export function sanitizeObsidianName(raw: string): string {
  const cleaned = raw
    .replaceAll(FORBIDDEN_FILE_CHARS, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  return cleaned;
}

function yamlString(value: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll(/\r?\n/g, ' ');
  return `"${escaped}"`;
}

/**
 * Lit les propriétés `clé: valeur` simples d'un front matter YAML en tête de fichier.
 * Sert uniquement à indexer `Projects/` et repérer `itinera_id` dans `Sport/`.
 */
export function parseFrontMatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key || key.startsWith('#') || key.startsWith('-')) continue;
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
    }
    if (value !== '') result[key] = value;
  }
  return result;
}

/** Extrait le nom lisible d'une propriété `Area` (ex. `[[Areas/Travel & Outdoors|Travel & Outdoors]]`). */
export function extractAreaName(raw: string | undefined): string | null {
  if (!raw) return null;
  const wiki = raw.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (wiki) {
    const alias = wiki[2]?.trim();
    if (alias) return alias;
    return wiki[1]!.split('/').at(-1)?.trim() || null;
  }
  return raw.trim() || null;
}

/** Chemin relatif (en `/` POSIX, pour affichage et stockage) du carnet d'un projet. */
export function tripCarnetRelativePath(projectName: string, title = CARNET_TITLE): string {
  return `${OBSIDIAN_PROJECTS_DIR}/${projectName}/${title}.md`;
}

/** Note d'un nouveau projet dans `Projects/`, conforme à `Templates/Project.md` et `Bases/Projects.base`. */
export function renderTripProjectNote(
  trip: Pick<Trip, 'startDate'>,
  outcome: string,
  projectName: string,
  createdDate: string,
): string {
  const carnetLink = `[[${OBSIDIAN_PROJECTS_DIR}/${projectName}/${CARNET_TITLE}|🗺️ Carnet d’itinéraire]]`;
  return [
    '---',
    `title: ${yamlString(projectName)}`,
    `Created: ${createdDate}`,
    'Status: Backlog',
    'Priority: P2',
    `Area: ${yamlString(TRAVEL_AREA_LINK)}`,
    `Outcome: ${yamlString(outcome)}`,
    `Start date: ${trip.startDate}`,
    'icon: 🏔️',
    '---',
    '',
    `# ${projectName}`,
    '',
    '## Outcome',
    '',
    outcome,
    '',
    '## Resources & decisions',
    '',
    `- ${carnetLink}`,
    '',
    '## ✅ Tâches',
    '',
    '![[Bases/Tasks.base#Tâches liées]]',
    '',
  ].join('\n');
}

/** Sous-fichier dédié au carnet d'itinéraire, entièrement remplacé à chaque export. */
export function renderTripCarnetNote(
  trip: Pick<Trip, 'slug'>,
  blocks: CarnetBlock[],
  exportedDate: string,
): string {
  return [
    '---',
    `title: ${yamlString(CARNET_TITLE)}`,
    `itinera_trip_slug: ${yamlString(trip.slug)}`,
    `Exported: ${exportedDate}`,
    '---',
    '',
    `# ${CARNET_TITLE}`,
    '',
    carnetToMarkdown(blocks),
    '',
  ].join('\n');
}

function roundKm(meters: number): number {
  return Math.round((meters / 1000) * 100) / 100;
}

/** Titre lisible d'une séance dans `Sport/` (aligné sur le format Garmin `YYYY-MM-DD — Randonnée X,X km`). */
export function activitySportTitle(entry: ActivityExportEntry): string {
  const { activity } = entry;
  const distance = formatKm(activity.metrics.distanceMeters / 1000);
  const label = sanitizeObsidianName(activity.title).slice(0, 60).trim();
  const base = activity.localDate
    ? `${activity.localDate} — Randonnée ${distance}`
    : `Randonnée ${distance}`;
  return label ? `${base} — ${label}` : base;
}

export function activitySportFileName(entry: ActivityExportEntry): string {
  return `${activitySportTitle(entry)}.md`;
}

export function activitySportRelativePath(fileName: string): string {
  return `${OBSIDIAN_SPORT_DIR}/${fileName}`;
}

export type ActivitySportNoteOptions = {
  createdDate: string;
  projectName?: string | null;
};

/** Note Markdown d'une sortie enregistrée pour `Sport/` (`Bases/Sport.base`). */
export function renderActivitySportNote(
  entry: ActivityExportEntry,
  { createdDate, projectName }: ActivitySportNoteOptions,
): string {
  const { activity, plannedRoute } = entry;
  const noteTitle = activitySportTitle(entry);
  const sourceLabel = activity.source === 'alltrails' ? 'AllTrails' : 'GPX';
  const durationMin =
    activity.metrics.durationSeconds === null
      ? null
      : Math.round(activity.metrics.durationSeconds / 60);
  const safeProject = projectName ? sanitizeObsidianName(projectName) : '';

  const frontMatter = [
    '---',
    `title: ${yamlString(noteTitle)}`,
    ...(activity.localDate ? [`Date: ${activity.localDate}`] : []),
    ...(activity.localStartTime ? [`Heure: ${activity.localStartTime}`] : []),
    'Type: Randonnée',
    ...(durationMin !== null ? [`Durée: ${durationMin}`] : []),
    `Distance: ${roundKm(activity.metrics.distanceMeters)}`,
    ...(activity.metrics.elevationGainMeters !== null
      ? [`Dénivelé: ${Math.round(activity.metrics.elevationGainMeters)}`]
      : []),
    ...(safeProject
      ? [`Project: ${yamlString(`[[${OBSIDIAN_PROJECTS_DIR}/${safeProject}|${safeProject}]]`)}`]
      : []),
    `Source: ${sourceLabel}`,
    'icon: 🥾',
    `Created: ${createdDate}`,
    `itinera_id: ${yamlString(activity.id)}`,
    `itinera_fingerprint: ${yamlString(activity.provenance.fingerprint)}`,
    '---',
  ];

  const hours =
    activity.localStartTime && activity.localEndTime
      ? `${activity.localStartTime} → ${activity.localEndTime} (${activity.timeZone})`
      : activity.localStartTime
        ? `${activity.localStartTime} (${activity.timeZone})`
        : null;

  const elevation =
    activity.metrics.elevationGainMeters !== null
      ? `+${Math.round(activity.metrics.elevationGainMeters)} m${
          activity.metrics.elevationLossMeters !== null
            ? ` / −${Math.round(activity.metrics.elevationLossMeters)} m`
            : ''
        } (calculé)`
      : 'Inconnu';

  const summaryLines = [
    `- **Sortie :** ${activity.title}`,
    `- **Source :** ${sourceLabel} (\`${activity.provenance.originalFileName}\`)`,
    ...(hours ? [`- **Horaires :** ${hours}`] : []),
    `- **Distance :** ${formatKm(activity.metrics.distanceMeters / 1000)} (calculée)`,
    `- **Durée écoulée :** ${
      activity.metrics.durationSeconds !== null
        ? `${formatSeconds(activity.metrics.durationSeconds)} (calculée)`
        : 'Inconnue'
    }`,
    `- **Dénivelé :** ${elevation}`,
  ];

  if (plannedRoute) {
    const routeLabel = plannedRoute.alltrailsUrl
      ? `[${plannedRoute.name}](${plannedRoute.alltrailsUrl})`
      : plannedRoute.name;
    const plannedStats = [
      formatKm(plannedRoute.plannedMetrics.distanceMeters / 1000),
      ...(plannedRoute.plannedMetrics.elevationGainMeters !== null
        ? [formatElevationGain(plannedRoute.plannedMetrics.elevationGainMeters)]
        : []),
      `estimée ${formatDuration(plannedRoute.plannedMetrics.estimatedDurationSeconds / 60)}`,
    ].join(', ');
    summaryLines.push(`- **Rando prévue liée :** ${routeLabel} (${plannedStats})`);
  }

  if (activity.notes) {
    summaryLines.push(`- **Notes :** ${activity.notes}`);
  }

  return [
    ...frontMatter,
    '',
    `# ${noteTitle}`,
    '',
    '## Données Itinera',
    '',
    ...summaryLines,
    '',
    '## Ressenti',
    '',
  ].join('\n');
}

const RESSENTI_HEADING = /^## Ressenti\s*$/m;

/**
 * Lors d'un ré-export d'une note `Sport/`, met à jour le front matter et les données
 * calculées tout en préservant intégralement tout ce qui suit `## Ressenti`.
 */
export function mergeActivitySportNote(existingMarkdown: string, renderedMarkdown: string): string {
  const existingMatch = existingMarkdown.match(RESSENTI_HEADING);
  const renderedMatch = renderedMarkdown.match(RESSENTI_HEADING);
  if (!existingMatch || existingMatch.index === undefined || !renderedMatch || renderedMatch.index === undefined) {
    return renderedMarkdown;
  }
  const existingTail = existingMarkdown.slice(existingMatch.index);
  const renderedHead = renderedMarkdown.slice(0, renderedMatch.index);
  return `${renderedHead}${existingTail}`;
}
