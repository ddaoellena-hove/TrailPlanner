import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { hikesWithPace } from '../shared/gpx';
import {
  type Hike,
  type Library,
  type LibraryHike,
  type LibraryHikeFields,
  type LibraryLinks,
  LibrarySchema,
  type NewOuting,
  type Settings,
} from '../shared/schema';
import { type TripStore, writeAtomic } from './trip-store';

export class LibraryHikeNotFoundError extends Error {}

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Randos communes aux voyages : `<trips>/.library/`. Les voyages en gardent une copie, la
 * bibliothèque ne lit donc jamais leurs fichiers après la reprise initiale.
 */
export class LibraryStore {
  private readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    tripsDir: string,
    private readonly trips: TripStore,
  ) {
    this.root = path.join(tripsDir, '.library');
  }

  private get file(): string {
    return path.join(this.root, 'library.json');
  }

  /** Les écritures se suivent : deux requêtes simultanées ne doivent pas s'écraser. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(library: Library): Promise<void> {
    await writeAtomic(this.file, `${JSON.stringify(LibrarySchema.parse(library), null, 2)}\n`);
  }

  private async entry(hike: Hike, bytes: Buffer, gpxHash: string): Promise<LibraryHike> {
    const id = randomUUID();
    const gpxFile = `gpx/${id}.gpx`;
    await writeAtomic(path.join(this.root, gpxFile), bytes);
    return { ...hike, id, gpxFile, gpxHash, outings: [], createdAt: new Date().toISOString() };
  }

  /** Reprend une seule fois les voyages existants : ensuite, retirer une rando reste définitif. */
  private async load(): Promise<Library> {
    try {
      return LibrarySchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const library: Library = { schemaVersion: 1, hikes: [] };
    for (const { hike, bytes } of await this.trips.hikeFiles()) {
      const gpxHash = hashOf(bytes);
      if (library.hikes.some((known) => known.gpxHash === gpxHash)) continue;
      library.hikes.push(await this.entry(hike, bytes, gpxHash));
    }
    await this.write(library);
    return library;
  }

  private update(
    id: string,
    change: (hike: LibraryHike) => LibraryHike,
  ): Promise<LibraryHike> {
    return this.exclusive(async () => {
      const library = await this.load();
      const current = library.hikes.find((hike) => hike.id === id);
      if (!current) throw new LibraryHikeNotFoundError(id);
      const changed = change(current);
      const hikes = library.hikes.map((hike) => (hike.id === id ? changed : hike));
      await this.write({ ...library, hikes });
      return changed;
    });
  }

  list(): Promise<LibraryHike[]> {
    return this.exclusive(async () => (await this.load()).hikes);
  }

  /** Garde un GPX importé dans un voyage. Le même fichier ne crée pas de doublon. */
  add(hike: Hike, bytes: Buffer): Promise<LibraryHike> {
    return this.exclusive(async () => {
      const library = await this.load();
      const gpxHash = hashOf(bytes);
      const known = library.hikes.find((candidate) => candidate.gpxHash === gpxHash);
      if (known) return known;
      const added = await this.entry(hike, bytes, gpxHash);
      await this.write({ ...library, hikes: [...library.hikes, added] });
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
      const library = await this.load();
      const hike = library.hikes.find((candidate) => candidate.id === id);
      if (!hike) throw new LibraryHikeNotFoundError(id);
      await mkdir(path.join(this.root, '.trash'), { recursive: true });
      await rename(path.join(this.root, hike.gpxFile), path.join(this.root, '.trash', `${id}.gpx`));
      await this.write({ ...library, hikes: library.hikes.filter(({ id: other }) => other !== id) });
    });
  }

  applyPace(pace: Settings['pace']): Promise<void> {
    return this.exclusive(async () => {
      const library = await this.load();
      await this.write({ ...library, hikes: hikesWithPace(library.hikes, pace) });
    });
  }

  /** Pour un voyage : quelle rando de la bibliothèque correspond à chacune des siennes. */
  async links(slug: string): Promise<LibraryLinks> {
    const hikes = await this.list();
    const files = await this.trips.hikeFiles(slug);
    return Object.fromEntries(
      files.flatMap(({ hike, bytes }) => {
        const gpxHash = hashOf(bytes);
        const known = hikes.find((candidate) => candidate.gpxHash === gpxHash);
        return known ? [[hike.id, known.id]] : [];
      }),
    );
  }
}
