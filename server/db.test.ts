import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import { DEFAULT_SETTINGS, type Activity, type LibraryHike, type Trip } from '../shared/schema';
import { ActivityStore } from './activity-store';
import { ActivitySync } from './activity-sync';
import { GPX_VAULT_DIR, UserDb, sha256Hex } from './db';
import { LibraryStore } from './library-store';
import { SettingsStore } from './settings-store';
import { TripStore } from './trip-store';

const sampleGpx = Buffer.from(recordedGpx([northboundPoints(20)], { name: 'Col du Festre' }));
const sampleHash = sha256Hex(sampleGpx);

const legacyTrip: Trip = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'devoluy',
  name: 'Dévoluy',
  startDate: '2026-12-10',
  endDate: '2026-12-11',
  travelers: { withDog: true },
  hikes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Col du Festre',
      gpxFile: 'gpx/22222222-2222-4222-8222-222222222222.gpx',
      kind: 'point-to-point',
      stats: {
        distanceKm: 2.1,
        elevationGainM: 120,
        elevationLossM: 0,
        maxAltitudeM: 1520,
        minAltitudeM: 1400,
        estimatedDurationMin: 45,
        profile: [{ distKm: 0, altM: 1400, lat: 45, lng: 6 }],
      },
      start: { lat: 45, lng: 6 },
      end: { lat: 45.02, lng: 6 },
      dogPolicy: 'allowed',
    },
  ],
  places: [],
  days: [
    { date: '2026-12-10', index: 1, stops: [], backupHikeIds: [] },
    { date: '2026-12-11', index: 2, stops: [], backupHikeIds: [] },
  ],
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const legacyLibraryHike: LibraryHike = {
  ...legacyTrip.hikes[0]!,
  id: '33333333-3333-4333-8333-333333333333',
  gpxFile: 'gpx/33333333-3333-4333-8333-333333333333.gpx',
  gpxHash: sampleHash,
  outings: [{ id: '44444444-4444-4444-8444-444444444444', date: '2026-11-01', durationMin: 50 }],
  createdAt: '2026-11-01T10:00:00.000Z',
};

const legacyActivity: Activity = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Sortie du col',
  source: 'alltrails',
  sourceId: null,
  activityDate: '2026-11-14T12:00:00Z',
  endedAt: '2026-11-14T13:00:00Z',
  distanceMeters: 2100,
  durationSeconds: 3600,
  elevationGainMeters: 120,
  elevationLossMeters: 0,
  metricsOrigin: { distance: 'calculated', duration: 'calculated', elevation: 'calculated' },
  pointCount: 20,
  segmentCount: 1,
  start: { lat: 45, lng: 6 },
  end: { lat: 45.02, lng: 6 },
  profile: [{ distKm: 0, altM: 1400, lat: 45, lng: 6 }],
  originalFileName: 'col.gpx',
  originalFile: 'gpx/55555555-5555-4555-8555-555555555555.gpx',
  fingerprint: sampleHash,
  linkedRouteId: legacyLibraryHike.id,
  importedAt: '2026-11-14T14:00:00.000Z',
};

describe('UserDb — socle SQLite, coffre GPX et migration JSON', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'itinera-db-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('migre une seule fois un dossier JSON complet vers SQLite sans altérer les sauvegardes JSON', async () => {
    const settingsFile = path.join(dir, 'settings.json');
    const tripJson = `${JSON.stringify(legacyTrip, null, 2)}\n`;
    const libraryJson = `${JSON.stringify({ schemaVersion: 1, hikes: [legacyLibraryHike] }, null, 2)}\n`;
    const activitiesJson = `${JSON.stringify({ schemaVersion: 1, activities: [legacyActivity] }, null, 2)}\n`;
    const syncJson = `${JSON.stringify({ schemaVersion: 1, files: { [sampleHash]: { fileName: 'col.gpx', status: 'imported', activityId: legacyActivity.id, at: '2026-11-14T14:00:00.000Z' } } }, null, 2)}\n`;
    const settingsJson = `${JSON.stringify({ ...DEFAULT_SETTINGS, dayStartTime: '07:45', obsidianVaultDir: '/tmp/vault' }, null, 2)}\n`;

    // Prépare un dossier hérité complet (y compris un voyage cassé qui doit être ignoré).
    await mkdir(path.join(dir, 'devoluy', 'gpx'), { recursive: true });
    await mkdir(path.join(dir, 'devoluy', 'cache'), { recursive: true });
    await mkdir(path.join(dir, 'casse'), { recursive: true });
    await mkdir(path.join(dir, '.library', 'gpx'), { recursive: true });
    await mkdir(path.join(dir, '.activities', 'gpx'), { recursive: true });

    await writeFile(path.join(dir, 'devoluy', 'trip.json'), tripJson);
    await writeFile(path.join(dir, 'devoluy', legacyTrip.hikes[0]!.gpxFile), sampleGpx);
    await writeFile(
      path.join(dir, 'devoluy', 'cache', 'poi.json'),
      JSON.stringify({ key: 'k', at: 123, pois: [] }),
    );
    await writeFile(path.join(dir, 'casse', 'trip.json'), '{broken');
    await writeFile(path.join(dir, '.library', 'library.json'), libraryJson);
    await writeFile(path.join(dir, '.library', legacyLibraryHike.gpxFile), sampleGpx);
    await writeFile(path.join(dir, '.activities', 'activities.json'), activitiesJson);
    await writeFile(path.join(dir, '.activities', legacyActivity.originalFile), sampleGpx);
    await writeFile(path.join(dir, '.activities', 'sync.json'), syncJson);
    await writeFile(settingsFile, settingsJson);

    const db = new UserDb(dir, settingsFile);
    expect(await db.ping()).toBe(true);
    const first = await db.ensureReady();
    expect(first).toEqual({
      ran: true,
      trips: 1,
      libraryHikes: 1,
      activities: 1,
      settings: true,
      syncLedger: true,
      vaultFiles: 1,
    });

    // Toutes les entités sont lisibles depuis les stores SQLite.
    const trips = new TripStore(db);
    const library = new LibraryStore(db, trips);
    const activities = new ActivityStore(db);
    const sync = new ActivitySync(db, activities);
    const settings = new SettingsStore(db);

    expect((await trips.get('devoluy')).name).toBe('Dévoluy');
    expect(await trips.readPoiCache('devoluy')).toEqual({ key: 'k', at: 123, pois: [] });
    expect(await library.list()).toEqual([legacyLibraryHike]);
    expect(await activities.list()).toEqual([legacyActivity]);
    expect((await sync.status(null)).pending).toEqual([]);
    expect(await settings.read()).toMatchObject({ dayStartTime: '07:45', obsidianVaultDir: '/tmp/vault' });

    // Le coffre GPX contient le fichier original octet pour octet.
    expect(await db.readGpxFromVault(sampleHash)).toEqual(sampleGpx);
    expect(await readFile(path.join(dir, GPX_VAULT_DIR, `${sampleHash}.gpx`))).toEqual(sampleGpx);

    // Sauvegarde JSON conservée intacte octet pour octet.
    expect(await readFile(path.join(dir, 'devoluy', 'trip.json'), 'utf8')).toBe(tripJson);
    expect(await readFile(path.join(dir, '.library', 'library.json'), 'utf8')).toBe(libraryJson);
    expect(await readFile(path.join(dir, '.activities', 'activities.json'), 'utf8')).toBe(activitiesJson);
    expect(await readFile(settingsFile, 'utf8')).toBe(settingsJson);

    // Idempotence : une modification en base survit à la réouverture, la migration ne repasse pas.
    await settings.write({ ...DEFAULT_SETTINGS, dayStartTime: '09:15' });
    await library.remove(legacyLibraryHike.id);
    await db.close();

    const reopened = new UserDb(dir, settingsFile);
    expect((await reopened.ensureReady()).ran).toBe(false);
    expect((await new SettingsStore(reopened).read()).dayStartTime).toBe('09:15');
    expect(await new LibraryStore(reopened, new TripStore(reopened)).list()).toEqual([]);
    await reopened.close();
  });

  it('déduplique et conserve les GPX immuables dans le coffre par SHA-256', async () => {
    const db = new UserDb(dir);
    await db.ensureReady();
    const hash1 = await db.storeGpxInVault(sampleGpx, 'premier.gpx');
    const hash2 = await db.storeGpxInVault(sampleGpx, 'second.gpx');
    expect(hash1).toBe(sampleHash);
    expect(hash2).toBe(sampleHash);
    expect(await db.listVaultHashes()).toEqual([sampleHash]);
    expect(await db.readGpxFromVault(sampleHash)).toEqual(sampleGpx);
    expect(await db.readGpxFromVault('0'.repeat(64))).toBeNull();
    await db.close();
  });
});
