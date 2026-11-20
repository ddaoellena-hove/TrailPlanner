import path from 'node:path';
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../shared/schema';
import { UserDb } from './db';

/** Réglages globaux stockés dans SQLite (`settings`). Sans entrée, revient aux valeurs par défaut. */
export class SettingsStore {
  private readonly userDb: UserDb;

  constructor(fileOrDb: string | UserDb) {
    this.userDb =
      typeof fileOrDb === 'string'
        ? new UserDb(path.dirname(fileOrDb), fileOrDb)
        : fileOrDb;
  }

  async read(): Promise<Settings> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('settings')
      .select('data')
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!row) return DEFAULT_SETTINGS;
    try {
      return SettingsSchema.parse(JSON.parse(row.data));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async write(settings: Settings): Promise<void> {
    await this.userDb.ensureReady();
    const data = JSON.stringify(SettingsSchema.parse(settings));
    const updated_at = new Date().toISOString();
    await this.userDb.db
      .insertInto('settings')
      .values({ id: 1, data, updated_at })
      .onConflict((oc) => oc.column('id').doUpdateSet({ data, updated_at }))
      .execute();
  }
}
