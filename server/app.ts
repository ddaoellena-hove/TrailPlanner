import path from 'node:path';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  type Health,
  NewTripSchema,
  NotionExportRequestSchema,
  SettingsSchema,
  SlugSchema,
  TripSchema,
} from '../shared/schema';
import { computeAlerts } from '../shared/alerts';
import { describeTrip } from '../shared/assistant-context';
import { buildCarnet, carnetOutcome, carnetToMarkdown } from '../shared/carnet';
import { plannedStops } from '../shared/itinerary';
import { ConversationStore, runAssistantTurn } from './assistant';
import type { AssistantProvider } from './assistant-provider';
import { findStations } from './charging';
import { findPois } from './poi';
import { tripWeather } from './weather';
import { geocode } from './geocode';
import { GpxError, parseGpx } from './gpx';
import { MapLinkError, resolveMapLink } from './map-link';
import { NotionExportError, type NotionExporter } from './notion';
import { computeItinerary } from './routing';
import { SettingsStore } from './settings-store';
import { TripNotFoundError, TripStore } from './trip-store';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function isLocal(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

function isLocalOrigin(origin: string): boolean {
  return URL.canParse(origin) && isLocal(new URL(origin).hostname);
}

type AppOptions = {
  tripsDir: string;
  settingsFile?: string;
  health: () => Promise<Health> | Health;
  orsApiKey?: string;
  openChargeMapKey?: string;
  notion?: NotionExporter;
  assistants?: AssistantProvider[];
};

export function createApp({
  tripsDir,
  settingsFile,
  health,
  orsApiKey,
  openChargeMapKey,
  notion,
  assistants = [],
}: AppOptions) {
  const store = new TripStore(tripsDir);
  const settings = new SettingsStore(settingsFile ?? path.join(tripsDir, 'settings.json'));
  const app = new Hono();

  // Écouter sur 127.0.0.1 ne suffit pas : un site ouvert dans le navigateur peut viser
  // cette adresse (requête cross-site ou DNS rebinding).
  app.use('/api/*', async (c, next) => {
    const hostname = c.req.header('host')?.replace(/:\d+$/, '');
    const origin = c.req.header('origin');
    if (!hostname || !isLocal(hostname) || (origin && !isLocalOrigin(origin))) {
      return c.json({ error: 'Requête non locale refusée' }, 403);
    }
    await next();
  });

  // Le slug devient un chemin disque : il est validé ici pour toutes les routes d'un voyage.
  app.use('/api/trips/:slug/*', async (c, next) => {
    if (!SlugSchema.safeParse(c.req.param('slug')).success) {
      return c.json({ error: 'Voyage introuvable' }, 404);
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof TripNotFoundError) return c.json({ error: 'Voyage introuvable' }, 404);
    if (error instanceof GpxError) return c.json({ error: error.message }, 400);
    if (error instanceof MapLinkError) return c.json({ error: error.message }, 400);
    if (error instanceof NotionExportError) return c.json({ error: error.message }, 502);
    console.error(error);
    return c.json({ error: 'Erreur interne du serveur' }, 500);
  });

  app.get('/api/health', async (c) => c.json(await health()));

  app.get('/api/settings', async (c) => c.json(await settings.read()));

  app.put('/api/settings', async (c) => {
    const body = SettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Réglages invalides' }, 400);
    const { pace } = await settings.read();
    await settings.write(body.data);
    // Réécrire tous les voyages n'a de sens que si le rythme change, pas pour une couche.
    if (JSON.stringify(pace) !== JSON.stringify(body.data.pace)) {
      await store.applyPace(body.data.pace);
    }
    return c.json(body.data);
  });

  app.get('/api/geocode', async (c) => {
    try {
      return c.json(await geocode(c.req.query('q') ?? ''));
    } catch (error) {
      console.warn('Géocodage indisponible :', error);
      return c.json({ error: "Recherche d'adresse indisponible" }, 502);
    }
  });

  app.post('/api/map-link', async (c) => {
    const body = z.object({ url: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Lien manquant' }, 400);
    return c.json(await resolveMapLink(body.data.url));
  });

  app.get('/api/trips', async (c) => c.json(await store.list()));

  app.post('/api/trips', async (c) => {
    const body = NewTripSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message }, 400);
    return c.json(await store.create(body.data), 201);
  });

  app.get('/api/trips/:slug', async (c) => {
    return c.json(await store.get(c.req.param('slug')));
  });

  app.put('/api/trips/:slug', async (c) => {
    const body = TripSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message }, 400);
    if (body.data.slug !== c.req.param('slug')) {
      return c.json({ error: "Le slug ne correspond pas à l'URL" }, 400);
    }
    return c.json(await store.save(body.data));
  });

  app.delete('/api/trips/:slug', async (c) => {
    await store.trash(c.req.param('slug'));
    return c.body(null, 204);
  });

  app.post('/api/trips/:slug/gpx', async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Fichier GPX manquant' }, 400);
    const fields = z
      .object({
        name: z.string().trim().optional(),
        alltrailsUrl: z.union([z.literal(''), z.httpUrl()]).optional(),
      })
      .safeParse({ name: body.name, alltrailsUrl: body.alltrailsUrl });
    if (!fields.success) return c.json({ error: 'Lien AllTrails invalide' }, 400);
    const hike = await store.importGpx(c.req.param('slug'), {
      pace: (await settings.read()).pace,
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      ...fields.data,
    });
    return c.json(hike, 201);
  });

  app.get('/api/trips/:slug/gpx/:hikeId', async (c) => {
    const xml = await store.readGpx(c.req.param('slug'), c.req.param('hikeId'));
    if (xml === null) return c.json({ error: 'Rando introuvable' }, 404);
    const { name, coordinates } = parseGpx(xml, DEFAULT_SETTINGS.pace);
    return c.json({
      type: 'Feature',
      properties: { name },
      geometry: { type: 'LineString', coordinates },
    });
  });

  app.post('/api/trips/:slug/itinerary', async (c) => {
    const refresh = c.req.query('refresh') === '1';
    return c.json(await computeItinerary(store, c.req.param('slug'), orsApiKey, { refresh }));
  });

  app.get('/api/trips/:slug/charging', async (c) => {
    const slug = c.req.param('slug');
    const minKw = Number(c.req.query('minKw') ?? 0);
    if (!Number.isFinite(minKw) || minKw < 0) return c.json({ error: 'Puissance invalide' }, 400);
    const trip = await store.get(slug);
    const { legs } = await computeItinerary(store, slug, orsApiKey);
    const lines = legs.map((leg) => leg.geometry.coordinates);
    const stops = plannedStops(trip).map(({ location }) => location);
    try {
      return c.json(await findStations(lines, stops, minKw, openChargeMapKey));
    } catch (error) {
      console.warn('Bornes indisponibles :', error);
      return c.json({ error: 'Service des bornes indisponible' }, 502);
    }
  });

  app.get('/api/trips/:slug/weather', async (c) => {
    const trip = await store.get(c.req.param('slug'));
    return c.json(await tripWeather(trip, new Date().toISOString().slice(0, 10)));
  });

  app.get('/api/trips/:slug/poi', async (c) => {
    const trip = await store.get(c.req.param('slug'));
    try {
      return c.json(await findPois(store, trip));
    } catch (error) {
      console.warn('Points utiles indisponibles :', error);
      return c.json({ error: 'OpenStreetMap est saturé pour le moment, réessayez plus tard' }, 502);
    }
  });

  app.post('/api/trips/:slug/duplicate', async (c) => {
    return c.json(await store.duplicate(c.req.param('slug')), 201);
  });

  const conversations = new ConversationStore();

  app.post('/api/trips/:slug/assistant', async (c) => {
    const current = await settings.read();
    const provider =
      assistants.find(({ id }) => id === current.assistantProvider) ?? assistants[0];
    if (!provider) {
      return c.json({ error: 'Assistant désactivé : renseignez une clé dans .env' }, 503);
    }
    const body = z
      .object({ conversationId: z.string().min(1), message: z.string().trim().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Demande invalide' }, 400);

    const slug = c.req.param('slug');
    const trip = await store.get(slug);
    const { legs } = await computeItinerary(store, slug, orsApiKey);
    const today = new Date().toISOString().slice(0, 10);
    const context = describeTrip(
      trip,
      legs,
      computeAlerts(trip, legs, current),
      current,
      await tripWeather(trip, today),
    );
    const turn = runAssistantTurn({
      provider,
      conversation: conversations.get(body.data.conversationId, provider),
      trip,
      context,
      message: body.data.message,
      routeCache: await store.readRouteCache(slug),
      settings: current,
    });
    c.header('content-type', 'application/x-ndjson');
    return stream(c, async (output) => {
      for await (const event of turn) await output.writeln(JSON.stringify(event));
    });
  });

  const NOTION_MISSING = 'Export désactivé : renseignez NOTION_TOKEN dans .env';

  const buildExport = async (slug: string) => {
    const trip = await store.get(slug);
    const { legs } = await computeItinerary(store, slug, orsApiKey);
    const current = await settings.read();
    const alerts = computeAlerts(trip, legs, current);
    const blocks = buildCarnet(trip, legs, alerts, new Date(), current.dayStartTime);
    return { trip, blocks, outcome: carnetOutcome(trip) };
  };

  app.post('/api/trips/:slug/notion/preview', async (c) => {
    const { blocks, outcome } = await buildExport(c.req.param('slug'));
    return c.json({ markdown: carnetToMarkdown(blocks), outcome });
  });

  app.post('/api/trips/:slug/notion/export', async (c) => {
    if (!notion) return c.json({ error: NOTION_MISSING }, 503);
    const body = NotionExportRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Demande invalide' }, 400);
    const { trip, blocks, outcome } = await buildExport(c.req.param('slug'));
    const ids = await notion.export(trip, body.data, blocks, outcome);
    const lastExportAt = new Date().toISOString();
    return c.json(await store.setNotion(trip.slug, { ...ids, lastExportAt }));
  });

  app.get('/api/notion/projects', async (c) => {
    if (!notion) return c.json({ error: NOTION_MISSING }, 503);
    return c.json(await notion.searchProjects(c.req.query('q') ?? ''));
  });

  return app;
}
