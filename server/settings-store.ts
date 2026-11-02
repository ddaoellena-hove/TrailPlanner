import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, type Settings, SettingsSchema } from '../shared/schema';
import { writeAtomic } from './trip-store';

/** Réglages globaux. Un fichier absent ou illisible revient aux valeurs par défaut. */
export class SettingsStore {
  constructor(private readonly file: string) {}

  async read(): Promise<Settings> {
    try {
      return SettingsSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async write(settings: Settings): Promise<void> {
    await writeAtomic(this.file, `${JSON.stringify(settings, null, 2)}\n`);
  }
}
