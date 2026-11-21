import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import {
  ActivityStoreSchema,
  DriveLegSchema,
  LibrarySchema,
  PoiSchema,
  SettingsSchema,
  SyncLedgerSchema,
  TripSchema,
} from '../shared/schema';
import { z } from 'zod';
import { writeAtomic } from './fs-atomic';

export interface MetaTable {
  key: string;
  value: string;
}

export interface SettingsTable {
  id: number;
  data: string;
  updated_at: string;
}

export interface TripsTable {
  slug: string;
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface RouteCacheTable {
  trip_slug: string;
  data: string;
  updated_at: string;
}

export interface PoiCacheTable {
  trip_slug: string;
  data: string;
  updated_at: string;
}

export interface LibraryHikesTable {
  id: string;
  gpx_hash: string;
  name: string;
  data: string;
  created_at: string;
}

export interface ActivitiesTable {
  id: string;
  fingerprint: string;
  title: string;
  activity_date: string | null;
  linked_route_id: string | null;
  data: string;
  imported_at: string;
}

export interface ActivitySyncTable {
  id: number;
  data: string;
  updated_at: string;
}

export interface GpxVaultTable {
  sha256: string;
  relative_path: string;
  byte_size: number;
  original_file_name: string;
  created_at: string;
}

export interface SuggestionFeedbackTable {
  id: string;
  trail_id: string;
  origin_lat: number;
  origin_lng: number;
  verdict: string;
  reason: string | null;
  created_at: string;
}

export interface EscapadesTable {
  id: string;
  title: string;
  trail_id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface ItineraDatabase {
  meta: MetaTable;
  settings: SettingsTable;
  trips: TripsTable;
  route_cache: RouteCacheTable;
  poi_cache: PoiCacheTable;
  library_hikes: LibraryHikesTable;
  activities: ActivitiesTable;
  activity_sync: ActivitySyncTable;
  gpx_vault: GpxVaultTable;
  suggestion_feedback: SuggestionFeedbackTable;
  escapades: EscapadesTable;
}

export const DB_FILE_NAME = 'itinera.db';
export const GPX_VAULT_DIR = '.gpx-vault';

const JSON_MIGRATION_KEY = 'json_migrated_v1';
const RouteCacheSchema = z.record(z.string(), DriveLegSchema);
const PoiCacheSchema = z.object({ key: z.string(), at: z.number(), pois: z.array(PoiSchema) });

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    slug TEXT PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS route_cache (
    trip_slug TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS poi_cache (
    trip_slug TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS library_hikes (
    id TEXT PRIMARY KEY,
    gpx_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    activity_date TEXT,
    linked_route_id TEXT,
    data TEXT NOT NULL,
    imported_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_sync (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS gpx_vault (
    sha256 TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    original_file_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS suggestion_feedback (
    id TEXT PRIMARY KEY,
    trail_id TEXT NOT NULL,
    origin_lat REAL NOT NULL,
    origin_lng REAL NOT NULL,
    verdict TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS escapades (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    trail_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

export type MigrationReport = {
  ran: boolean;
  trips: number;
  libraryHikes: number;
  activities: number;
  settings: boolean;
  syncLedger: boolean;
  vaultFiles: number;
};

/**
 * Socle SQLite unique d'Itinera (`<tripsDir>/itinera.db`) via better-sqlite3 + Kysely,
 * accompagné d'un coffre GPX immuable (`.gpx-vault/<sha256>.gpx`).
 */
export class UserDb {
  readonly dbPath: string;
  sqlite!: Database.Database;
  db!: Kysely<ItineraDatabase>;
  private openedIno: number | null = null;
  private migrationPromise: Promise<MigrationReport> | null = null;
  private closed = false;

  constructor(
    readonly tripsDir: string,
    readonly legacySettingsFile?: string,
  ) {
    this.dbPath = path.join(tripsDir, DB_FILE_NAME);
    this.openConnection();
  }

  private openConnection(): void {
    mkdirSync(this.tripsDir, { recursive: true });
    this.sqlite = new Database(this.dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    for (const statement of SCHEMA_STATEMENTS) {
      this.sqlite.exec(statement);
    }
    this.db = new Kysely<ItineraDatabase>({
      dialect: new SqliteDialect({ database: this.sqlite }),
    });
    this.openedIno = statSync(this.dbPath).ino;
    this.closed = false;
  }

  /** Rouvre la base si le dossier a été vidé ou remplacé sur disque pendant l'exécution (ex. e2e). */
  private reopenIfReplaced(): void {
    if (this.closed) return;
    let currentIno: number | null;
    try {
      currentIno = statSync(this.dbPath).ino;
    } catch {
      currentIno = null;
    }
    if (currentIno === this.openedIno) return;
    try {
      this.sqlite.close();
    } catch {
      // Déjà fermée ou remplacée.
    }
    this.migrationPromise = null;
    this.openConnection();
  }

  /** S'assure que la migration unique depuis les fichiers JSON hérités a été exécutée. */
  ensureReady(): Promise<MigrationReport> {
    this.reopenIfReplaced();
    this.migrationPromise ??= this.migrateLegacyJsonOnce();
    return this.migrationPromise;
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('meta')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db
      .insertInto('meta')
      .values({ key, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute();
  }

  /**
   * Coffre GPX immuable : stocke le fichier brut une seule fois par empreinte SHA-256,
   * sans jamais réécrire un fichier déjà présent.
   */
  async storeGpxInVault(bytes: Buffer, originalFileName: string): Promise<string> {
    const sha256 = sha256Hex(bytes);
    const relativePath = `${GPX_VAULT_DIR}/${sha256}.gpx`;
    const diskPath = path.join(this.tripsDir, relativePath);
    if (!existsSync(diskPath)) {
      await writeAtomic(diskPath, bytes);
    }
    await this.db
      .insertInto('gpx_vault')
      .values({
        sha256,
        relative_path: relativePath,
        byte_size: bytes.byteLength,
        original_file_name: originalFileName,
        created_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.column('sha256').doNothing())
      .execute();
    return sha256;
  }

  async readGpxFromVault(sha256: string): Promise<Buffer | null> {
    const row = await this.db
      .selectFrom('gpx_vault')
      .select('relative_path')
      .where('sha256', '=', sha256)
      .executeTakeFirst();
    if (!row) return null;
    try {
      return await readFile(path.join(this.tripsDir, row.relative_path));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async listVaultHashes(): Promise<string[]> {
    const rows = await this.db.selectFrom('gpx_vault').select('sha256').execute();
    return rows.map((r) => r.sha256);
  }

  /**
   * Migration unique et non destructive des fichiers JSON hérités vers SQLite.
   * Les fichiers JSON d'origine restent intacts sur disque comme sauvegarde.
   */
  private async migrateLegacyJsonOnce(): Promise<MigrationReport> {
    const already = await this.getMeta(JSON_MIGRATION_KEY);
    if (already !== null) {
      return {
        ran: false,
        trips: 0,
        libraryHikes: 0,
        activities: 0,
        settings: false,
        syncLedger: false,
        vaultFiles: 0,
      };
    }

    const now = new Date().toISOString();
    const report: MigrationReport = {
      ran: true,
      trips: 0,
      libraryHikes: 0,
      activities: 0,
      settings: false,
      syncLedger: false,
      vaultFiles: 0,
    };

    const gpxToVault: { bytes: Buffer; fileName: string }[] = [];

    // 1. Voyages (`<tripsDir>/<slug>/trip.json` + caches + GPX)
    const parsedTrips: {
      trip: z.infer<typeof TripSchema>;
      routeCache: string | null;
      poiCache: string | null;
    }[] = [];
    let entries;
    try {
      entries = await readdir(this.tripsDir, { withFileTypes: true });
    } catch (error) {
      entries = isMissing(error) ? [] : (() => { throw error; })();
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const slug = entry.name;
      const tripFile = path.join(this.tripsDir, slug, 'trip.json');
      try {
        const raw = await readFile(tripFile, 'utf8');
        const trip = TripSchema.parse(JSON.parse(raw));
        let routeCache: string | null = null;
        try {
          const rcRaw = await readFile(path.join(this.tripsDir, slug, 'cache', 'routes.json'), 'utf8');
          routeCache = JSON.stringify(RouteCacheSchema.parse(JSON.parse(rcRaw)));
        } catch {
          // Cache absent ou illisible : ignoré.
        }
        let poiCache: string | null = null;
        try {
          const pcRaw = await readFile(path.join(this.tripsDir, slug, 'cache', 'poi.json'), 'utf8');
          poiCache = JSON.stringify(PoiCacheSchema.parse(JSON.parse(pcRaw)));
        } catch {
          // Cache absent ou illisible : ignoré.
        }
        for (const hike of trip.hikes) {
          try {
            const bytes = await readFile(path.join(this.tripsDir, slug, hike.gpxFile));
            gpxToVault.push({ bytes, fileName: `${hike.name}.gpx` });
          } catch {
            // GPX manquant : n'empêche pas la migration du voyage.
          }
        }
        parsedTrips.push({ trip, routeCache, poiCache });
      } catch (error) {
        if (!isMissing(error)) console.warn(`Migration JSON : voyage ignoré (${slug}) :`, error);
      }
    }

    // 2. Bibliothèque (`<tripsDir>/.library/library.json`)
    let libraryExisted = false;
    let parsedLibrary: z.infer<typeof LibrarySchema>['hikes'] = [];
    const libraryFile = path.join(this.tripsDir, '.library', 'library.json');
    try {
      const raw = await readFile(libraryFile, 'utf8');
      libraryExisted = true;
      parsedLibrary = LibrarySchema.parse(JSON.parse(raw)).hikes;
      for (const hike of parsedLibrary) {
        try {
          const bytes = await readFile(path.join(this.tripsDir, '.library', hike.gpxFile));
          gpxToVault.push({ bytes, fileName: `${hike.name}.gpx` });
        } catch {
          // GPX manquant : ignoré.
        }
      }
    } catch (error) {
      if (!isMissing(error)) console.warn('Migration JSON : bibliothèque ignorée :', error);
    }

    // 3. Activités enregistrées (`<tripsDir>/.activities/activities.json`)
    let parsedActivities: z.infer<typeof ActivityStoreSchema>['activities'] = [];
    const activitiesFile = path.join(this.tripsDir, '.activities', 'activities.json');
    try {
      const raw = await readFile(activitiesFile, 'utf8');
      parsedActivities = ActivityStoreSchema.parse(JSON.parse(raw)).activities;
      for (const activity of parsedActivities) {
        try {
          const bytes = await readFile(path.join(this.tripsDir, '.activities', activity.originalFile));
          gpxToVault.push({ bytes, fileName: activity.originalFileName });
        } catch {
          // GPX manquant : ignoré.
        }
      }
    } catch (error) {
      if (!isMissing(error)) console.warn('Migration JSON : activités ignorées :', error);
    }

    // 4. Registre de synchronisation (`<tripsDir>/.activities/sync.json`)
    let parsedSync: z.infer<typeof SyncLedgerSchema> | null = null;
    const syncFile = path.join(this.tripsDir, '.activities', 'sync.json');
    try {
      const raw = await readFile(syncFile, 'utf8');
      parsedSync = SyncLedgerSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (!isMissing(error)) console.warn('Migration JSON : sync ignoré :', error);
    }

    // 5. Réglages (`settings.json`)
    let parsedSettings: z.infer<typeof SettingsSchema> | null = null;
    const settingsPath = this.legacySettingsFile ?? path.join(this.tripsDir, 'settings.json');
    try {
      const info = await stat(settingsPath);
      if (info.isFile()) {
        const raw = await readFile(settingsPath, 'utf8');
        parsedSettings = SettingsSchema.parse(JSON.parse(raw));
      }
    } catch (error) {
      if (!isMissing(error)) console.warn('Migration JSON : réglages ignorés :', error);
    }

    // Écriture des GPX dans le coffre immuable avant la transaction SQL.
    const vaulted = new Map<string, { relativePath: string; byteSize: number; fileName: string }>();
    for (const item of gpxToVault) {
      const sha256 = sha256Hex(item.bytes);
      if (vaulted.has(sha256)) continue;
      const relativePath = `${GPX_VAULT_DIR}/${sha256}.gpx`;
      const diskPath = path.join(this.tripsDir, relativePath);
      if (!existsSync(diskPath)) {
        await writeAtomic(diskPath, item.bytes);
      }
      vaulted.set(sha256, {
        relativePath,
        byteSize: item.bytes.byteLength,
        fileName: item.fileName,
      });
    }

    // Transaction SQLite atomique : tout ou rien.
    await this.db.transaction().execute(async (trx) => {
      const existingFlag = await trx
        .selectFrom('meta')
        .select('value')
        .where('key', '=', JSON_MIGRATION_KEY)
        .executeTakeFirst();
      if (existingFlag) {
        report.ran = false;
        return;
      }

      for (const { trip, routeCache, poiCache } of parsedTrips) {
        await trx
          .insertInto('trips')
          .values({
            slug: trip.slug,
            id: trip.id,
            name: trip.name,
            start_date: trip.startDate,
            end_date: trip.endDate,
            data: JSON.stringify(trip),
            created_at: trip.createdAt,
            updated_at: trip.updatedAt,
          })
          .onConflict((oc) => oc.column('slug').doNothing())
          .execute();
        if (routeCache) {
          await trx
            .insertInto('route_cache')
            .values({ trip_slug: trip.slug, data: routeCache, updated_at: now })
            .onConflict((oc) => oc.column('trip_slug').doNothing())
            .execute();
        }
        if (poiCache) {
          await trx
            .insertInto('poi_cache')
            .values({ trip_slug: trip.slug, data: poiCache, updated_at: now })
            .onConflict((oc) => oc.column('trip_slug').doNothing())
            .execute();
        }
        report.trips++;
      }

      for (const hike of parsedLibrary) {
        await trx
          .insertInto('library_hikes')
          .values({
            id: hike.id,
            gpx_hash: hike.gpxHash,
            name: hike.name,
            data: JSON.stringify(hike),
            created_at: hike.createdAt,
          })
          .onConflict((oc) => oc.column('gpx_hash').doNothing())
          .execute();
        report.libraryHikes++;
      }
      if (libraryExisted) {
        await trx
          .insertInto('meta')
          .values({ key: 'library_seeded', value: now })
          .onConflict((oc) => oc.column('key').doNothing())
          .execute();
      }

      for (const activity of parsedActivities) {
        await trx
          .insertInto('activities')
          .values({
            id: activity.id,
            fingerprint: activity.fingerprint,
            title: activity.title,
            activity_date: activity.activityDate,
            linked_route_id: activity.linkedRouteId,
            data: JSON.stringify(activity),
            imported_at: activity.importedAt,
          })
          .onConflict((oc) => oc.column('fingerprint').doNothing())
          .execute();
        report.activities++;
      }

      if (parsedSync) {
        await trx
          .insertInto('activity_sync')
          .values({ id: 1, data: JSON.stringify(parsedSync), updated_at: now })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();
        report.syncLedger = true;
      }

      if (parsedSettings) {
        await trx
          .insertInto('settings')
          .values({ id: 1, data: JSON.stringify(parsedSettings), updated_at: now })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();
        report.settings = true;
      }

      for (const [sha256, info] of vaulted) {
        await trx
          .insertInto('gpx_vault')
          .values({
            sha256,
            relative_path: info.relativePath,
            byte_size: info.byteSize,
            original_file_name: info.fileName,
            created_at: now,
          })
          .onConflict((oc) => oc.column('sha256').doNothing())
          .execute();
        report.vaultFiles++;
      }

      await trx
        .insertInto('meta')
        .values({ key: JSON_MIGRATION_KEY, value: now })
        .execute();
    });

    return report;
  }

  /** Vérifie que SQLite est joignable (utile pour les tests et diagnostics). */
  async ping(): Promise<boolean> {
    const res = await sql<{ ok: number }>`SELECT 1 AS ok`.execute(this.db);
    return res.rows[0]?.ok === 1;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.db.destroy();
  }
}
