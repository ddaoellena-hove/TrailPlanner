import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogPlace } from '../shared/escapade';
import {
  AddEscapadeToTripResponseSchema,
  BonusStopSchema,
  EscapadeSchema,
  type SuggestionResult,
} from '../shared/schema';
import { createApp } from './app';
import { DuckDbCatalogSource, type CatalogSource } from './catalog-reader';
import { z } from 'zod';

const baseUrl = 'http://127.0.0.1:5174';
const ROUEN = { lat: 49.4431, lng: 1.0993 };
const TRAIL_START = { lat: 49.5, lng: 1.15 };

const sampleSuggestion: SuggestionResult = {
  trailId: 'osm-rel-77',
  osmRelationId: 77,
  sourceType: 'osm_relation',
  name: 'Boucle des Andelys',
  kind: 'loop',
  distanceMeters: 8600,
  elevationGainMeters: 210,
  elevationLossMeters: 210,
  estimatedDurationMin: 140,
  difficulty: 'moderate',
  pavedRatio: 0.09,
  surfaceUnknownRatio: 0.08,
  dogPolicy: 'leashed',
  inReserve: false,
  start: TRAIL_START,
  estimatedDriveMin: 22,
  geometry: {
    type: 'LineString',
    coordinates: [
      [1.15, 49.5],
      [1.17, 49.515],
      [1.16, 49.525],
      [1.15, 49.5],
    ],
  },
  scores: {
    total: 0.84,
    scenic: 0.82,
    isolation: 0.71,
    heritage: 0.78,
    novelty: 1,
    pavedPenalty: 0.04,
  },
  noveltyStatus: 'new',
  explanation: {
    positives: ['Paysage marqué (forêt, relief ou eau)'],
    tradeoffs: [],
    uncertainties: [],
  },
  provenance: {
    snapshotId: 'normandie-test',
    regionName: 'Normandie',
    sources: ['© OpenStreetMap contributors (ODbL)', 'IGN RGE ALTI'],
    sourceType: 'osm_relation',
    osmRelationId: 77,
  },
};

const fakePlaces: CatalogPlace[] = [
  {
    placeId: 'osm:node:1',
    name: 'Château-Gaillard',
    category: 'heritage',
    location: { lat: 49.485, lng: 1.135 },
    popularity: 0.9,
    attribution: '© OpenStreetMap contributors (ODbL)',
  },
  {
    placeId: 'osm:node:2',
    name: 'Point de vue trop loin',
    category: 'viewpoint',
    location: { lat: 49.8, lng: 1.7 },
    popularity: 0.8,
    attribution: '© OpenStreetMap contributors (ODbL)',
  },
];

describe('API escapades & étapes bonus (V4)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'itinera-escapades-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const makeApp = (catalog?: CatalogSource) =>
    createApp({
      tripsDir: dir,
      catalog,
      health: () => ({
        ors: 'missing',
        obsidian: 'missing',
        assistant: 'missing',
        assistantProviders: [],
      }),
    });

  const fakeCatalog: CatalogSource = {
    async load() {
      return {
        meta: { snapshotId: 'test', regionName: 'Normandie', demSource: 'IGN' },
        trails: [],
        places: fakePlaces,
      };
    },
    async fetchIsochrone() {
      return null;
    },
  };

  const headers = (extra?: Record<string, string>) => ({
    host: '127.0.0.1:5174',
    ...extra,
  });

  it('retourne les étapes bonus (< 15 min de détour) via GET /api/discover/bonus-stops', async () => {
    const app = makeApp(fakeCatalog);
    const res = await app.request(
      `${baseUrl}/api/discover/bonus-stops?lat=${TRAIL_START.lat}&lng=${TRAIL_START.lng}&originLat=${ROUEN.lat}&originLng=${ROUEN.lng}`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const stops = z.array(BonusStopSchema).parse(await res.json());
    expect(stops).toHaveLength(1);
    expect(stops[0]?.name).toBe('Château-Gaillard');
    expect(stops[0]?.detourMin).toBeLessThan(15);
  });

  it('gère le cycle CRUD complet des escapades en SQLite et la passerelle vers un voyage', async () => {
    const app = makeApp(fakeCatalog);

    // 1. Créer une escapade avec étape bonus
    const createRes = await app.request(`${baseUrl}/api/escapades`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        title: 'Escapade matinale aux Andelys',
        origin: { name: 'Rouen', location: ROUEN },
        startTime: '08:30',
        suggestion: sampleSuggestion,
        bonusStop: {
          placeId: 'osm:node:1',
          name: 'Château-Gaillard',
          category: 'heritage',
          location: { lat: 49.485, lng: 1.135 },
          detourMin: 3,
          detourKm: 1.8,
          distanceFromTrailKm: 2.0,
          attribution: '© OpenStreetMap contributors (ODbL)',
        },
        bonusDurationMin: 45,
        notes: 'Prévoir les jumelles',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = EscapadeSchema.parse(await createRes.json());
    expect(created.timeline.map((t) => t.kind)).toContain('bonus-visit');
    expect(created.totalDurationMin).toBeGreaterThan(180);

    // 2. Lister et retrouver
    const listRes = await app.request(`${baseUrl}/api/escapades`, { headers: headers() });
    expect(listRes.status).toBe(200);
    const list = z.array(EscapadeSchema).parse(await listRes.json());
    expect(list.map((e) => e.id)).toEqual([created.id]);

    // 3. Mettre à jour l'heure de départ
    const updateRes = await app.request(`${baseUrl}/api/escapades/${created.id}`, {
      method: 'PUT',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        title: 'Escapade aux Andelys (départ 09h)',
        origin: created.origin,
        startTime: '09:00',
        suggestion: created.suggestion,
        bonusStop: created.bonusStop,
        bonusDurationMin: 60,
      }),
    });
    expect(updateRes.status).toBe(200);
    const updated = EscapadeSchema.parse(await updateRes.json());
    expect(updated.timeline[0]?.startMin).toBe(540);
    expect(updated.title).toBe('Escapade aux Andelys (départ 09h)');

    // 4. Créer un voyage puis y ajouter l'escapade
    const tripRes = await app.request(`${baseUrl}/api/trips`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'Week-end Normandie',
        startDate: '2026-11-28',
        endDate: '2026-11-29',
        withDog: true,
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = (await tripRes.json()) as { slug: string };

    const bridgeRes = await app.request(`${baseUrl}/api/escapades/${created.id}/add-to-trip`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ tripSlug: trip.slug, dayIndex: 2 }),
    });
    expect(bridgeRes.status).toBe(201);
    const bridged = AddEscapadeToTripResponseSchema.parse(await bridgeRes.json());
    expect(bridged.trip.hikes).toHaveLength(1);
    expect(bridged.hike.name).toBe('Boucle des Andelys');
    expect(bridged.hike.dogPolicy).toBe('leash');
    expect(bridged.hike.stats.elevationGainM).toBe(210);
    expect(bridged.trip.places).toHaveLength(1);
    expect(bridged.trip.places[0]?.name).toBe('Château-Gaillard');
    expect(bridged.trip.days[1]?.stops).toHaveLength(2);
    expect(bridged.trip.days[1]?.stops[0]?.kind).toBe('hike');
    expect(bridged.trip.days[1]?.stops[1]?.kind).toBe('place');

    // Vérifier que le GPX est bien stocké sur disque et dans la bibliothèque
    expect(existsSync(path.join(dir, trip.slug, bridged.hike.gpxFile))).toBe(true);
    const libRes = await app.request(`${baseUrl}/api/library`, { headers: headers() });
    const lib = (await libRes.json()) as { name: string }[];
    expect(lib.some((h) => h.name === 'Boucle des Andelys')).toBe(true);

    // 5. Supprimer l'escapade
    const delRes = await app.request(`${baseUrl}/api/escapades/${created.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(delRes.status).toBe(204);
    const missingRes = await app.request(`${baseUrl}/api/escapades/${created.id}`, {
      headers: headers(),
    });
    expect(missingRes.status).toBe(404);
  });

  it('charge des étapes bonus réelles depuis catalog_v0.duckdb quand le fichier est présent', async () => {
    const realCatalog = path.resolve('data-pipeline/data/catalog_v0.duckdb');
    if (!existsSync(realCatalog)) return;

    const app = makeApp(new DuckDbCatalogSource(realCatalog));
    const res = await app.request(
      `${baseUrl}/api/discover/bonus-stops?lat=49.49&lng=1.18&originLat=${ROUEN.lat}&originLng=${ROUEN.lng}`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const stops = z.array(BonusStopSchema).parse(await res.json());
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop.detourMin).toBeLessThan(15);
    }
  });
});
