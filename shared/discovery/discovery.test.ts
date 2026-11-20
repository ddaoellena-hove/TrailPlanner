import { describe, expect, it } from 'vitest';
import { DiscoveryQuerySchema, SuggestionResultSchema } from '../schema';
import { discoverTrails, type CatalogMeta, type CatalogTrail } from './index';

const META: CatalogMeta = {
  snapshotId: 'haute-normandie-2026-11-20',
  regionName: 'haute-normandie',
  demSource: 'IGN RGE ALTI (Géoplateforme)',
};

const ROUEN = { lat: 49.4431, lng: 1.0993 };

function trail(overrides: Partial<CatalogTrail> = {}): CatalogTrail {
  const start = overrides.start ?? { lat: 49.47, lng: 1.25 };
  return {
    trailId: 'osm-rel-1',
    osmRelationId: 1,
    sourceType: 'osm_relation',
    name: 'Boucle de la forêt',
    kind: 'loop',
    distanceMeters: 9500,
    elevationGainMeters: 160,
    elevationLossMeters: 160,
    estimatedDurationMin: 155,
    difficulty: 'moderate',
    pavedRatio: 0.1,
    surfaceUnknownRatio: 0.2,
    gapKm: 0,
    dogPolicy: 'unknown',
    inReserve: false,
    start,
    scenicAvg: 0.7,
    isolationAvg: 0.65,
    heritageAvg: 0.3,
    uncertainties: ['DOG_ACCESS_UNKNOWN'],
    coordinates: [
      [start.lng, start.lat],
      [start.lng + 0.01, start.lat + 0.01],
      [start.lng, start.lat],
    ],
    ...overrides,
  };
}

describe('pipeline de découverte (shared/discovery)', () => {
  it('applique les contraintes dures sans jamais filtrer sur une inconnue (chien / D+)', () => {
    const query = DiscoveryQuerySchema.parse({
      origin: ROUEN,
      minDistanceKm: 5,
      maxDistanceKm: 15,
      maxElevationGainM: 300,
      maxPavedRatio: 0.4,
      withDog: true,
    });

    const candidates = [
      trail({ trailId: 'ok-unknown-dog', dogPolicy: 'unknown' }),
      trail({ trailId: 'forbidden-dog', dogPolicy: 'forbidden' }),
      trail({ trailId: 'too-steep', elevationGainMeters: 450 }),
      trail({
        trailId: 'missing-ele',
        elevationGainMeters: null,
        uncertainties: ['DOG_ACCESS_UNKNOWN', 'ELEVATION_MISSING'],
      }),
      trail({ trailId: 'too-paved', pavedRatio: 0.6 }),
      trail({ trailId: 'too-short', distanceMeters: 3000 }),
      trail({ trailId: 'point-to-point', kind: 'point-to-point' }),
      trail({ trailId: 'too-far', start: { lat: 47.0, lng: 1.0 } }),
    ];

    const result = discoverTrails(candidates, query, { meta: META, activities: [], feedbacks: [] });
    expect(result.suggestions.map((s) => s.trailId).sort()).toEqual([
      'missing-ele',
      'ok-unknown-dog',
    ]);
    for (const s of result.suggestions) {
      expect(SuggestionResultSchema.parse(s)).toEqual(s);
      expect(s.explanation.uncertainties).toContain('DOG_ACCESS_UNKNOWN');
    }
  });

  it('respecte un polygone d’isochrone quand il est fourni', () => {
    const query = DiscoveryQuerySchema.parse({ origin: ROUEN });
    const box = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [1.2, 49.45],
          [1.3, 49.45],
          [1.3, 49.5],
          [1.2, 49.5],
          [1.2, 49.45],
        ],
      ],
    };
    const inside = trail({ trailId: 'inside', start: { lat: 49.47, lng: 1.25 } });
    const outside = trail({
      trailId: 'outside',
      start: { lat: 49.44, lng: 1.1 },
      coordinates: [
        [1.1, 49.44],
        [1.11, 49.44],
      ],
    });

    const result = discoverTrails([inside, outside], query, {
      meta: META,
      activities: [],
      feedbacks: [],
      isochrone: box,
    });
    expect(result.suggestions.map((s) => s.trailId)).toEqual(['inside']);
  });

  it('pénalise les boucles déjà faites dans Mes sorties et celles écartées en feedback', () => {
    const query = DiscoveryQuerySchema.parse({
      origin: ROUEN,
      intent: { scenic: 0.4, isolation: 0.4, heritage: 0.2, novelty: 0.8 },
      diversityLambda: 1,
    });
    const fresh = trail({ trailId: 'fresh', start: { lat: 49.52, lng: 1.35 } });
    const done = trail({ trailId: 'done', start: { lat: 49.47, lng: 1.25 }, distanceMeters: 9500 });
    const dismissed = trail({ trailId: 'dismissed', start: { lat: 49.38, lng: 1.15 } });

    const result = discoverTrails([done, dismissed, fresh], query, {
      meta: META,
      activities: [
        {
          start: { lat: 49.4705, lng: 1.2505 },
          distanceMeters: 9600,
          profile: [{ distKm: 0, altM: 100, lat: 49.4705, lng: 1.2505 }],
        },
      ],
      feedbacks: [{ trailId: 'dismissed', verdict: 'dismissed' }],
    });

    expect(result.suggestions.map((s) => s.trailId)).toEqual(['fresh', 'done', 'dismissed']);
    expect(result.suggestions[0]!.noveltyStatus).toBe('new');
    expect(result.suggestions[1]!.noveltyStatus).toBe('done_before');
    expect(result.suggestions[1]!.explanation.tradeoffs).toContain(
      'Boucle déjà parcourue dans « Mes sorties »',
    );
    expect(result.suggestions[2]!.noveltyStatus).toBe('rejected_before');
  });

  it('diversifie géographiquement avec MMR au lieu de renvoyer des boucles collées', () => {
    const query = DiscoveryQuerySchema.parse({
      origin: ROUEN,
      limit: 2,
      diversityLambda: 0.65,
    });
    // Deux boucles quasi identiques au même point + une boucle légèrement moins notée mais dans un autre massif.
    const a1 = trail({ trailId: 'foret-a1', start: { lat: 49.47, lng: 1.25 }, scenicAvg: 0.82 });
    const a2 = trail({ trailId: 'foret-a2', start: { lat: 49.471, lng: 1.251 }, scenicAvg: 0.81 });
    const b1 = trail({ trailId: 'vallee-b1', start: { lat: 49.31, lng: 1.45 }, scenicAvg: 0.78 });

    const result = discoverTrails([a1, a2, b1], query, { meta: META, activities: [], feedbacks: [] });
    expect(result.suggestions.map((s) => s.trailId)).toEqual(['foret-a1', 'vallee-b1']);
  });

  it('adapte le classement à l’intention patrimoine vs isolement', () => {
    const abbey = trail({
      trailId: 'abbaye',
      start: { lat: 49.45, lng: 1.25 },
      scenicAvg: 0.4,
      isolationAvg: 0.2,
      heritageAvg: 0.95,
    });
    const forest = trail({
      trailId: 'foret',
      start: { lat: 49.55, lng: 1.35 },
      scenicAvg: 0.5,
      isolationAvg: 0.95,
      heritageAvg: 0.05,
    });

    const heritageFirst = discoverTrails(
      [forest, abbey],
      DiscoveryQuerySchema.parse({
        origin: ROUEN,
        intent: { scenic: 0.1, isolation: 0.1, heritage: 1, novelty: 0 },
      }),
      { meta: META, activities: [], feedbacks: [] },
    );
    expect(heritageFirst.suggestions[0]!.trailId).toBe('abbaye');

    const calmFirst = discoverTrails(
      [forest, abbey],
      DiscoveryQuerySchema.parse({
        origin: ROUEN,
        intent: { scenic: 0.1, isolation: 1, heritage: 0.1, novelty: 0 },
      }),
      { meta: META, activities: [], feedbacks: [] },
    );
    expect(calmFirst.suggestions[0]!.trailId).toBe('foret');
  });

  it('documente provenance et compromis pour une boucle générée', () => {
    const generated = trail({
      trailId: 'gen-042',
      osmRelationId: null,
      sourceType: 'generated_loop',
      name: 'Boucle autour de Lyons-la-Forêt',
      pavedRatio: 0.36,
      elevationGainMeters: 420,
      uncertainties: ['DOG_ACCESS_UNKNOWN', 'OSM_SURFACE_INCOMPLETE'],
    });
    const { suggestions } = discoverTrails(
      [generated],
      DiscoveryQuerySchema.parse({ origin: ROUEN }),
      { meta: META, activities: [], feedbacks: [] },
    );
    const [s] = suggestions;
    expect(s!.provenance).toEqual({
      snapshotId: META.snapshotId,
      regionName: META.regionName,
      sources: ['© OpenStreetMap contributors (ODbL)', META.demSource],
      sourceType: 'generated_loop',
      osmRelationId: null,
    });
    expect(s!.explanation.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bitume'),
        expect.stringContaining('générée'),
        expect.stringContaining('Dénivelé'),
      ]),
    );
    expect(s!.explanation.uncertainties).toEqual(['DOG_ACCESS_UNKNOWN', 'OSM_SURFACE_INCOMPLETE']);
  });
});
