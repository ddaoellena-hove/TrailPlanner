import {
  type SyncFile,
  type SyncLedger,
  SyncLedgerSchema,
  type SyncReport,
  type SyncStatus,
} from '../shared/schema';
import { type ActivityStore, DuplicateActivityError } from './activity-store';
import type { ActivityConnector } from './activity-connector';
import { UserDb, sha256Hex } from './db';

export class SyncError extends Error {}

const FINAL: SyncFile['status'][] = ['imported', 'duplicate', 'pending', 'ignored'];

function hashOf(bytes: Buffer): string {
  return sha256Hex(bytes);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue';
}

/**
 * Synchronisation depuis une source (le dossier surveillé) vers `ActivityStore`.
 * Le registre (table SQLite `activity_sync`) retient chaque fichier traité par son empreinte :
 * un fichier importé, en double ou en attente n'est plus relu ; un échec est retenté.
 * Un doublon probable n'est jamais importé sans un choix explicite.
 */
export class ActivitySync {
  private readonly userDb: UserDb;
  private running: Promise<SyncReport> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    dirOrDb: string | UserDb,
    private readonly store: ActivityStore,
  ) {
    this.userDb = typeof dirOrDb === 'string' ? new UserDb(dirOrDb) : dirOrDb;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<SyncLedger> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('activity_sync')
      .select('data')
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!row) return { schemaVersion: 1, files: {} };
    return SyncLedgerSchema.parse(JSON.parse(row.data));
  }

  private async save(ledger: SyncLedger): Promise<void> {
    await this.userDb.ensureReady();
    const data = JSON.stringify(SyncLedgerSchema.parse(ledger));
    const updated_at = new Date().toISOString();
    await this.userDb.db
      .insertInto('activity_sync')
      .values({ id: 1, data, updated_at })
      .onConflict((oc) => oc.column('id').doUpdateSet({ data, updated_at }))
      .execute();
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  async status(folder: string | null, autoSync = false): Promise<SyncStatus> {
    const ledger = await this.exclusive(() => this.load());
    return {
      folder,
      running: this.isRunning,
      autoSync,
      lastRun: ledger.lastRun ?? null,
      lastError: ledger.lastError ?? null,
      pending: Object.entries(ledger.files)
        .filter(([, file]) => file.status === 'pending')
        .map(([hash, file]) => ({ ...file, hash })),
    };
  }

  /** Un seul passage à la fois : un second appel reçoit le passage en cours. */
  run(connector: ActivityConnector): Promise<SyncReport> {
    this.running ??= this.exclusive(() => this.pass(connector)).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pass(connector: ActivityConnector): Promise<SyncReport> {
    const startedAt = new Date().toISOString();
    const ledger = await this.load();
    const report: SyncReport = {
      startedAt,
      finishedAt: startedAt,
      folder: connector.label,
      imported: [],
      duplicates: [],
      pending: [],
      failed: [],
      alreadyHandled: 0,
    };
    const record = (hash: string, file: Omit<SyncFile, 'at'>) => {
      ledger.files[hash] = { ...file, at: new Date().toISOString() };
    };

    let candidates;
    try {
      candidates = await connector.list();
    } catch (error) {
      // Le passage n'a pas eu lieu : on le retient pour l'afficher, sans toucher au reste.
      ledger.lastError = { at: new Date().toISOString(), message: errorMessage(error) };
      await this.save(ledger);
      throw error;
    }

    const previous = ledger.seen ?? {};
    const seen: NonNullable<SyncLedger['seen']> = {};
    for (const { fileName, size, mtimeMs } of candidates) {
      const cached = previous[fileName];
      if (
        cached?.size === size &&
        cached.mtimeMs === mtimeMs &&
        FINAL.includes(ledger.files[cached.hash]?.status ?? 'failed')
      ) {
        // Inchangé et déjà traité : pas besoin de le relire.
        seen[fileName] = cached;
        report.alreadyHandled++;
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await connector.read(fileName);
      } catch (error) {
        report.failed.push({ fileName, error: errorMessage(error) });
        continue;
      }
      const hash = hashOf(bytes);
      seen[fileName] = { size, mtimeMs, hash };
      const known = ledger.files[hash];
      if (known && FINAL.includes(known.status)) {
        report.alreadyHandled++;
        continue;
      }
      try {
        const activity = await this.store.add(bytes, fileName);
        record(hash, { fileName, status: 'imported', activityId: activity.id });
        report.imported.push(fileName);
      } catch (error) {
        if (error instanceof DuplicateActivityError) {
          const status = error.duplicate.status === 'exact' ? 'duplicate' : 'pending';
          record(hash, { fileName, status, activityId: error.duplicate.activityId });
          (status === 'duplicate' ? report.duplicates : report.pending).push(fileName);
        } else {
          record(hash, { fileName, status: 'failed', error: errorMessage(error) });
          report.failed.push({ fileName, error: errorMessage(error) });
        }
      }
    }

    report.finishedAt = new Date().toISOString();
    ledger.lastRun = report;
    ledger.seen = seen;
    delete ledger.lastError;
    await this.save(ledger);
    return report;
  }

  /**
   * Choix sur un doublon probable : `import` le relit dans la source et l'importe malgré la
   * ressemblance (l'existante n'est pas modifiée), `ignore` le laisse de côté définitivement.
   */
  decide(connector: ActivityConnector, hash: string, action: 'import' | 'ignore'): Promise<SyncFile> {
    return this.exclusive(async () => {
      const ledger = await this.load();
      const file = ledger.files[hash];
      if (file?.status !== 'pending') throw new SyncError('Aucun fichier en attente avec cette empreinte');
      if (action === 'ignore') {
        ledger.files[hash] = { ...file, status: 'ignored', at: new Date().toISOString() };
      } else {
        const bytes = await connector.read(file.fileName).catch(() => {
          throw new SyncError(`${file.fileName} n'est plus dans le dossier`);
        });
        if (hashOf(bytes) !== hash) throw new SyncError(`${file.fileName} a changé depuis la synchronisation`);
        const activity = await this.store.add(bytes, file.fileName, { confirmProbableDuplicate: true });
        ledger.files[hash] = {
          fileName: file.fileName,
          status: 'imported',
          activityId: activity.id,
          at: new Date().toISOString(),
        };
      }
      await this.save(ledger);
      return ledger.files[hash]!;
    });
  }
}
