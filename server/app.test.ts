import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import {
  type Activity,
  type ActivityPreview,
  DEFAULT_SETTINGS,
  type Hike,
  type LibraryHike,
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
    dir = await mkdtemp(path.join(tmpdir(), 'itinera-'));
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

  it('ajoute un GPX importé à la bibliothèque et le copie dans un autre voyage', async () => {
    const first = await createTrip();
    const second = await createTrip({ ...newTrip, name: 'Second' });
    const body = new FormData();
    const gpx = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Col</name><trkseg>
<trkpt lat="44.70" lon="5.90"><ele>1400</ele></trkpt>
<trkpt lat="44.71" lon="5.91"><ele>1500</ele></trkpt>
</trkseg></trk></gpx>`;
    body.set('file', new File([gpx], 'col.gpx'));
    const imported = await request(`/api/trips/${first.slug}/gpx`, { method: 'POST', body });
    expect(imported.status).toBe(201);

    const [entry] = (await (await request('/api/library')).json()) as LibraryHike[];
    expect(entry?.name).toBe('Col');

    const copied = await post(`/api/trips/${second.slug}/library-hikes`, { id: entry!.id });
    expect(copied.status).toBe(201);
    const hike = (await copied.json()) as Hike;
    expect(hike).not.toHaveProperty('outings');
    expect(await readFile(path.join(dir, second.slug, hike.gpxFile), 'utf8')).toBe(gpx);

    const missing = await post(`/api/trips/${second.slug}/library-hikes`, { id: 'inconnue' });
    expect(missing.status).toBe(404);
  });

  it('valide les sorties et refuse la bibliothèque depuis un autre site', async () => {
    expect((await post('/api/library/x/outings', { date: 'hier' })).status).toBe(400);
    const foreign = await request('/api/library', { headers: { host: 'evil.example' } });
    expect(foreign.status).toBe(403);
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
    const local = await request('/api/trips', { headers: { origin: 'http://127.0.0.1:5175' } });
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

  it('conserve les bornes favorites dans les réglages', async () => {
    const favoriteStations = [
      {
        id: 'FR1',
        name: 'Borne',
        address: '',
        operator: '',
        network: null,
        location: { lat: 45, lng: 6 },
        maxPowerKw: 0,
        points: 0,
        connectors: [],
        hours: null,
        url: 'https://maps.app.goo.gl/x',
      },
    ];
    await request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_SETTINGS, favoriteStations }),
    });
    expect(await (await request('/api/settings')).json()).toMatchObject({ favoriteStations });
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
  describe('activités enregistrées', () => {
    const recording = recordedGpx([northboundPoints(20), northboundPoints(5, { lat: 45.1 })]);
    const sameOuting = recordedGpx([
      northboundPoints(20, { start: '2026-07-01T06:01:00Z', lng: 6.0002 }),
      northboundPoints(5, { lat: 45.1, start: '2026-07-01T06:01:00Z', lng: 6.0002 }),
    ]);

    const upload = (route: string, content: string, fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.set('file', new File([content], 'sortie.gpx'));
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return request(route, { method: 'POST', body: form });
    };

    it('prévisualise sans enregistrer, puis importe sur confirmation', async () => {
      const previewResponse = await upload('/api/activities/preview', recording);
      expect(previewResponse.status).toBe(200);
      const preview = (await previewResponse.json()) as ActivityPreview;
      expect(preview.duplicate).toEqual({ status: 'none' });
      expect(preview.draft).toMatchObject({ source: 'alltrails', segmentCount: 2 });
      expect(await (await request('/api/activities')).json()).toEqual([]);

      const created = await upload('/api/activities', recording, { title: 'Col' });
      expect(created.status).toBe(201);
      const activity = (await created.json()) as Activity;
      expect(activity.title).toBe('Col');
      expect(activity.distanceMeters).toBe(preview.draft.distanceMeters);
      expect(await (await request('/api/activities')).json()).toEqual([activity]);
      expect(await (await request(`/api/activities/${activity.id}`)).json()).toEqual(activity);
      expect(
        await readFile(path.join(dir, '.activities', activity.originalFile), 'utf8'),
      ).toBe(recording);
    });

    it('renvoie la trace complète, segment par segment', async () => {
      const activity = (await (await upload('/api/activities', recording)).json()) as Activity;
      const feature = await (await request(`/api/activities/${activity.id}/track`)).json();
      expect(feature.geometry.type).toBe('MultiLineString');
      expect(feature.geometry.coordinates.map((line: unknown[]) => line.length)).toEqual([20, 5]);
      expect((await request('/api/activities/inconnue/track')).status).toBe(404);
      expect((await request('/api/activities/inconnue')).status).toBe(404);
    });

    it('bloque un doublon exact et exige un choix pour un doublon probable', async () => {
      const first = (await (await upload('/api/activities', recording)).json()) as Activity;

      const exact = await upload('/api/activities', recording);
      expect(exact.status).toBe(409);
      expect(await exact.json()).toMatchObject({
        duplicate: { status: 'exact', activityId: first.id },
      });

      const probable = await upload('/api/activities', sameOuting);
      expect(probable.status).toBe(409);
      expect(await probable.json()).toMatchObject({ duplicate: { status: 'probable' } });
      const confirmed = await upload('/api/activities', sameOuting, {
        confirmProbableDuplicate: 'true',
      });
      expect(confirmed.status).toBe(201);
      expect(await (await request('/api/activities')).json()).toHaveLength(2);
    });

    it('refuse un GPX invalide, une DTD et un fichier trop gros', async () => {
      expect((await upload('/api/activities/preview', 'pas du xml')).status).toBe(400);
      const withDoctype = recording.replace('<gpx ', '<!DOCTYPE gpx>\n<gpx ');
      const refused = await upload('/api/activities', withDoctype);
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toContain('DOCTYPE');
      const huge = recording.replace('</gpx>', `<!--${'x'.repeat(11 * 1024 * 1024)}--></gpx>`);
      expect((await upload('/api/activities', huge)).status).toBe(413);
      const { slug } = await createTrip();
      expect((await uploadGpx(slug, huge)).status).toBe(413);
      expect(await (await request('/api/activities')).json()).toEqual([]);
    });
  });
  describe('synchronisation par dossier', () => {
    const putSettings = async (changes: Partial<Settings>) => {
      const current = (await (await request('/api/settings')).json()) as Settings;
      return request('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...current, ...changes }),
      });
    };

    it('refuse un dossier relatif et ne lit rien sans dossier réglé', async () => {
      expect((await putSettings({ activityImportFolder: 'exports' })).status).toBe(400);
      const response = await request('/api/activities/sync', { method: 'POST' });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Aucun dossier de synchronisation réglé');
      expect(await (await request('/api/activities/sync')).json()).toEqual({
        folder: null,
        running: false,
        autoSync: false,
        lastRun: null,
        lastError: null,
        pending: [],
      });
    });

    it('importe les GPX du dossier et rend compte du passage', async () => {
      const folder = path.join(dir, 'exports');
      await mkdir(folder);
      const file = path.join(folder, 'sortie.gpx');
      await writeFile(file, recordedGpx([northboundPoints(20)]));
      const past = new Date(Date.now() - 60_000);
      await utimes(file, past, past);
      expect((await putSettings({ activityImportFolder: folder })).status).toBe(200);

      const response = await request('/api/activities/sync', { method: 'POST' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ folder, imported: ['sortie.gpx'], failed: [] });
      expect(await (await request('/api/activities')).json()).toHaveLength(1);
      expect(await (await request('/api/activities/sync')).json()).toMatchObject({
        folder,
        lastRun: { imported: ['sortie.gpx'] },
      });

      const unknown = await post('/api/activities/sync/decisions', {
        hash: 'a'.repeat(64),
        action: 'import',
      });
      expect(unknown.status).toBe(400);
      expect((await post('/api/activities/sync/decisions', { hash: 'x', action: 'import' })).status).toBe(400);
    });
  });
  describe('lien vers une rando prévue', () => {
    const put = (route: string, body: unknown) =>
      request(route, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('lie une sortie à une rando de la bibliothèque, la propose, et refuse une rando inconnue', async () => {
      // La rando prévue et la sortie suivent la même trace.
      const trace = recordedGpx([northboundPoints(30)], { name: 'Col du Festre' });
      const { slug } = await createTrip();
      await uploadGpx(slug, trace);
      const [route] = (await (await request('/api/library')).json()) as LibraryHike[];
      const form = new FormData();
      form.set('file', new File([trace.replace('Col du Festre', 'Sortie au col')], 'sortie.gpx'));
      const activity = (await (
        await request('/api/activities', { method: 'POST', body: form })
      ).json()) as Activity;

      const suggestions = await (
        await request(`/api/activities/${activity.id}/route-suggestions`)
      ).json();
      expect(suggestions).toMatchObject([{ routeId: route!.id }]);

      expect((await put(`/api/activities/${activity.id}/link`, { routeId: 'x' })).status).toBe(400);
      const unknown = await put(`/api/activities/${activity.id}/link`, {
        routeId: crypto.randomUUID(),
      });
      expect(unknown.status).toBe(400);
      expect((await unknown.json()).error).toContain('introuvable');

      const linked = await put(`/api/activities/${activity.id}/link`, { routeId: route!.id });
      expect(await linked.json()).toMatchObject({ id: activity.id, linkedRouteId: route!.id });
      expect(
        await (await request(`/api/activities/${activity.id}/route-suggestions`)).json(),
      ).toEqual([]);

      const unlinked = await put(`/api/activities/${activity.id}/link`, { routeId: null });
      expect(await unlinked.json()).toEqual(activity);
      expect((await put(`/api/activities/${crypto.randomUUID()}/link`, { routeId: null })).status).toBe(404);
    });
  });
});
