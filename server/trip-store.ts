import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DriveLeg, Hike, NewTrip, Trip, TripSummary } from '../shared/schema';
import { withPace } from '../shared/gpx';
import { DriveLegSchema, type Settings, TripSchema } from '../shared/schema';
import { parseGpx } from './gpx';
import { generateDays, slugify, summarizeTrip } from '../shared/trip';

export class TripNotFoundError extends Error {}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export async function writeAtomic(target: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}

export type RouteCache = Record<string, DriveLeg>;
const RouteCacheSchema = z.record(z.string(), DriveLegSchema);

type GpxUpload = { pace: Settings['pace']; bytes: Buffer; fileName: string; name?: string; alltrailsUrl?: string };

/** Stockage des voyages sur disque : `<dir>/<slug>/trip.json`. */
export class TripStore {
  constructor(private readonly dir: string) {}

  private tripPath(slug: string): string {
    return path.join(this.dir, slug, 'trip.json');
  }

  private async writeTrip(trip: Trip): Promise<void> {
    // Le passage par zod fixe l'ordre des clés : le fichier reste diffable.
    const content = `${JSON.stringify(TripSchema.parse(trip), null, 2)}\n`;
    await writeAtomic(this.tripPath(trip.slug), content);
  }

  /** Réserve un dossier libre : mkdir échoue si le slug existe déjà. */
  private async reserveSlug(name: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const base = slugify(name);
    for (let suffix = 1; ; suffix++) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      try {
        await mkdir(path.join(this.dir, slug));
        return slug;
      } catch (error) {
        if (!isErrorCode(error, 'EEXIST')) throw error;
      }
    }
  }

  private async slugs(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.dir, { withFileTypes: true });
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  }

  async list(): Promise<TripSummary[]> {
    const trips = await Promise.all(
      (await this.slugs()).map(async (slug) => {
        try {
          return await this.get(slug);
        } catch (error) {
          // Un voyage illisible ne doit pas masquer les autres.
          console.warn(`Voyage ignoré (${slug}) :`, error);
          return null;
        }
      }),
    );
    return trips
      .filter((trip) => trip !== null)
      .map(summarizeTrip)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  /** Applique un nouveau rythme à tous les voyages lisibles. */
  async applyPace(pace: Settings['pace']): Promise<void> {
    for (const slug of await this.slugs()) {
      try {
        await this.writeTrip(withPace(await this.get(slug), pace));
      } catch (error) {
        console.warn(`Voyage ignoré (${slug}) :`, error);
      }
    }
  }

  async readGpx(slug: string, hikeId: string): Promise<string | null> {
    const hike = (await this.get(slug)).hikes.find(({ id }) => id === hikeId);
    return hike ? readFile(path.join(this.dir, slug, hike.gpxFile), 'utf8') : null;
  }

  async get(slug: string): Promise<Trip> {
    let content;
    try {
      content = await readFile(this.tripPath(slug), 'utf8');
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) throw new TripNotFoundError(slug);
      throw error;
    }
    return TripSchema.parse(JSON.parse(content));
  }

  async create(input: NewTrip): Promise<Trip> {
    const slug = await this.reserveSlug(input.name);
    const now = new Date().toISOString();
    const trip: Trip = {
      schemaVersion: 1,
      id: randomUUID(),
      slug,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      travelers: { withDog: input.withDog },
      hikes: [],
      places: [],
      days: generateDays(input.startDate, input.endDate),
      createdAt: now,
      updatedAt: now,
    };
    await this.writeTrip(trip);
    return trip;
  }

  /** Le lien Notion n'appartient qu'à l'export : un « annuler » ne doit pas le perdre. */
  async save(trip: Trip): Promise<Trip> {
    const { notion } = await this.get(trip.slug);
    const saved = { ...trip, notion, updatedAt: new Date().toISOString() };
    await this.writeTrip(saved);
    return saved;
  }

  /** Conserve le GPX tel quel et renvoie la rando préremplie ; le client l'ajoute au voyage. */
  async importGpx(slug: string, upload: GpxUpload): Promise<Hike> {
    await this.get(slug);
    const parsed = parseGpx(upload.bytes.toString('utf8'), upload.pace);
    const id = randomUUID();
    const gpxFile = `gpx/${id}.gpx`;
    await writeAtomic(path.join(this.dir, slug, gpxFile), upload.bytes);
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

  async setNotion(slug: string, notion: NonNullable<Trip['notion']>): Promise<Trip> {
    const saved = { ...(await this.get(slug)), notion, updatedAt: new Date().toISOString() };
    await this.writeTrip(saved);
    return saved;
  }

  private routeCachePath(slug: string): string {
    return path.join(this.dir, slug, 'cache', 'routes.json');
  }

  /** Un cache absent ou illisible se reconstruit : il n'empêche jamais le calcul. */
  async readRouteCache(slug: string): Promise<RouteCache> {
    try {
      const content = await readFile(this.routeCachePath(slug), 'utf8');
      return RouteCacheSchema.parse(JSON.parse(content));
    } catch {
      return {};
    }
  }

  async writeRouteCache(slug: string, cache: RouteCache): Promise<void> {
    await writeAtomic(this.routeCachePath(slug), `${JSON.stringify(cache)}\n`);
  }

  /** Copie aussi GPX et cache. Le lien Notion n'est pas repris : la copie ne doit pas écraser le carnet de l'original. */
  async duplicate(slug: string): Promise<Trip> {
    const source = await this.get(slug);
    const name = `${source.name} (copie)`;
    const newSlug = await this.reserveSlug(name);
    await cp(path.join(this.dir, slug), path.join(this.dir, newSlug), { recursive: true });
    const now = new Date().toISOString();
    const copy: Trip = {
      ...source,
      notion: undefined,
      id: randomUUID(),
      slug: newSlug,
      name,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeTrip(copy);
    return copy;
  }

  async trash(slug: string): Promise<void> {
    await this.get(slug);
    const trashDir = path.join(this.dir, '.trash');
    await mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await rename(path.join(this.dir, slug), path.join(trashDir, `${slug}-${stamp}`));
  }
}
