/**
 * Page de revue de la phase 0 (benchmark B2) : `npm run catalog:review`, puis
 * http://127.0.0.1:5176. Pour chaque origine, les 20 meilleures boucles du
 * catalogue ; chaque avis est enregistré dans `data/ratings.json`.
 */
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';
import { CATALOG_PATH, ORIGINS, RATINGS_PATH } from '../config';
import { candidatesFor, type Verdict } from '../lib/candidates';
import { openCatalog } from '../lib/duck';

const PORT = 5176;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MAPLIBRE_DIR = path.join(HERE, '..', '..', 'node_modules', 'maplibre-gl', 'dist');
const MIME: Record<string, string> = { '.mjs': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const db = await openCatalog(CATALOG_PATH, true);

const VerdictInput = z.object({
  originId: z.enum(ORIGINS.map((o) => o.id) as [string, ...string[]]),
  trailId: z.string().regex(/^(osm-rel-\d+|gen-\d+)$/),
  verdict: z.enum(['yes', 'no']).nullable(),
  reason: z.string().max(200).optional(),
});

async function readRatings(): Promise<Verdict[]> {
  return existsSync(RATINGS_PATH) ? (JSON.parse(await readFile(RATINGS_PATH, 'utf8')) as Verdict[]) : [];
}

async function writeRatings(ratings: Verdict[]): Promise<void> {
  const tmp = `${RATINGS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(ratings, null, 2));
  await rename(tmp, RATINGS_PATH);
}

const app = new Hono();

app.get('/', async (c) => c.html(await readFile(path.join(HERE, 'index.html'), 'utf8')));

app.get('/lib/:file', async (c) => {
  const file = c.req.param('file');
  const type = MIME[path.extname(file)];
  if (!type || file.includes('/') || file.includes('..')) return c.notFound();
  const full = path.join(MAPLIBRE_DIR, file);
  if (!existsSync(full)) return c.notFound();
  return c.body(await readFile(full), 200, { 'Content-Type': type });
});

app.get('/api/review', async (c) => {
  const origins = [];
  for (const origin of ORIGINS) {
    const candidates = await candidatesFor(db, origin, 20);
    origins.push({ ...origin, candidates: candidates.map((t) => ({ ...t, geojson: JSON.parse(t.geojson) as unknown })) });
  }
  return c.json({ origins, ratings: await readRatings() });
});

app.put('/api/ratings', async (c) => {
  const parsed = VerdictInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Avis invalide' }, 400);
  const { originId, trailId, verdict, reason } = parsed.data;
  const ratings = (await readRatings()).filter((r) => !(r.originId === originId && r.trailId === trailId));
  if (verdict) ratings.push({ originId, trailId, verdict, ...(reason ? { reason } : {}), at: new Date().toISOString() });
  await writeRatings(ratings);
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, ({ address, port }) => {
  console.log(`Revue du catalogue : http://${address}:${port}`);
});
