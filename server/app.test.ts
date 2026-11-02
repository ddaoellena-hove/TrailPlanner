import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Hike,
  type NewTrip,
  type NotionPreview,
  type Settings,
  type Trip,
  type TripSummary,
} from '../shared/schema';
import { createApp } from './app';
import type { AssistantProvider } from './assistant-provider';

const newTrip: NewTrip = {
  name: 'Dévoluy & Champsaur',
  startDate: '2027-07-01',
  endDate: '2027-07-05',
  withDog: true,
};

const baseUrl = 'http://127.0.0.1:5174';

describe('API voyages', () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  const request = (route: string, init: RequestInit = {}) =>
    app.request(`${baseUrl}${route}`, {
      ...init,
      headers: { host: '127.0.0.1:5174', ...init.headers },
    });

  const post = (route: string, body: unknown) =>
    request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const createTrip = async (input = newTrip) => (await (await post('/api/trips', input)).json()) as Trip;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'trailplanner-'));
    app = createApp({ tripsDir: dir, health: () => ({ ors: 'missing', notion: 'missing', assistant: 'missing', assistantProviders: [] }) });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('crée un voyage et le relit depuis le disque', async () => {
    const response = await post('/api/trips', newTrip);
    expect(response.status).toBe(201);
    const created = (await response.json()) as Trip;

    expect(created.slug).toBe('devoluy-champsaur');
    expect(created.days).toHaveLength(5);
    expect(created.origin).toBeUndefined();

    // Une nouvelle instance simule le redémarrage du serveur.
    app = createApp({ tripsDir: dir, health: () => ({ ors: 'missing', notion: 'missing', assistant: 'missing', assistantProviders: [] }) });
    expect(await (await request(`/api/trips/${created.slug}`)).json()).toEqual(created);
  });

  it('écrit un trip.json indenté, sans fichier temporaire résiduel', async () => {
    const { slug } = await createTrip();
    const content = await readFile(path.join(dir, slug, 'trip.json'), 'utf8');
    expect(content.startsWith('{\n  "schemaVersion": 1,\n  "id"')).toBe(true);
    expect(await readdir(path.join(dir, slug))).toEqual(['trip.json']);
  });

  it('attribue un slug distinct aux homonymes', async () => {
    await createTrip();
    expect((await createTrip()).slug).toBe('devoluy-champsaur-2');
  });

  it('refuse une création invalide', async () => {
    const response = await post('/api/trips', { ...newTrip, endDate: '2027-06-01' });
    expect(response.status).toBe(400);
    expect(await readdir(dir)).toEqual([]);
  });

  it('sauvegarde et met à jour updatedAt', async () => {
    const trip = await createTrip();
    const response = await request(`/api/trips/${trip.slug}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...trip, name: 'Nouveau nom', updatedAt: '2000-01-01T00:00:00.000Z' }),
    });
    const saved = (await response.json()) as Trip;
    expect(saved.name).toBe('Nouveau nom');
    expect(saved.updatedAt > '2000-01-01').toBe(true);
  });

  it('refuse une sauvegarde dont le slug diffère de l’URL', async () => {
    const trip = await createTrip();
    const response = await request('/api/trips/autre', {
      method: 'PUT',
      body: JSON.stringify(trip),
    });
    expect(response.status).toBe(400);
  });

  it('liste les résumés et ignore un voyage illisible', async () => {
    const { slug } = await createTrip();
    await createTrip({ ...newTrip, name: 'Cassé' });
    await writeFile(path.join(dir, 'casse', 'trip.json'), '{');

    const summaries = (await (await request('/api/trips')).json()) as TripSummary[];

    expect(summaries.map((summary) => summary.slug)).toEqual([slug]);
    expect(summaries[0]?.dayCount).toBe(5);
  });

  it('déplace un voyage supprimé dans .trash', async () => {
    const { slug } = await createTrip();
    expect((await request(`/api/trips/${slug}`, { method: 'DELETE' })).status).toBe(204);

    expect((await request(`/api/trips/${slug}`)).status).toBe(404);
    expect(await (await request('/api/trips')).json()).toEqual([]);
    const trashed = await readdir(path.join(dir, '.trash'));
    expect(trashed[0]?.startsWith(`${slug}-`)).toBe(true);
  });

  it('duplique sans reprendre le lien Notion', async () => {
    const trip = await createTrip();
    await writeFile(path.join(dir, trip.slug, 'marker.gpx'), '<gpx/>');
    await writeFile(
      path.join(dir, trip.slug, 'trip.json'),
      JSON.stringify({ ...trip, notion: { projectPageId: 'abc' } }),
    );

    const copy = (await (await post(`/api/trips/${trip.slug}/duplicate`, {})).json()) as Trip;

    expect(copy.name).toBe('Dévoluy & Champsaur (copie)');
    expect(copy.slug).toBe('devoluy-champsaur-copie');
    expect(copy.id).not.toBe(trip.id);
    expect(copy.notion).toBeUndefined();
    expect(await readdir(path.join(dir, copy.slug))).toContain('marker.gpx');
  });

  it('renvoie 404 pour un voyage inconnu ou un slug hostile', async () => {
    expect((await request('/api/trips/inconnu')).status).toBe(404);
    expect((await post('/api/trips/inconnu/duplicate', {})).status).toBe(404);
  });

  it('bloque la traversée de chemin vers un voyage existant', async () => {
    const { slug } = await createTrip();
    const hostile = `..%2F${path.basename(dir)}%2F${slug}`;

    expect((await request(`/api/trips/${hostile}`)).status).toBe(404);
    expect((await request(`/api/trips/${hostile}`, { method: 'DELETE' })).status).toBe(404);
    expect((await request(`/api/trips/${slug}`)).status).toBe(200);
  });

  it('refuse les requêtes venant d’un autre site', async () => {
    const crossSite = await request('/api/trips', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify(newTrip),
    });
    expect(crossSite.status).toBe(403);
    const rebound = await request('/api/trips', { headers: { host: 'evil.example:5174' } });
    expect(rebound.status).toBe(403);
    const local = await request('/api/trips', { headers: { origin: 'http://127.0.0.1:5173' } });
    expect(local.status).toBe(200);
  });

  const uploadGpx = (slug: string, content: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set('file', new File([content], 'col-du-festre.gpx'));
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return request(`/api/trips/${slug}/gpx`, { method: 'POST', body: form });
  };

  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Col du Festre</name><trkseg>
<trkpt lat="44.70" lon="5.90"><ele>1400</ele></trkpt>
<trkpt lat="44.71" lon="5.90"><ele>1500</ele></trkpt>
<trkpt lat="44.72" lon="5.90"><ele>1600</ele></trkpt>
</trkseg></trk></gpx>`;

  it('importe un GPX sans le modifier', async () => {
    const { slug } = await createTrip();
    const response = await uploadGpx(slug, gpx, {
      alltrailsUrl: 'https://www.alltrails.com/fr/randonnee/france/col',
    });
    expect(response.status).toBe(201);
    const hike = (await response.json()) as Hike;

    expect(hike.name).toBe('Col du Festre');
    expect(hike.alltrailsUrl).toContain('alltrails.com');
    expect(hike.start).toEqual({ lat: 44.7, lng: 5.9 });
    expect(hike.kind).toBe('point-to-point');
    expect(await readFile(path.join(dir, slug, hike.gpxFile), 'utf8')).toBe(gpx);
  });

  it('renvoie la trace d’une rando en GeoJSON', async () => {
    const { slug } = await createTrip();
    const hike = (await (await uploadGpx(slug, gpx)).json()) as Hike;
    const trip = (await (await request(`/api/trips/${slug}`)).json()) as Trip;
    await request(`/api/trips/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ ...trip, hikes: [hike] }),
    });

    const feature = await (await request(`/api/trips/${slug}/gpx/${hike.id}`)).json();

    expect(feature.geometry.coordinates).toHaveLength(3);
    expect((await request(`/api/trips/${slug}/gpx/inconnue`)).status).toBe(404);
  });

  it('lit les réglages par défaut, les enregistre et recalcule les durées', async () => {
    const { slug } = await createTrip();
    const hike = (await (await uploadGpx(slug, gpx)).json()) as Hike;
    const trip = (await (await request(`/api/trips/${slug}`)).json()) as Trip;
    await request(`/api/trips/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ ...trip, hikes: [hike] }),
    });

    const defaults = (await (await request('/api/settings')).json()) as Settings;
    expect(defaults).toEqual(DEFAULT_SETTINGS);

    const slower = { ...defaults, pace: { ...defaults.pace, breakFactor: 2 } };
    const saved = await request('/api/settings', { method: 'PUT', body: JSON.stringify(slower) });
    expect(saved.status).toBe(200);

    expect(await (await request('/api/settings')).json()).toEqual(slower);
    const updated = (await (await request(`/api/trips/${slug}`)).json()) as Trip;
    expect(updated.hikes[0]!.stats.estimatedDurationMin).toBeGreaterThan(
      hike.stats.estimatedDurationMin,
    );
  });

  it('ne réécrit pas les voyages pour un réglage de carte', async () => {
    const { slug } = await createTrip();
    const file = path.join(dir, slug, 'trip.json');
    await writeFile(file, `${await readFile(file, 'utf8')}\n`);
    const before = await readFile(file, 'utf8');

    const response = await request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_SETTINGS, mapOverlays: ['relief'], mapBaseOpacity: 0.5 }),
    });

    expect(response.status).toBe(200);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await (await request('/api/settings')).json()).toMatchObject({
      mapOverlays: ['relief'],
      mapBaseOpacity: 0.5,
    });
  });

  it('refuse des réglages invalides', async () => {
    const response = await request('/api/settings', { method: 'PUT', body: '{"pace":{}}' });
    expect(response.status).toBe(400);
  });

  it('refuse un fichier qui n’est pas un GPX ou un lien non http', async () => {
    const { slug } = await createTrip();
    expect((await uploadGpx(slug, 'pas du xml')).status).toBe(400);
    expect((await uploadGpx(slug, '<gpx></gpx>')).status).toBe(400);
    const hostile = await uploadGpx(slug, gpx, { alltrailsUrl: 'javascript:alert(1)' });
    expect(hostile.status).toBe(400);
  });

  it('garde le lien Notion quand une sauvegarde ne le porte pas', async () => {
    const trip = await createTrip();
    await writeFile(
      path.join(dir, trip.slug, 'trip.json'),
      JSON.stringify({ ...trip, notion: { projectPageId: 'abc' } }),
    );
    const saved = await request(`/api/trips/${trip.slug}`, {
      method: 'PUT',
      body: JSON.stringify(trip),
    });
    expect(((await saved.json()) as Trip).notion).toEqual({ projectPageId: 'abc' });
  });

  it('explique que l’assistant est désactivé sans clé', async () => {
    const { slug } = await createTrip();
    const response = await post(`/api/trips/${slug}/assistant`, {
      conversationId: 'c',
      message: 'bonjour',
    });
    expect(response.status).toBe(503);
  });

  it('diffuse un tour de l’assistant, ligne par ligne', async () => {
    const fake = (reply: string): AssistantProvider => ({
      id: reply === 'Claude' ? 'anthropic' : 'openai',
      describeError: () => 'panne',
      start: () => ({
        addUserMessage: () => {},
        addToolResults: () => {},
        async *complete() {
          yield reply;
          return {
            stop: 'end' as const,
            toolCalls: [],
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: null },
          };
        },
      }),
    });
    app = createApp({
      tripsDir: dir,
      assistants: [fake('Claude'), fake('ChatGPT')],
      health: () => ({
        ors: 'missing',
        notion: 'missing',
        assistant: 'configured',
        assistantProviders: ['anthropic', 'openai'],
      }),
    });
    const { slug } = await createTrip();

    const response = await post(`/api/trips/${slug}/assistant`, {
      conversationId: 'c',
      message: 'bonjour',
    });

    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map(({ type }) => type)).toEqual(['text', 'done']);
    expect(lines[0].text).toBe('Claude');

    await request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_SETTINGS, assistantProvider: 'openai' }),
    });
    const switched = await post(`/api/trips/${slug}/assistant`, {
      conversationId: 'c',
      message: 'bonjour',
    });
    expect(await switched.text()).toContain('ChatGPT');
    expect((await post(`/api/trips/${slug}/assistant`, { message: '' })).status).toBe(400);
  });

  it('prévisualise le carnet, et refuse d’exporter sans token', async () => {
    const { slug } = await createTrip();
    const preview = await post(`/api/trips/${slug}/notion/preview`, {});
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as NotionPreview).outcome).toContain('5 jours / 4 nuits');

    const exported = await post(`/api/trips/${slug}/notion/export`, { mode: 'create' });
    expect(exported.status).toBe(503);
    expect((await request('/api/notion/projects?q=x')).status).toBe(503);
  });

  it('expose l’état des clés', async () => {
    expect(await (await request('/api/health')).json()).toEqual({
      ors: 'missing',
      notion: 'missing',
      assistant: 'missing',
      assistantProviders: [],
    });
  });
});
