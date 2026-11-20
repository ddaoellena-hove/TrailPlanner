import { describe, expect, it } from 'vitest';
import {
  assembleEscapadeTimeline,
  findBonusStops,
  mapCatalogDogPolicy,
  MAX_BONUS_DETOUR_MIN,
  suggestionToGpxXml,
  type CatalogPlace,
} from './escapade';
import type { SuggestionResult } from './schema';

const ROUEN = { lat: 49.4431, lng: 1.0993 };
const TRAIL_START = { lat: 49.5, lng: 1.15 };

const sampleSuggestion: SuggestionResult = {
  trailId: 'osm-rel-42',
  osmRelationId: 42,
  sourceType: 'osm_relation',
  name: 'Boucle de la Forêt Verte',
  kind: 'loop',
  distanceMeters: 9400,
  elevationGainMeters: 180,
  elevationLossMeters: 180,
  estimatedDurationMin: 150,
  difficulty: 'moderate',
  pavedRatio: 0.1,
  surfaceUnknownRatio: 0.1,
  dogPolicy: 'leashed',
  inReserve: false,
  start: TRAIL_START,
  estimatedDriveMin: 20,
  geometry: {
    type: 'LineString',
    coordinates: [
      [1.15, 49.5],
      [1.17, 49.51],
      [1.16, 49.52],
      [1.15, 49.5],
    ],
  },
  scores: {
    total: 0.82,
    scenic: 0.8,
    isolation: 0.75,
    heritage: 0.5,
    novelty: 1,
    pavedPenalty: 0.04,
  },
  noveltyStatus: 'new',
  explanation: {
    positives: ['Paysage marqué'],
    tradeoffs: [],
    uncertainties: [],
  },
  provenance: {
    snapshotId: 'normandie-2026-11',
    regionName: 'Normandie',
    sources: ['© OpenStreetMap contributors (ODbL)', 'IGN RGE ALTI'],
    sourceType: 'osm_relation',
    osmRelationId: 42,
  },
};

describe('findBonusStops', () => {
  const places: CatalogPlace[] = [
    {
      placeId: 'p1',
      name: 'Abbaye de Saint-Georges',
      category: 'heritage',
      location: { lat: 49.48, lng: 1.13 }, // sur la route du retour -> détour minime
      popularity: 0.8,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    {
      placeId: 'p2',
      name: 'Belvédère de la Seine',
      category: 'viewpoint',
      location: { lat: 49.51, lng: 1.16 }, // tout près du départ
      popularity: 0.5,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    {
      placeId: 'p3',
      name: 'Château trop loin',
      category: 'heritage',
      location: { lat: 49.75, lng: 1.6 }, // bien au-delà de 15 min de détour
      popularity: 1.0,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    {
      placeId: 'p4',
      name: 'Abbaye de Saint-Georges', // doublon de nom
      category: 'heritage',
      location: { lat: 49.481, lng: 1.131 },
      popularity: 0.4,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    {
      placeId: 'p5',
      name: '   ', // sans nom : ignoré
      category: 'village',
      location: { lat: 49.49, lng: 1.14 },
      popularity: 0.2,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
  ];

  it('ne retourne que des étapes nommées avec un détour strictement inférieur à 15 min', () => {
    const stops = findBonusStops(TRAIL_START, ROUEN, places);
    expect(stops.map((s) => s.placeId)).toEqual(['p1', 'p2']);
    for (const stop of stops) {
      expect(stop.detourMin).toBeLessThan(MAX_BONUS_DETOUR_MIN);
    }
  });

  it('privilégie la diversité des catégories avant d’empiler des villages', () => {
    const many: CatalogPlace[] = [
      { placeId: 'v1', name: 'Village A', category: 'village', location: { lat: 49.49, lng: 1.14 }, popularity: 0.9, attribution: 'OSM' },
      { placeId: 'v2', name: 'Village B', category: 'village', location: { lat: 49.485, lng: 1.12 }, popularity: 0.9, attribution: 'OSM' },
      { placeId: 'v3', name: 'Village C', category: 'village', location: { lat: 49.475, lng: 1.11 }, popularity: 0.9, attribution: 'OSM' },
      { placeId: 'vp1', name: 'Panorama', category: 'viewpoint', location: { lat: 49.505, lng: 1.155 }, popularity: 0.3, attribution: 'OSM' },
    ];
    const stops = findBonusStops(TRAIL_START, ROUEN, many, { limit: 3 });
    expect(stops.some((s) => s.category === 'viewpoint')).toBe(true);
    expect(stops.filter((s) => s.category === 'village')).toHaveLength(2);
  });
});

describe('assembleEscapadeTimeline', () => {
  it('construit une chronologie porte-à-porte cohérente sans étape bonus', () => {
    const assembled = assembleEscapadeTimeline({
      origin: { name: 'Rouen', location: ROUEN },
      startTime: '09:00',
      suggestion: sampleSuggestion,
      bonusStop: null,
      bonusDurationMin: 45,
    });

    expect(assembled.timeline.map((item) => item.kind)).toEqual([
      'origin',
      'approach',
      'anchor',
      'return',
    ]);
    expect(assembled.timeline[0]?.startMin).toBe(540);
    expect(assembled.timeline[1]?.endMin).toBe(560);
    expect(assembled.timeline[2]?.endMin).toBe(710);
    expect(assembled.timeline[3]?.endMin).toBe(730);
    expect(assembled.totalDriveMin).toBe(40);
    expect(assembled.totalDurationMin).toBe(190);
  });

  it('insère le détour et la visite quand une étape bonus est choisie', () => {
    const assembled = assembleEscapadeTimeline({
      origin: { name: 'Rouen', location: ROUEN },
      startTime: '08:30',
      suggestion: sampleSuggestion,
      bonusStop: {
        placeId: 'p1',
        name: 'Abbaye de Saint-Georges',
        category: 'heritage',
        location: { lat: 49.48, lng: 1.13 },
        detourMin: 4,
        detourKm: 2.1,
        distanceFromTrailKm: 2.6,
        attribution: 'OSM',
      },
      bonusDurationMin: 45,
    });

    const kinds = assembled.timeline.map((item) => item.kind);
    expect(kinds).toContain('bonus-visit');
    expect(kinds.at(-1)).toBe('return');
    const visit = assembled.timeline.find((i) => i.kind === 'bonus-visit');
    expect(visit?.durationMin).toBe(45);
    expect(assembled.totalDurationMin).toBe(
      assembled.timeline.at(-1)!.endMin - assembled.timeline[0]!.startMin,
    );
  });
});

describe('suggestionToGpxXml & mapCatalogDogPolicy', () => {
  it('produit un GPX 1.1 bien formé avec échappement XML et sans altitude inventée', () => {
    const xml = suggestionToGpxXml({
      ...sampleSuggestion,
      name: 'Boucle <Test> & Forêt',
    });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<name>Boucle &lt;Test&gt; &amp; Forêt</name>');
    expect(xml).toContain('<trkpt lat="49.500000" lon="1.150000"></trkpt>');
    expect(xml).not.toContain('<ele>');
  });

  it('convertit leashed en leash pour les voyages', () => {
    expect(mapCatalogDogPolicy('leashed')).toBe('leash');
    expect(mapCatalogDogPolicy('allowed')).toBe('allowed');
    expect(mapCatalogDogPolicy('forbidden')).toBe('forbidden');
    expect(mapCatalogDogPolicy('unknown')).toBe('unknown');
  });
});
