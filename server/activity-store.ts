import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { activitySource, activityTitle, findDuplicate, recordedMetrics } from '../shared/activity';
import {
  type Activity,
  type ActivityDraft,
  type ActivityPreview,
  type ActivityStoreFile,
  ActivityStoreSchema,
  type DuplicateCheck,
} from '../shared/schema';
import { parseRecordedGpx } from './gpx';
import { writeAtomic } from './trip-store';

export class ActivityNotFoundError extends Error {}

/** Import refusé : doublon exact, ou doublon probable non confirmé. */
export class DuplicateActivityError extends Error {
  constructor(readonly duplicate: Exclude<DuplicateCheck, { status: 'none' }>) {
    super(
      duplicate.status === 'exact'
        ? 'Ce fichier a déjà été importé'
        : 'Une activité très proche existe déjà : confirmez pour importer quand même',
    );
  }
}

type ImportOptions = { title?: string; confirmProbableDuplicate?: boolean };

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Lit le GPX et calcule l'activité, sans rien écrire. Toutes les mesures sont calculées. */
export function draftActivity(bytes: Buffer, fileName: string): ActivityDraft {
  const track = parseRecordedGpx(bytes.toString('utf8'));
  const metrics = recordedMetrics(track);
  return {
    title: activityTitle(track, fileName),
    source: activitySource(track),
    sourceId: null,
    ...metrics,
    metricsOrigin: {
      distance: 'calculated',
      duration: metrics.durationSeconds === null ? null : 'calculated',
      elevation: metrics.elevationGainMeters === null ? null : 'calculated',
    },
    originalFileName: fileName,
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Activités enregistrées : `<trips>/.activities/activities.json` et `gpx/<id>.gpx`.
 * Un import ne modifie jamais une activité existante.
 */
export class ActivityStore {
  private readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(tripsDir: string) {
    this.root = path.join(tripsDir, '.activities');
  }

  private get file(): string {
    return path.join(this.root, 'activities.json');
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<ActivityStoreFile> {
    try {
      return ActivityStoreSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if (isMissing(error)) return { schemaVersion: 1, activities: [] };
      throw error;
    }
  }

  /** Point d'injection des tests : écrit l'index des activités. */
  protected async writeIndex(content: string): Promise<void> {
    await writeAtomic(this.file, content);
  }

  list(): Promise<Activity[]> {
    return this.exclusive(async () => (await this.load()).activities);
  }

  async get(id: string): Promise<Activity> {
    const activity = (await this.list()).find((candidate) => candidate.id === id);
    if (!activity) throw new ActivityNotFoundError(id);
    return activity;
  }

  async readGpx(id: string): Promise<string> {
    const activity = await this.get(id);
    return readFile(path.join(this.root, activity.originalFile), 'utf8');
  }

  async preview(bytes: Buffer, fileName: string): Promise<ActivityPreview> {
    const draft = draftActivity(bytes, fileName);
    return { draft, duplicate: findDuplicate(draft, await this.list()) };
  }

  /**
   * Copie d'abord le GPX, puis réécrit l'index. Si l'index échoue, la copie est retirée :
   * un import interrompu ne laisse ni activité partielle ni fichier orphelin.
   */
  async add(bytes: Buffer, fileName: string, options: ImportOptions = {}): Promise<Activity> {
    const draft = draftActivity(bytes, fileName);
    return this.exclusive(async () => {
      const current = await this.load();
      const duplicate = findDuplicate(draft, current.activities);
      if (duplicate.status === 'exact') throw new DuplicateActivityError(duplicate);
      if (duplicate.status === 'probable' && !options.confirmProbableDuplicate) {
        throw new DuplicateActivityError(duplicate);
      }

      const id = randomUUID();
      const originalFile = `gpx/${id}.gpx`;
      const activity: Activity = {
        ...draft,
        title: options.title?.trim() || draft.title,
        id,
        originalFile,
        linkedRouteId: null,
        importedAt: new Date().toISOString(),
      };
      const next = ActivityStoreSchema.parse({
        ...current,
        activities: [...current.activities, activity],
      });
      const gpxPath = path.join(this.root, originalFile);
      await writeAtomic(gpxPath, bytes);
      try {
        await this.writeIndex(`${JSON.stringify(next, null, 2)}\n`);
      } catch (error) {
        await rm(gpxPath, { force: true });
        throw error;
      }
      return activity;
    });
  }
}
