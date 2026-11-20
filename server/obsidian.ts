import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { CARNET_LEGACY_TITLES, CARNET_TITLE, type CarnetBlock } from '../shared/carnet';
import {
  OBSIDIAN_PROJECTS_DIR,
  OBSIDIAN_SPORT_DIR,
  TRAVEL_AREA_NAME,
  activitySportFileName,
  activitySportRelativePath,
  extractAreaName,
  mergeActivitySportNote,
  parseFrontMatter,
  renderActivitySportNote,
  renderTripCarnetNote,
  renderTripProjectNote,
  sanitizeObsidianName,
  tripCarnetRelativePath,
} from '../shared/obsidian';
import type {
  Activity,
  ActivityExportEntry,
  Health,
  ObsidianProject,
  ObsidianTripExportRequest,
  Trip,
} from '../shared/schema';
import { writeAtomic } from './trip-store';

export class ObsidianExportError extends Error {}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Vérifie qu'un chemin résolu reste strictement dans `baseDir` (aucune traversée possible). */
function resolveInside(baseDir: string, ...segments: string[]): string {
  const root = path.resolve(baseDir);
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ObsidianExportError('Chemin hors du vault Obsidian refusé');
  }
  return target;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function assertVaultDir(vaultDir: string): Promise<void> {
  if (!path.isAbsolute(vaultDir)) {
    throw new ObsidianExportError('Le chemin du vault Obsidian doit être un chemin absolu');
  }
  try {
    const info = await stat(vaultDir);
    if (!info.isDirectory()) {
      throw new ObsidianExportError(`Le chemin du vault Obsidian n'est pas un dossier : ${vaultDir}`);
    }
  } catch (error) {
    if (error instanceof ObsidianExportError) throw error;
    throw new ObsidianExportError(`Vault Obsidian introuvable : ${vaultDir}`);
  }
}

export async function checkObsidianVault(vaultDir: string | undefined): Promise<Health['obsidian']> {
  if (!vaultDir) return 'missing';
  if (!path.isAbsolute(vaultDir)) return 'invalid';
  try {
    return (await stat(vaultDir)).isDirectory() ? 'configured' : 'invalid';
  } catch {
    return 'invalid';
  }
}

async function projectExists(vaultDir: string, projectName: string): Promise<boolean> {
  const notePath = resolveInside(vaultDir, OBSIDIAN_PROJECTS_DIR, `${projectName}.md`);
  const folderPath = resolveInside(vaultDir, OBSIDIAN_PROJECTS_DIR, projectName);
  return (await exists(notePath)) || (await exists(folderPath));
}

/** Liste les projets de `Projects/` du vault, `Travel & Outdoors` en tête. */
export async function listObsidianProjects(
  vaultDir: string,
  query = '',
): Promise<ObsidianProject[]> {
  await assertVaultDir(vaultDir);
  const projectsDir = resolveInside(vaultDir, OBSIDIAN_PROJECTS_DIR);
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const byName = new Map<string, ObsidianProject>();
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const name = entry.name.slice(0, -3);
      const filePath = resolveInside(projectsDir, entry.name);
      const content = await readFile(filePath, 'utf8').catch(() => '');
      const fm = parseFrontMatter(content);
      byName.set(name, {
        name,
        path: `${OBSIDIAN_PROJECTS_DIR}/${entry.name}`,
        area: extractAreaName(fm.Area),
        status: fm.Status ?? null,
      });
    }
  }

  // Un dossier de projet sans note .md sœur (ex. Parc des écrins) reste sélectionnable.
  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isDirectory() || byName.has(entry.name)) continue;
    byName.set(entry.name, {
      name: entry.name,
      path: `${OBSIDIAN_PROJECTS_DIR}/${entry.name}`,
      area: null,
      status: null,
    });
  }

  const needle = normalize(query.trim());
  return [...byName.values()]
    .filter((project) => !needle || normalize(project.name).includes(needle))
    .toSorted((a, b) => {
      const aTravel = a.area === TRAVEL_AREA_NAME ? 0 : 1;
      const bTravel = b.area === TRAVEL_AREA_NAME ? 0 : 1;
      if (aTravel !== bTravel) return aTravel - bTravel;
      return a.name.localeCompare(b.name, 'fr');
    });
}

/**
 * Exporte le carnet d'un voyage dans `Projects/<Projet>/🗺️ Carnet d’itinéraire — généré par Itinera.md`.
 * Ne modifie jamais le contenu d'une note projet existante ; reprend et renomme un éventuel
 * ancien carnet Trailplan / TrailPlanner pour ne pas le dupliquer.
 */
export async function exportTripToObsidian(
  vaultDir: string,
  trip: Trip,
  request: ObsidianTripExportRequest,
  blocks: CarnetBlock[],
  outcome: string,
  now: Date = new Date(),
): Promise<NonNullable<Trip['obsidian']>> {
  await assertVaultDir(vaultDir);
  const today = now.toISOString().slice(0, 10);

  let projectName: string;
  if (trip.obsidian?.projectName) {
    projectName = sanitizeObsidianName(trip.obsidian.projectName);
    if (!projectName) throw new ObsidianExportError('Nom de projet lié invalide');
  } else if (request.mode === 'create') {
    projectName = sanitizeObsidianName(request.projectName || trip.name);
    if (!projectName) throw new ObsidianExportError('Nom de projet invalide');
    const projectNotePath = resolveInside(vaultDir, OBSIDIAN_PROJECTS_DIR, `${projectName}.md`);
    if (await exists(projectNotePath)) {
      throw new ObsidianExportError(
        `Le projet « ${projectName} » existe déjà dans Projects/ : utilisez « Lier à un projet existant » pour ne pas écraser vos notes.`,
      );
    }
    const projectMarkdown = renderTripProjectNote(trip, outcome, projectName, today);
    await writeAtomic(projectNotePath, projectMarkdown);
  } else {
    projectName = sanitizeObsidianName(request.projectName);
    if (!projectName || !(await projectExists(vaultDir, projectName))) {
      throw new ObsidianExportError(`Projet introuvable dans Projects/ : ${request.projectName}`);
    }
  }

  const carnetPath = resolveInside(vaultDir, OBSIDIAN_PROJECTS_DIR, projectName, `${CARNET_TITLE}.md`);
  const carnetMarkdown = renderTripCarnetNote(trip, blocks, today);
  await writeAtomic(carnetPath, carnetMarkdown);

  // Supprime les anciens carnets Trailplan / TrailPlanner après écriture atomique réussie.
  for (const legacyTitle of CARNET_LEGACY_TITLES) {
    const legacyPath = resolveInside(vaultDir, OBSIDIAN_PROJECTS_DIR, projectName, `${legacyTitle}.md`);
    await rm(legacyPath, { force: true });
  }

  return {
    projectName,
    carnetPath: tripCarnetRelativePath(projectName),
    lastExportAt: now.toISOString(),
  };
}

async function findExistingSportNote(
  sportDir: string,
  activity: Activity,
): Promise<{ fileName: string; content: string } | null> {
  // 1. Chemin déjà mémorisé sur la sortie.
  if (activity.obsidian?.notePath) {
    const storedName = path.basename(activity.obsidian.notePath);
    if (storedName.endsWith('.md')) {
      try {
        const candidatePath = resolveInside(sportDir, storedName);
        const content = await readFile(candidatePath, 'utf8');
        const id = parseFrontMatter(content).itinera_id;
        if (id === activity.id) return { fileName: storedName, content };
      } catch (error) {
        if (!isMissing(error) && !(error instanceof ObsidianExportError)) throw error;
      }
    }
  }

  // 2. Sinon recherche par `itinera_id` dans `Sport/*.md` (idempotence après renommage manuel).
  let entries;
  try {
    entries = await readdir(sportDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const candidatePath = resolveInside(sportDir, entry.name);
    const content = await readFile(candidatePath, 'utf8').catch(() => '');
    if (parseFrontMatter(content).itinera_id === activity.id) {
      return { fileName: entry.name, content };
    }
  }
  return null;
}

async function allocateFreeSportFileName(sportDir: string, preferred: string): Promise<string> {
  const stem = preferred.replace(/\.md$/i, '');
  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? `${stem}.md` : `${stem} (${suffix}).md`;
    const candidatePath = resolveInside(sportDir, candidate);
    if (!(await exists(candidatePath))) return candidate;
  }
}

/**
 * Exporte une sortie enregistrée dans `Sport/` (`Bases/Sport.base`), avec lien optionnel vers
 * un projet de `Projects/`. Ré-exporter met à jour les métadonnées sans écraser `## Ressenti`,
 * et ne touche jamais aux notes Garmin ou manuelles.
 */
export async function exportActivityToObsidian(
  vaultDir: string,
  activity: Activity,
  entry: ActivityExportEntry,
  projectName: string | null | undefined,
  now: Date = new Date(),
): Promise<NonNullable<Activity['obsidian']>> {
  await assertVaultDir(vaultDir);

  let safeProject: string | undefined;
  if (projectName) {
    safeProject = sanitizeObsidianName(projectName);
    if (!safeProject || !(await projectExists(vaultDir, safeProject))) {
      throw new ObsidianExportError(`Projet introuvable dans Projects/ : ${projectName}`);
    }
  }

  const today = now.toISOString().slice(0, 10);
  const rendered = renderActivitySportNote(entry, {
    createdDate: today,
    projectName: safeProject ?? null,
  });

  const sportDir = resolveInside(vaultDir, OBSIDIAN_SPORT_DIR);
  const existing = await findExistingSportNote(sportDir, activity);
  const fileName = existing
    ? existing.fileName
    : await allocateFreeSportFileName(sportDir, activitySportFileName(entry));
  const targetPath = resolveInside(sportDir, fileName);
  const finalContent = existing ? mergeActivitySportNote(existing.content, rendered) : rendered;

  await writeAtomic(targetPath, finalContent);

  return {
    notePath: activitySportRelativePath(fileName),
    ...(safeProject ? { projectName: safeProject } : {}),
    lastExportAt: now.toISOString(),
  };
}
