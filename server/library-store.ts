import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { hikesWithPace } from '../shared/gpx';
import {
  LibraryHikeSchema,
  type Hike,
  type LibraryHike,
  type LibraryHikeFields,
  type LibraryLinks,
  type NewOuting,
  type Settings,
} from '../shared/schema';
import { UserDb, sha256Hex } from './db';
import { writeAtomic } from './fs-atomic';
import type { TripStore } from './trip-store';

export class LibraryHikeNotFoundError extends Error {}

const SEEDED_KEY = 'library_seeded';

/**
 * Randos communes aux voyages, indexées dans SQLite (`library_hikes`) avec GPX immuables
 * dans `.library/gpx/` et le coffre SHA-256 (`.gpx-vault/`).
 */
export class LibraryStore {
  private readonly root: string;
  private readonly userDb: UserDb;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    dirOrDb: string | UserDb,
    private readonly trips: TripStore,
  ) {
    if (typeof dirOrDb === 'string') {
      this.root = path.join(dirOrDb, '.library');
      this.userDb = new UserDb(dirOrDb);
    } else {
      this.root = path.join(dirOrDb.tripsDir, '.library');
      this.userDb = dirOrDb;
    }
  }

  /** Les écritures se suivent : deux requêtes simultanées ne doivent pas se marcher dessus. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeEntry(hike: LibraryHike): Promise<void> {
    const parsed = LibraryHikeSchema.parse(hike);
    await this.userDb.db
      .insertInto('library_hikes')
      .values({
        id: parsed.id,
        gpx_hash: parsed.gpxHash,
        name: parsed.name,
        data: JSON.stringify(parsed),
        created_at: parsed.createdAt,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: parsed.name,
          data: JSON.stringify(parsed),
        }),
      )
      .execute();
  }

  private async createEntry(hike: Hike, bytes: Buffer, gpxHash: string): Promise<LibraryHike> {
    const id = randomUUID();
    const gpxFile = `gpx/${id}.gpx`;
    await writeAtomic(path.join(this.root, gpxFile), bytes);
    await this.userDb.storeGpxInVault(bytes, `${hike.name}.gpx`);
    return { ...hike, id, gpxFile, gpxHash, outings: [], createdAt: new Date().toISOString() };
  }

  /** Reprend une seule fois les voyages existants : ensuite, retirer une rando reste définitif. */
  private async ensureSeeded(): Promise<void> {
    await this.userDb.ensureReady();
    if ((await this.userDb.getMeta(SEEDED_KEY)) !== null) return;
    const seen = new Set(
      (await this.userDb.db.selectFrom('library_hikes').select('gpx_hash').execute()).map(
        (r) => r.gpx_hash,
      ),
    );
    for (const { hike, bytes } of await this.trips.hikeFiles()) {
      const gpxHash = sha256Hex(bytes);
      if (seen.has(gpxHash)) continue;
      seen.add(gpxHash);
      await this.writeEntry(await this.createEntry(hike, bytes, gpxHash));
    }
    await this.userDb.setMeta(SEEDED_KEY, new Date().toISOString());
  }

  private async loadAll(): Promise<LibraryHike[]> {
    await this.ensureSeeded();
    const rows = await this.userDb.db
      .selectFrom('library_hikes')
      .select('data')
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map((row) => LibraryHikeSchema.parse(JSON.parse(row.data)));
  }

  private update(
    id: string,
    change: (hike: LibraryHike) => LibraryHike,
  ): Promise<LibraryHike> {
    return this.exclusive(async () => {
      await this.ensureSeeded();
      const row = await this.userDb.db
        .selectFrom('library_hikes')
        .select('data')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new LibraryHikeNotFoundError(id);
      const changed = change(LibraryHikeSchema.parse(JSON.parse(row.data)));
      await this.writeEntry(changed);
      return changed;
    });
  }

  list(): Promise<LibraryHike[]> {
    return this.exclusive(() => this.loadAll());
  }

  /** Garde un GPX importé dans un voyage. Le même fichier ne crée pas de doublon. */
  add(hike: Hike, bytes: Buffer): Promise<LibraryHike> {
    return this.exclusive(async () => {
      await this.ensureSeeded();
      const gpxHash = sha256Hex(bytes);
      const existing = await this.userDb.db
        .selectFrom('library_hikes')
        .select('data')
        .where('gpx_hash', '=', gpxHash)
        .executeTakeFirst();
      if (existing) return LibraryHikeSchema.parse(JSON.parse(existing.data));
      const added = await this.createEntry(hike, bytes, gpxHash);
      await this.writeEntry(added);
      return added;
    });
  }

  async read(id: string): Promise<{ hike: LibraryHike; bytes: Buffer }> {
    const hike = (await this.list()).find((candidate) => candidate.id === id);
    if (!hike) throw new LibraryHikeNotFoundError(id);
    return { hike, bytes: await readFile(path.join(this.root, hike.gpxFile)) };
  }

  updateFields(id: string, fields: LibraryHikeFields): Promise<LibraryHike> {
    const { name, alltrailsUrl, dogPolicy, notes, tags, rating } = fields;
    return this.update(id, (hike) => ({
      ...hike,
      name,
      alltrailsUrl,
      dogPolicy,
      notes,
      tags,
      rating,
    }));
  }

  addOuting(id: string, outing: NewOuting): Promise<LibraryHike> {
    return this.update(id, (hike) => ({
      ...hike,
      outings: [...hike.outings, { ...outing, id: randomUUID() }],
    }));
  }

  removeOuting(id: string, outingId: string): Promise<LibraryHike> {
    return this.update(id, (hike) => ({
      ...hike,
      outings: hike.outings.filter((outing) => outing.id !== outingId),
    }));
  }

  /** Le GPX part dans `.library/.trash` ; les voyages gardent leur copie. */
  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.ensureSeeded();
      const row = await this.userDb.db
        .selectFrom('library_hikes')
        .select('data')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new LibraryHikeNotFoundError(id);
      const hike = LibraryHikeSchema.parse(JSON.parse(row.data));
      await mkdir(path.join(this.root, '.trash'), { recursive: true });
      await rename(path.join(this.root, hike.gpxFile), path.join(this.root, '.trash', `${id}.gpx`));
      await this.userDb.db.deleteFrom('library_hikes').where('id', '=', id).execute();
    });
  }

  applyPace(pace: Settings['pace']): Promise<void> {
    return this.exclusive(async () => {
      const hikes = await this.loadAll();
      for (const updated of hikesWithPace(hikes, pace)) {
        await this.writeEntry(updated);
      }
    });
  }

  /** Pour un voyage : quelle rando de la bibliothèque correspond à chacune des siennes. */
  async links(slug: string): Promise<LibraryLinks> {
    const hikes = await this.list();
    const files = await this.trips.hikeFiles(slug);
    return Object.fromEntries(
      files.flatMap(({ hike, bytes }) => {
        const gpxHash = sha256Hex(bytes);
        const known = hikes.find((candidate) => candidate.gpxHash === gpxHash);
        return known ? [[hike.id, known.id]] : [];
      }),
    );
  }
}
