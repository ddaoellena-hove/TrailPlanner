import type { Settings } from '../shared/schema';
import { FolderConnector } from './activity-connector';
import type { ActivitySync } from './activity-sync';

/** Intervalle entre deux passages automatiques. Aucun appel réseau : le coût est un `stat` par fichier. */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Premier passage peu après le démarrage du serveur. */
export const AUTO_SYNC_FIRST_DELAY_MS = 10 * 1000;

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * Passages automatiques du dossier surveillé, seulement si l'utilisateur les a activés.
 * Les réglages sont relus à chaque tour : activer, désactiver ou changer de dossier
 * s'applique sans redémarrer. Un échec est retenu dans le registre et n'arrête pas les tours.
 */
export class AutoSync {
  private handle: unknown = null;
  private stopped = true;

  constructor(
    private readonly sync: ActivitySync,
    private readonly readSettings: () => Promise<Settings>,
    private readonly intervalMs = AUTO_SYNC_INTERVAL_MS,
    private readonly timers: Timers = {
      setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  ) {}

  start(firstDelayMs = AUTO_SYNC_FIRST_DELAY_MS): void {
    this.stopped = false;
    this.schedule(firstDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.handle = this.timers.setTimeout(() => {
      void this.tick().finally(() => this.schedule(this.intervalMs));
    }, ms);
  }

  /** Un tour : rien si désactivé ou sans dossier ; sinon un passage (partagé s'il y en a déjà un). */
  async tick(): Promise<'skipped' | 'ran' | 'failed'> {
    const { activityAutoSync, activityImportFolder } = await this.readSettings();
    if (!activityAutoSync || !activityImportFolder) return 'skipped';
    try {
      await this.sync.run(new FolderConnector(activityImportFolder));
      return 'ran';
    } catch (error) {
      // Déjà retenu dans le registre par le passage (dossier absent…) : on continue les tours.
      console.warn('Synchronisation automatique impossible :', error);
      return 'failed';
    }
  }
}
