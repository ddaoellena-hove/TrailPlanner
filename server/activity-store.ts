import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { activitySource, activityTitle, findDuplicate, recordedMetrics } from '../shared/activity';
import {
  ActivitySchema,
  type Activity,
  type ActivityDraft,
  type ActivityPreview,
  type DuplicateCheck,
} from '../shared/schema';
import { UserDb, sha256Hex } from './db';
import { writeAtomic } from './fs-atomic';
import { parseRecordedGpx } from './gpx';

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
    fingerprint: sha256Hex(bytes),
  };
}

/**
 * Activités enregistrées : indexées dans SQLite (`activities`) avec copies GPX brutes
 * dans `<trips>/.activities/gpx/<id>.gpx` et le coffre SHA-256 (`.gpx-vault/`).
 */
export class ActivityStore {
  private readonly root: string;
  private readonly userDb: UserDb;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dirOrDb: string | UserDb) {
    if (typeof dirOrDb === 'string') {
      this.root = path.join(dirOrDb, '.activities');
      this.userDb = new UserDb(dirOrDb);
    } else {
      this.root = path.join(dirOrDb.tripsDir, '.activities');
      this.userDb = dirOrDb;
    }
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async loadAll(): Promise<Activity[]> {
    await this.userDb.ensureReady();
    const rows = await this.userDb.db
      .selectFrom('activities')
      .select('data')
      .orderBy('imported_at', 'asc')
      .execute();
    return rows.map((row) => ActivitySchema.parse(JSON.parse(row.data)));
  }

  /** Point d'injection des tests : enregistre une activité dans SQLite. */
  protected async writeIndex(activity: Activity): Promise<void> {
    const parsed = ActivitySchema.parse(activity);
    await this.userDb.db
      .insertInto('activities')
      .values({
        id: parsed.id,
        fingerprint: parsed.fingerprint,
        title: parsed.title,
        activity_date: parsed.activityDate,
        linked_route_id: parsed.linkedRouteId,
        data: JSON.stringify(parsed),
        imported_at: parsed.importedAt,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          title: parsed.title,
          activity_date: parsed.activityDate,
          linked_route_id: parsed.linkedRouteId,
          data: JSON.stringify(parsed),
        }),
      )
      .execute();
  }

  list(): Promise<Activity[]> {
    return this.exclusive(() => this.loadAll());
  }

  async get(id: string): Promise<Activity> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('activities')
      .select('data')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new ActivityNotFoundError(id);
    return ActivitySchema.parse(JSON.parse(row.data));
  }

  async readGpx(id: string): Promise<string> {
    const activity = await this.get(id);
    return readFile(path.join(this.root, activity.originalFile), 'utf8');
  }

  /**
   * Lie la sortie à une rando prévue, ou retire le lien (`null`). Seul `linkedRouteId`
   * change : mesures, trace et fichier original restent intacts.
   */
  setLink(id: string, routeId: string | null): Promise<Activity> {
    return this.exclusive(async () => {
      const activity = await this.get(id);
      const linked: Activity = { ...activity, linkedRouteId: routeId };
      await this.writeIndex(linked);
      return linked;
    });
  }

  /** Mémorise la note Obsidian exportée pour la sortie (chemin dans `Sport/` et projet lié). */
  setObsidian(id: string, obsidian: NonNullable<Activity['obsidian']>): Promise<Activity> {
    return this.exclusive(async () => {
      const activity = await this.get(id);
      const updated: Activity = { ...activity, obsidian };
      await this.writeIndex(updated);
      return updated;
    });
  }

  async preview(bytes: Buffer, fileName: string): Promise<ActivityPreview> {
    const draft = draftActivity(bytes, fileName);
    return { draft, duplicate: findDuplicate(draft, await this.list()) };
  }

  /**
   * Copie d'abord le GPX, puis insère dans SQLite. Si l'insertion échoue, la copie est retirée :
   * un import interrompu ne laisse ni activité partielle ni fichier orphelin.
   */
  async add(bytes: Buffer, fileName: string, options: ImportOptions = {}): Promise<Activity> {
    const draft = draftActivity(bytes, fileName);
    return this.exclusive(async () => {
      const existing = await this.loadAll();
      const duplicate = findDuplicate(draft, existing);
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
      ActivitySchema.parse(activity);

      const gpxPath = path.join(this.root, originalFile);
      await writeAtomic(gpxPath, bytes);
      try {
        await this.writeIndex(activity);
      } catch (error) {
        await rm(gpxPath, { force: true });
        throw error;
      }
      await this.userDb.storeGpxInVault(bytes, fileName);
      return activity;
    });
  }
}
