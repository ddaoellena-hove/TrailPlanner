import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogTrail } from '../shared/discovery';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import {
  DiscoveryResponseSchema,
  SuggestionFeedbackSchema,
} from '../shared/schema';
import { createApp } from './app';
import { DuckDbCatalogSource, type CatalogSource } from './catalog-reader';

const baseUrl = 'http://127.0.0.1:5174';
const ROUEN = { lat: 49.4431, lng: 1.0993 };

const fakeTrails: CatalogTrail[] = [
  {
    trailId: 'osm-rel-10',
    osmRelationId: 10,
    sourceType: 'osm_relation',
    name: 'Boucle du Col',
    kind: 'loop',
    distanceMeters: 6800,
    elevationGainMeters: 90,
    elevationLossMeters: 90,
    estimatedDurationMin: 115,
    difficulty: 'easy',
    pavedRatio: 0.08,
    surfaceUnknownRatio: 0.1,
    gapKm: 0,
    dogPolicy: 'unknown',
    inReserve: false,
    start: { lat: 45.0, lng: 6.0 },
    scenicAvg: 0.85,
    isolationAvg: 0.8,
    heritageAvg: 0.4,
    uncertainties: ['DOG_ACCESS_UNKNOWN'],
    coordinates: [
      [6.0, 45.0],
      [6.01, 45.02],
      [6.0, 45.0],
    ],
  },
  {
    trailId: 'gen-001',
    osmRelationId: null,
    sourceType: 'generated_loop',
    name: 'Boucle de la Vallée',
    kind: 'loop',
    distanceMeters: 9200,
    elevationGainMeters: 150,
    elevationLossMeters: 150,
    estimatedDurationMin: 145,
    difficulty: 'easy',
    pavedRatio: 0.12,
    surfaceUnknownRatio: 0.4,
    gapKm: 0,
    dogPolicy: 'unknown',
    inReserve: false,
    start: { lat: 45.12, lng: 6.18 },
    scenicAvg: 0.72,
    isolationAvg: 0.75,
    heritageAvg: 0.25,
    uncertainties: ['DOG_ACCESS_UNKNOWN', 'OSM_SURFACE_INCOMPLETE'],
    coordinates: [
      [6.18, 45.12],
      [6.2, 45.14],
      [6.18, 45.12],
    ],
  },
];

describe('API découverte (POST /api/discover & suggestion_feedback)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'itinera-discover-'));
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

  it('explique l’absence de catalogue (503) et valide la requête (400)', async () => {
    const noCatalog = makeApp(undefined);
    const res503 = await noCatalog.request(`${baseUrl}/api/discover`, {
      method: 'POST',
      headers: { host: '127.0.0.1:5174', 'content-type': 'application/json' },
      body: JSON.stringify({ origin: ROUEN }),
    });
    expect(res503.status).toBe(503);

    const mockCatalog: CatalogSource = {
      load: async () => ({
        meta: { snapshotId: 'test', regionName: 'test', demSource: 'IGN' },
        trails: fakeTrails,
      }),
      fetchIsochrone: async () => null,
    };
    const app = makeApp(mockCatalog);
    const bad = await app.request(`${baseUrl}/api/discover`, {
      method: 'POST',
      headers: { host: '127.0.0.1:5174', 'content-type': 'application/json' },
      body: JSON.stringify({ origin: ROUEN, minDistanceKm: 15, maxDistanceKm: 5 }),
    });
    expect(bad.status).toBe(400);
  });

  it('classe les suggestions, intègre Mes sorties et persiste suggestion_feedback dans SQLite', async () => {
    const mockCatalog: CatalogSource = {
      load: async () => ({
        meta: { snapshotId: 'alpes-test', regionName: 'alpes', demSource: 'IGN RGE ALTI' },
        trails: fakeTrails,
      }),
      fetchIsochrone: async () => null,
    };
    const app = makeApp(mockCatalog);
    const post = (route: string, body: unknown) =>
      app.request(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:5174', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    // 1. Découverte initiale : osm-rel-10 arrive en tête (plus haut score).
    const initial = DiscoveryResponseSchema.parse(
      await (
        await post('/api/discover', {
          origin: { lat: 45.0, lng: 6.0 },
          intent: { scenic: 0.4, isolation: 0.4, heritage: 0.2, novelty: 0.9 },
        })
      ).json(),
    );
    expect(initial.isochroneSource).toBe('radius-fallback');
    expect(initial.suggestions.map((s) => s.trailId)).toEqual(['osm-rel-10', 'gen-001']);
    expect(initial.suggestions[0]!.noveltyStatus).toBe('new');

    // 2. Import d'une sortie dans « Mes sorties » au même départ (~6,8 km) → pénalise osm-rel-10.
    const form = new FormData();
    form.set('file', new File([recordedGpx([northboundPoints(62)])], 'col.gpx'));
    const imported = await app.request(`${baseUrl}/api/activities`, {
      method: 'POST',
      headers: { host: '127.0.0.1:5174' },
      body: form,
    });
    expect(imported.status).toBe(201);

    const afterDone = DiscoveryResponseSchema.parse(
      await (
        await post('/api/discover', {
          origin: { lat: 45.0, lng: 6.0 },
          intent: { scenic: 0.4, isolation: 0.4, heritage: 0.2, novelty: 0.9 },
        })
      ).json(),
    );
    expect(afterDone.suggestions[0]!.trailId).toBe('gen-001');
    const doneItem = afterDone.suggestions.find((s) => s.trailId === 'osm-rel-10')!;
    expect(doneItem.noveltyStatus).toBe('done_before');

    // 3. Feedback « dismissed » sur gen-001 persisté dans SQLite.
    const fbRes = await post('/api/discover/feedback', {
      trailId: 'gen-001',
      origin: { lat: 45.0, lng: 6.0 },
      verdict: 'dismissed',
      reason: 'Déjà vue',
    });
    expect(fbRes.status).toBe(201);
    const createdFb = SuggestionFeedbackSchema.parse(await fbRes.json());
    expect(createdFb.verdict).toBe('dismissed');

    const listed = await (
      await app.request(`${baseUrl}/api/discover/feedback`, {
        headers: { host: '127.0.0.1:5174' },
      })
    ).json();
    expect(listed).toEqual([createdFb]);

    const afterDismiss = DiscoveryResponseSchema.parse(
      await (
        await post('/api/discover', {
          origin: { lat: 45.0, lng: 6.0 },
          intent: { scenic: 0.4, isolation: 0.4, heritage: 0.2, novelty: 0.9 },
        })
      ).json(),
    );
    expect(afterDismiss.suggestions.find((s) => s.trailId === 'gen-001')!.noveltyStatus).toBe(
      'rejected_before',
    );
  });

  const realCatalogPath = path.resolve('data-pipeline/data/catalog_v0.duckdb');
  it.skipIf(!existsSync(realCatalogPath))(
    'renvoie 10 suggestions expliquées et diversifiées depuis le vrai catalogue DuckDB',
    async () => {
      const source = new DuckDbCatalogSource(realCatalogPath);
      // Utilise le repli rayon pour garder le test 100 % hors réseau et déterministe.
      const offlineSource: CatalogSource = {
        load: () => source.load(),
        fetchIsochrone: async () => null,
      };
      const app = makeApp(offlineSource);
      const response = await app.request(`${baseUrl}/api/discover`, {
        method: 'POST',
        headers: { host: '127.0.0.1:5174', 'content-type': 'application/json' },
        body: JSON.stringify({ origin: ROUEN, maxDriveMin: 45, limit: 10 }),
      });
      expect(response.status).toBe(200);
      const payload = DiscoveryResponseSchema.parse(await response.json());
      expect(payload.totalMatching).toBeGreaterThanOrEqual(30);
      expect(payload.suggestions).toHaveLength(10);
      expect(payload.snapshotId).toContain('haute-normandie');
      for (const s of payload.suggestions) {
        expect(s.explanation.positives.length + s.explanation.tradeoffs.length).toBeGreaterThan(0);
        expect(s.provenance.sources).toContain('© OpenStreetMap contributors (ODbL)');
        expect(s.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
      }
    },
  );
});
