import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { withPace } from '../shared/gpx';
import {
  DriveLegSchema,
  HikeSchema,
  PoiSchema,
  TripSchema,
  type DriveLeg,
  type Hike,
  type NewTrip,
  type Poi,
  type Settings,
  type Trip,
  type TripSummary,
} from '../shared/schema';
import { generateDays, slugify, summarizeTrip } from '../shared/trip';
import { UserDb } from './db';
import { writeAtomic } from './fs-atomic';
import { parseGpx } from './gpx';

export { writeAtomic };

export class TripNotFoundError extends Error {}

export type RouteCache = Record<string, DriveLeg>;
const RouteCacheSchema = z.record(z.string(), DriveLegSchema);

const PoiCacheSchema = z.object({ key: z.string(), at: z.number(), pois: z.array(PoiSchema) });
type PoiCache = { key: string; at: number; pois: Poi[] };

type GpxUpload = {
  pace: Settings['pace'];
  bytes: Buffer;
  fileName: string;
  name?: string;
  alltrailsUrl?: string;
};

/** Stockage des voyages dans SQLite (`itinera.db`) + fichiers GPX immuables sur disque. */
export class TripStore {
  private readonly dir: string;
  private readonly userDb: UserDb;

  constructor(dirOrDb: string | UserDb) {
    if (typeof dirOrDb === 'string') {
      this.dir = dirOrDb;
      this.userDb = new UserDb(dirOrDb);
    } else {
      this.dir = dirOrDb.tripsDir;
      this.userDb = dirOrDb;
    }
  }

  private async writeTrip(trip: Trip): Promise<void> {
    const parsed = TripSchema.parse(trip);
    const data = JSON.stringify(parsed);
    await this.userDb.db
      .insertInto('trips')
      .values({
        slug: parsed.slug,
        id: parsed.id,
        name: parsed.name,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        data,
        created_at: parsed.createdAt,
        updated_at: parsed.updatedAt,
      })
      .onConflict((oc) =>
        oc.column('slug').doUpdateSet({
          name: parsed.name,
          start_date: parsed.startDate,
          end_date: parsed.endDate,
          data,
          updated_at: parsed.updatedAt,
        }),
      )
      .execute();
  }

  private async reserveSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let suffix = 1; ; suffix++) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const existing = await this.userDb.db
        .selectFrom('trips')
        .select('slug')
        .where('slug', '=', slug)
        .executeTakeFirst();
      if (!existing) return slug;
    }
  }

  async list(): Promise<TripSummary[]> {
    await this.userDb.ensureReady();
    const rows = await this.userDb.db
      .selectFrom('trips')
      .select(['slug', 'data'])
      .orderBy('start_date', 'asc')
      .execute();
    const summaries: TripSummary[] = [];
    for (const row of rows) {
      try {
        summaries.push(summarizeTrip(TripSchema.parse(JSON.parse(row.data))));
      } catch (error) {
        console.warn(`Voyage ignoré (${row.slug}) :`, error);
      }
    }
    return summaries.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  /** Applique un nouveau rythme à tous les voyages lisibles. */
  async applyPace(pace: Settings['pace']): Promise<void> {
    await this.userDb.ensureReady();
    const rows = await this.userDb.db.selectFrom('trips').select(['slug', 'data']).execute();
    for (const row of rows) {
      try {
        const trip = TripSchema.parse(JSON.parse(row.data));
        await this.writeTrip(withPace(trip, pace));
      } catch (error) {
        console.warn(`Voyage ignoré (${row.slug}) :`, error);
      }
    }
  }

  /** GPX des randos d'un voyage, ou de tous. Un voyage ou un fichier illisible est ignoré. */
  async hikeFiles(slug?: string): Promise<{ hike: Hike; bytes: Buffer }[]> {
    await this.userDb.ensureReady();
    const query = this.userDb.db.selectFrom('trips').select(['slug', 'data']);
    const rows = slug ? await query.where('slug', '=', slug).execute() : await query.execute();
    const files: { hike: Hike; bytes: Buffer }[] = [];
    for (const row of rows) {
      try {
        const trip = TripSchema.parse(JSON.parse(row.data));
        for (const hike of trip.hikes) {
          const bytes = await readFile(path.join(this.dir, row.slug, hike.gpxFile));
          files.push({ hike, bytes });
        }
      } catch (error) {
        console.warn(`Voyage ignoré (${row.slug}) :`, error);
      }
    }
    return files;
  }

  async readGpx(slug: string, hikeId: string): Promise<string | null> {
    const hike = (await this.get(slug)).hikes.find(({ id }) => id === hikeId);
    return hike ? readFile(path.join(this.dir, slug, hike.gpxFile), 'utf8') : null;
  }

  async get(slug: string): Promise<Trip> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('trips')
      .select('data')
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!row) throw new TripNotFoundError(slug);
    return TripSchema.parse(JSON.parse(row.data));
  }

  async create(input: NewTrip): Promise<Trip> {
    await this.userDb.ensureReady();
    const slug = await this.reserveSlug(input.name);
    const now = new Date().toISOString();
    const trip: Trip = {
      schemaVersion: 1,
      id: randomUUID(),
      slug,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      travelers: {
        withDog: input.withDog,
        ...(input.electricVehicle ? { electricVehicle: true } : {}),
      },
      hikes: [],
      places: [],
      days: generateDays(input.startDate, input.endDate),
      createdAt: now,
      updatedAt: now,
    };
    await this.writeTrip(trip);
    return trip;
  }

  /** Le lien Obsidian n'appartient qu'à l'export : un « annuler » ne doit pas le perdre. */
  async save(trip: Trip): Promise<Trip> {
    const { obsidian, notion } = await this.get(trip.slug);
    const saved = { ...trip, obsidian, notion, updatedAt: new Date().toISOString() };
    await this.writeTrip(saved);
    return saved;
  }

  /** Conserve le GPX tel quel (dossier du voyage + coffre SHA-256) et renvoie la rando préremplie. */
  async importGpx(slug: string, upload: GpxUpload): Promise<Hike> {
    await this.get(slug);
    const parsed = parseGpx(upload.bytes.toString('utf8'), upload.pace);
    const id = randomUUID();
    const gpxFile = `gpx/${id}.gpx`;
    await writeAtomic(path.join(this.dir, slug, gpxFile), upload.bytes);
    await this.userDb.storeGpxInVault(upload.bytes, upload.fileName);
    const hike: Hike = {
      id,
      name: upload.name || parsed.name || upload.fileName.replace(/\.gpx$/i, ''),
      gpxFile,
      kind: parsed.kind,
      stats: parsed.stats,
      start: parsed.start,
      end: parsed.end,
      dogPolicy: 'unknown',
    };
    return upload.alltrailsUrl ? { ...hike, alltrailsUrl: upload.alltrailsUrl } : hike;
  }

  /** Copie une rando dans un voyage : sa fiche et son GPX, qui ne dépendent plus de la source. */
  async copyHike(slug: string, source: Hike, bytes: Buffer): Promise<Hike> {
    await this.get(slug);
    const id = randomUUID();
    const gpxFile = `gpx/${id}.gpx`;
    await writeAtomic(path.join(this.dir, slug, gpxFile), bytes);
    await this.userDb.storeGpxInVault(bytes, `${source.name}.gpx`);
    return HikeSchema.parse({ ...source, id, gpxFile });
  }

  async setObsidian(slug: string, obsidian: NonNullable<Trip['obsidian']>): Promise<Trip> {
    const saved = { ...(await this.get(slug)), obsidian, updatedAt: new Date().toISOString() };
    await this.writeTrip(saved);
    return saved;
  }

  /** Un cache absent ou illisible se reconstruit : il n'empêche jamais le calcul. */
  async readRouteCache(slug: string): Promise<RouteCache> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('route_cache')
      .select('data')
      .where('trip_slug', '=', slug)
      .executeTakeFirst();
    if (!row) return {};
    try {
      return RouteCacheSchema.parse(JSON.parse(row.data));
    } catch {
      return {};
    }
  }

  async writeRouteCache(slug: string, cache: RouteCache): Promise<void> {
    await this.userDb.ensureReady();
    const data = JSON.stringify(cache);
    const updated_at = new Date().toISOString();
    await this.userDb.db
      .insertInto('route_cache')
      .values({ trip_slug: slug, data, updated_at })
      .onConflict((oc) => oc.column('trip_slug').doUpdateSet({ data, updated_at }))
      .execute();
  }

  async readPoiCache(slug: string): Promise<PoiCache | null> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('poi_cache')
      .select('data')
      .where('trip_slug', '=', slug)
      .executeTakeFirst();
    if (!row) return null;
    try {
      return PoiCacheSchema.parse(JSON.parse(row.data));
    } catch {
      return null;
    }
  }

  async writePoiCache(slug: string, cache: PoiCache): Promise<void> {
    await this.userDb.ensureReady();
    const data = JSON.stringify(cache);
    const updated_at = new Date().toISOString();
    await this.userDb.db
      .insertInto('poi_cache')
      .values({ trip_slug: slug, data, updated_at })
      .onConflict((oc) => oc.column('trip_slug').doUpdateSet({ data, updated_at }))
      .execute();
  }

  /** Copie aussi GPX et caches. Le lien Obsidian n'est pas repris : la copie ne doit pas écraser le carnet de l'original. */
  async duplicate(slug: string): Promise<Trip> {
    const source = await this.get(slug);
    const name = `${source.name} (copie)`;
    const newSlug = await this.reserveSlug(name);
    const sourceDir = path.join(this.dir, slug);
    if (existsSync(sourceDir)) {
      await cp(sourceDir, path.join(this.dir, newSlug), { recursive: true });
    }
    const now = new Date().toISOString();
    const copy: Trip = {
      ...source,
      obsidian: undefined,
      notion: undefined,
      id: randomUUID(),
      slug: newSlug,
      name,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeTrip(copy);
    const routes = await this.readRouteCache(slug);
    if (Object.keys(routes).length > 0) await this.writeRouteCache(newSlug, routes);
    const pois = await this.readPoiCache(slug);
    if (pois) await this.writePoiCache(newSlug, pois);
    return copy;
  }

  /** Déplace les fichiers du voyage et un cliché JSON dans `.trash/` et retire le voyage de SQLite. */
  async trash(slug: string): Promise<void> {
    const trip = await this.get(slug);
    const trashDir = path.join(this.dir, '.trash');
    await mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(trashDir, `${slug}-${stamp}`);
    const sourceDir = path.join(this.dir, slug);
    if (existsSync(sourceDir)) {
      await rename(sourceDir, target);
    } else {
      await mkdir(target, { recursive: true });
    }
    await writeAtomic(path.join(target, 'trip.json'), `${JSON.stringify(trip, null, 2)}\n`);
    await this.userDb.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('trips').where('slug', '=', slug).execute();
      await trx.deleteFrom('route_cache').where('trip_slug', '=', slug).execute();
      await trx.deleteFrom('poi_cache').where('trip_slug', '=', slug).execute();
    });
  }
}
