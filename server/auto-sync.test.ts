import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import { DEFAULT_SETTINGS, type Settings } from '../shared/schema';
import { ActivityStore } from './activity-store';
import { ActivitySync } from './activity-sync';
import { AutoSync } from './auto-sync';

/** Minuteur manuel : les tests avancent les tours eux-mêmes. */
function manualTimers() {
  const pending: { callback: () => void; ms: number }[] = [];
  return {
    pending,
    setTimeout: (callback: () => void, ms: number) => {
      const entry = { callback, ms };
      pending.push(entry);
      return entry;
    },
    clearTimeout: (handle: unknown) => {
      const index = pending.indexOf(handle as (typeof pending)[number]);
      if (index >= 0) pending.splice(index, 1);
    },
    /** Déclenche le prochain tour et attend qu'il se termine. */
    async fire() {
      const next = pending.shift();
      next?.callback();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return next;
    },
  };
}

describe('synchronisation automatique', () => {
  let dir: string;
  let folder: string;
  let settings: Settings;
  let store: ActivityStore;
  let sync: ActivitySync;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'trailplanner-auto-'));
    folder = path.join(dir, 'exports');
    await mkdir(folder);
    const file = path.join(folder, 'matin.gpx');
    await writeFile(file, recordedGpx([northboundPoints(20)]));
    const past = new Date(Date.now() - 60_000);
    await utimes(file, past, past);
    settings = { ...DEFAULT_SETTINGS, activityImportFolder: folder };
    store = new ActivityStore(dir);
    sync = new ActivitySync(dir, store);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('ne fait rien tant qu’elle n’est pas activée', async () => {
    const auto = new AutoSync(sync, async () => settings);
    expect(await auto.tick()).toBe('skipped');
    expect(await store.list()).toEqual([]);
  });

  it('importe à chaque tour une fois activée, et relit les réglages à chaque tour', async () => {
    const auto = new AutoSync(sync, async () => settings);
    settings = { ...settings, activityAutoSync: true };
    expect(await auto.tick()).toBe('ran');
    expect(await store.list()).toHaveLength(1);

    settings = { ...settings, activityAutoSync: false };
    expect(await auto.tick()).toBe('skipped');
  });

  it('continue ses tours après un dossier introuvable, et le signale', async () => {
    settings = { ...settings, activityAutoSync: true, activityImportFolder: path.join(dir, 'absent') };
    const auto = new AutoSync(sync, async () => settings);
    expect(await auto.tick()).toBe('failed');
    expect((await sync.status(null)).lastError?.message).toContain('Dossier introuvable');
  });

  it('enchaîne les tours à l’intervalle prévu et s’arrête proprement', async () => {
    settings = { ...settings, activityAutoSync: true };
    const timers = manualTimers();
    const auto = new AutoSync(sync, async () => settings, 1000, timers);
    auto.start(10);
    expect(timers.pending.map(({ ms }) => ms)).toEqual([10]);

    await timers.fire();
    expect(await store.list()).toHaveLength(1);
    expect(timers.pending.map(({ ms }) => ms)).toEqual([1000]);

    await timers.fire();
    expect(await store.list()).toHaveLength(1);
    auto.stop();
    expect(timers.pending).toEqual([]);
  });
});
