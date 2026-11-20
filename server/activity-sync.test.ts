import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import { ConnectorError, FolderConnector } from './activity-connector';
import { ActivityStore } from './activity-store';
import { ActivitySync, SyncError } from './activity-sync';

const morning = recordedGpx([northboundPoints(40)], { name: 'Matin' });
const otherDay = recordedGpx([northboundPoints(40, { start: '2026-07-08T06:00:00Z' })], {
  name: 'Semaine suivante',
});
// Même sortie que `morning`, autre export : départ 2 min plus tard, points décalés de ~20 m.
const sameOuting = recordedGpx(
  [northboundPoints(40, { start: '2026-07-01T06:02:00Z', lng: 6.00025 })],
  { name: 'Montre' },
);

describe('synchronisation depuis un dossier', () => {
  let tripsDir: string;
  let folder: string;
  let store: ActivityStore;
  let sync: ActivitySync;
  let connector: FolderConnector;

  /** Fichier « posé » il y a une minute : assez ancien pour ne plus être en cours d'écriture. */
  const drop = async (name: string, content: string) => {
    const file = path.join(folder, name);
    await writeFile(file, content);
    const past = new Date(Date.now() - 60_000);
    await utimes(file, past, past);
    return file;
  };

  beforeEach(async () => {
    tripsDir = await mkdtemp(path.join(tmpdir(), 'itinera-sync-'));
    folder = path.join(tripsDir, 'exports-alltrails');
    await mkdir(folder);
    store = new ActivityStore(tripsDir);
    sync = new ActivitySync(tripsDir, store);
    connector = new FolderConnector(folder);
  });

  afterEach(async () => {
    await rm(tripsDir, { recursive: true, force: true });
  });

  it('importe les nouveaux GPX puis ne les relit plus', async () => {
    await drop('matin.gpx', morning);
    await drop('semaine.GPX', otherDay);

    const first = await sync.run(connector);
    expect(first.imported).toEqual(['matin.gpx', 'semaine.GPX']);
    expect((await store.list()).map(({ title }) => title).toSorted()).toEqual([
      'Matin',
      'Semaine suivante',
    ]);

    const second = await sync.run(connector);
    expect(second).toMatchObject({ imported: [], duplicates: [], failed: [], alreadyHandled: 2 });
    expect(await store.list()).toHaveLength(2);
    expect((await sync.status(folder)).lastRun).toEqual(second);
  });

  it('ne modifie, ne déplace ni ne supprime les fichiers du dossier', async () => {
    const file = await drop('matin.gpx', morning);
    const before = await stat(file);
    await sync.run(connector);
    expect(await readdir(folder)).toEqual(['matin.gpx']);
    expect(await readFile(file, 'utf8')).toBe(morning);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('reconnaît un fichier déjà importé à la main comme doublon', async () => {
    const manual = await store.add(Buffer.from(morning), 'import-manuel.gpx');
    await drop('copie.gpx', morning);
    const report = await sync.run(connector);
    expect(report.duplicates).toEqual(['copie.gpx']);
    expect(await store.list()).toEqual([manual]);
  });

  it('met un doublon probable en attente, puis suit le choix de l’utilisateur', async () => {
    await drop('matin.gpx', morning);
    await sync.run(connector);
    await drop('montre.gpx', sameOuting);
    await drop('montre-bis.gpx', `${sameOuting}\n`);

    const report = await sync.run(connector);
    expect(report.pending).toEqual(['montre-bis.gpx', 'montre.gpx']);
    expect(await store.list()).toHaveLength(1);

    const [bis, montre] = (await sync.status(folder)).pending.toSorted((a, b) =>
      a.fileName.localeCompare(b.fileName),
    );
    expect(montre).toMatchObject({ fileName: 'montre.gpx', status: 'pending' });
    // En attente : un nouveau passage ne l'importe pas.
    expect((await sync.run(connector)).alreadyHandled).toBe(3);

    expect(await sync.decide(connector, montre!.hash, 'import')).toMatchObject({ status: 'imported' });
    expect(await sync.decide(connector, bis!.hash, 'ignore')).toMatchObject({ status: 'ignored' });
    expect((await store.list()).map(({ title }) => title).toSorted()).toEqual(['Matin', 'Montre']);
    expect((await sync.status(folder)).pending).toEqual([]);
    await expect(sync.decide(connector, montre!.hash, 'import')).rejects.toThrow(SyncError);
  });

  it('refuse d’importer un fichier en attente qui a changé ou disparu', async () => {
    await drop('matin.gpx', morning);
    await sync.run(connector);
    const file = await drop('montre.gpx', sameOuting);
    await sync.run(connector);
    const [pending] = (await sync.status(folder)).pending;

    await writeFile(file, otherDay);
    await expect(sync.decide(connector, pending!.hash, 'import')).rejects.toThrow('a changé');
    await rm(file);
    await expect(sync.decide(connector, pending!.hash, 'import')).rejects.toThrow("n'est plus");
    expect(await store.list()).toHaveLength(1);
  });

  it('retente un fichier en échec, sans bloquer les autres', async () => {
    const broken = await drop('cassé.gpx', '<gpx><trk>');
    await drop('matin.gpx', morning);

    const first = await sync.run(connector);
    expect(first.imported).toEqual(['matin.gpx']);
    expect(first.failed).toEqual([
      { fileName: 'cassé.gpx', error: "Ce fichier n'est pas un GPX lisible" },
    ]);

    // L'utilisateur réexporte le fichier : il est importé au passage suivant.
    await writeFile(broken, otherDay);
    const past = new Date(Date.now() - 60_000);
    await utimes(broken, past, past);
    const second = await sync.run(connector);
    expect(second.imported).toEqual(['cassé.gpx']);
    expect(second.failed).toEqual([]);
  });

  it('ignore les autres fichiers, sous-dossiers, liens et fichiers en cours d’écriture', async () => {
    await drop('notes.txt', 'pas un gpx');
    await drop('.cache.gpx', morning);
    await mkdir(path.join(folder, 'archives.gpx'));
    await writeFile(path.join(tripsDir, 'ailleurs.gpx'), otherDay);
    await symlink(path.join(tripsDir, 'ailleurs.gpx'), path.join(folder, 'lien.gpx'));
    await writeFile(path.join(folder, 'en-cours.gpx'), morning);

    const report = await sync.run(connector);
    expect(report).toMatchObject({ imported: [], failed: [], alreadyHandled: 0 });
    expect(await store.list()).toEqual([]);
  });

  it('refuse un fichier trop volumineux, sans l’importer', async () => {
    await drop('énorme.gpx', `${morning}<!--${'x'.repeat(11 * 1024 * 1024)}-->`);
    const report = await sync.run(connector);
    expect(report.failed).toEqual([
      { fileName: 'énorme.gpx', error: 'Fichier trop volumineux (10 Mo maximum)' },
    ]);
  });

  it('partage un passage déjà en cours au lieu d’en lancer un second', async () => {
    await drop('matin.gpx', morning);
    const [a, b] = await Promise.all([sync.run(connector), sync.run(connector)]);
    expect(a).toBe(b);
    expect(await store.list()).toHaveLength(1);
  });

  it('explique un dossier absent, un fichier à la place, ou un chemin relatif', async () => {
    await expect(new FolderConnector(path.join(folder, 'absent')).list()).rejects.toThrow(
      'Dossier introuvable',
    );
    const file = await drop('matin.gpx', morning);
    await expect(new FolderConnector(file).list()).rejects.toThrow("n'est pas un dossier");
    expect(() => new FolderConnector('exports')).toThrow(ConnectorError);
  });
  it('ne relit pas un fichier inchangé déjà traité, mais relit un fichier modifié', async () => {
    await drop('matin.gpx', morning);
    await drop('semaine.gpx', otherDay);
    await sync.run(connector);

    const reads: string[] = [];
    const counting = new FolderConnector(folder);
    const read = counting.read.bind(counting);
    counting.read = (fileName) => {
      reads.push(fileName);
      return read(fileName);
    };
    expect((await sync.run(counting)).alreadyHandled).toBe(2);
    expect(reads).toEqual([]);

    // Réexporté sous le même nom avec un autre contenu : relu, et importé.
    await drop('semaine.gpx', sameOuting.replace('Montre', 'Autre sortie').replace(/06:0/g, '09:0'));
    const report = await sync.run(counting);
    expect(reads).toEqual(['semaine.gpx']);
    expect(report.imported).toEqual(['semaine.gpx']);
  });

  it('retient un passage impossible, puis l’efface au passage suivant réussi', async () => {
    await rm(folder, { recursive: true });
    await expect(sync.run(connector)).rejects.toThrow('Dossier introuvable');
    const failed = await sync.status(folder);
    expect(failed.lastError?.message).toContain('Dossier introuvable');
    expect(failed.lastRun).toBeNull();

    await mkdir(folder);
    await sync.run(connector);
    expect((await sync.status(folder)).lastError).toBeNull();
  });
});
