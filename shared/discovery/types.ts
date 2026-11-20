import type { Difficulty, DogAccess, UncertaintyCode } from '../catalog';
import type {
  Activity,
  DiscoveryIntent,
  LatLng,
  SuggestionFeedback,
} from '../schema';

export type CatalogMeta = {
  snapshotId: string;
  regionName: string;
  demSource: string;
};

/** Sentier issu du catalogue DuckDB (`reference_trails`), indépendant de toute couche SQL. */
export type CatalogTrail = {
  trailId: string;
  osmRelationId: number | null;
  sourceType: 'osm_relation' | 'generated_loop';
  name: string | null;
  kind: 'loop' | 'out-and-back' | 'point-to-point';
  distanceMeters: number;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  estimatedDurationMin: number;
  difficulty: Difficulty;
  pavedRatio: number;
  surfaceUnknownRatio: number;
  gapKm: number;
  dogPolicy: DogAccess;
  inReserve: boolean;
  start: LatLng;
  scenicAvg: number;
  isolationAvg: number;
  heritageAvg: number;
  uncertainties: UncertaintyCode[];
  coordinates: [number, number][];
};

export type IsochronePolygon = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

export type DiscoveryContext = {
  meta: CatalogMeta;
  /** Sorties enregistrées (« Mes sorties »), pour pénaliser les boucles déjà faites. */
  activities: Pick<Activity, 'start' | 'distanceMeters' | 'profile'>[];
  /** Avis antérieurs (`suggestion_feedback`) : les boucles écartées sont pénalisées. */
  feedbacks: Pick<SuggestionFeedback, 'trailId' | 'verdict'>[];
  /** Polygone d'isochrone voiture optionnel (sinon filtrage par rayon estimé). */
  isochrone?: IsochronePolygon | null;
};

export const DEFAULT_DISCOVERY_INTENT: DiscoveryIntent = {
  scenic: 0.5,
  isolation: 0.5,
  heritage: 0.3,
  novelty: 0.4,
};

export const FALLBACK_DRIVE_SPEED_KMH = 55;
export const FALLBACK_ROAD_DETOUR = 1.25;
