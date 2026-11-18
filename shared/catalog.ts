/**
 * Calculs purs du catalogue Vagari (phase 0, VAGARI-PLAN.md) : assemblage des
 * tracés OSM, qualification des surfaces, scores des cellules H3 et classement
 * provisoire des boucles. Aucune donnée n'est inventée : ce qui manque reste
 * `unknown` et devient une incertitude.
 */
import { distanceKm } from './gpx';
import type { LatLng } from './schema';

// ---------------------------------------------------------------------------
// Géométrie

/** Écart toléré entre deux tronçons consécutifs d'une relation, en km. */
export const CHAIN_JOIN_KM = 0.02;

export type ChainResult = { points: LatLng[]; gapKm: number; gaps: number };

/**
 * Enchaîne les tronçons d'une relation en un seul tracé. Part du premier
 * tronçon, puis prend à chaque fois le tronçon libre dont une extrémité est la
 * plus proche de la fin du tracé, retourné si besoin. Les sauts au-delà de
 * `CHAIN_JOIN_KM` sont comptés : ils signalent une relation trouée ou à
 * variantes.
 */
export function chainSegments(segments: LatLng[][]): ChainResult {
  const pending = segments.filter((s) => s.length >= 2);
  const first = pending.shift();
  if (!first) return { points: [], gapKm: 0, gaps: 0 };
  const points = [...first];
  let gapKm = 0;
  let gaps = 0;
  while (pending.length > 0) {
    const end = points.at(-1)!;
    let best = 0;
    let bestKm = Infinity;
    let reverse = false;
    pending.forEach((segment, i) => {
      const toStart = distanceKm(end, segment[0]!);
      const toEnd = distanceKm(end, segment.at(-1)!);
      if (toStart < bestKm) [best, bestKm, reverse] = [i, toStart, false];
      if (toEnd < bestKm) [best, bestKm, reverse] = [i, toEnd, true];
    });
    const [segment] = pending.splice(best, 1);
    const ordered = reverse ? [...segment!].reverse() : segment!;
    if (bestKm > CHAIN_JOIN_KM) {
      gapKm += bestKm;
      gaps++;
    }
    points.push(...(bestKm <= CHAIN_JOIN_KM ? ordered.slice(1) : ordered));
  }
  return { points, gapKm, gaps };
}

/** Ajoute des points pour qu'aucun intervalle ne dépasse `stepKm`. */
export function densify(points: LatLng[], stepKm: number): LatLng[] {
  if (points.length < 2) return [...points];
  const result: LatLng[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const steps = Math.ceil(distanceKm(a, b) / stepKm);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      result.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return result;
}

/** Garde un point sur `every`, plus le dernier. */
export function decimate<T>(points: T[], every: number): T[] {
  return points.filter((_, i) => i % every === 0 || i === points.length - 1);
}

// ---------------------------------------------------------------------------
// Revêtement, accès

const PAVED_SURFACES = new Set([
  'asphalt',
  'paved',
  'concrete',
  'concrete:plates',
  'concrete:lanes',
  'paving_stones',
  'sett',
  'cobblestone',
  'chipseal',
]);
const UNPAVED_SURFACES = new Set([
  'unpaved',
  'compacted',
  'fine_gravel',
  'gravel',
  'pebblestone',
  'ground',
  'dirt',
  'earth',
  'grass',
  'mud',
  'sand',
  'rock',
  'woodchips',
]);
/** Voies supposées goudronnées quand `surface` manque. */
const PAVED_HIGHWAYS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'pedestrian',
]);
const UNPAVED_HIGHWAYS = new Set(['path', 'bridleway']);

export type Surface = 'paved' | 'unpaved' | 'unknown';

/**
 * Revêtement d'une voie OSM. `surface` prime ; sinon on déduit du type de voie
 * (route goudronnée, sentier non) et du `tracktype` des chemins. Un `track` ou
 * un `footway` sans précision reste inconnu.
 */
export function waySurface(tags: Record<string, string | undefined>): Surface {
  const surface = tags.surface;
  if (surface && PAVED_SURFACES.has(surface)) return 'paved';
  if (surface && UNPAVED_SURFACES.has(surface)) return 'unpaved';
  const highway = tags.highway ?? '';
  if (PAVED_HIGHWAYS.has(highway)) return 'paved';
  if (UNPAVED_HIGHWAYS.has(highway)) return 'unpaved';
  if (highway === 'track') return tags.tracktype === 'grade1' ? 'paved' : tags.tracktype ? 'unpaved' : 'unknown';
  return 'unknown';
}

export type SurfaceShares = { paved: number; unpaved: number; unknown: number };

/** Parts de longueur par revêtement, chaque part dans [0, 1]. */
export function surfaceShares(ways: { lengthKm: number; surface: Surface }[]): SurfaceShares {
  const total = ways.reduce((sum, w) => sum + w.lengthKm, 0);
  const share = (kind: Surface) =>
    total === 0 ? 0 : ways.filter((w) => w.surface === kind).reduce((s, w) => s + w.lengthKm, 0) / total;
  return { paved: share('paved'), unpaved: share('unpaved'), unknown: total === 0 ? 1 : share('unknown') };
}

export type DogAccess = 'allowed' | 'leashed' | 'forbidden' | 'unknown';

export function dogAccess(value: string | undefined): DogAccess {
  if (value === 'yes' || value === 'designated' || value === 'permissive') return 'allowed';
  if (value === 'leashed') return 'leashed';
  if (value === 'no') return 'forbidden';
  return 'unknown';
}

/**
 * Politique chien d'une boucle : interdite si un tronçon l'interdit, sinon
 * celle de la relation, sinon autorisée seulement si tous les tronçons le
 * disent. Le silence d'OSM reste `unknown`.
 */
export function trailDogPolicy(relation: DogAccess, ways: DogAccess[]): DogAccess {
  if (relation === 'forbidden' || ways.includes('forbidden')) return 'forbidden';
  if (relation !== 'unknown') return relation;
  if (ways.length > 0 && ways.every((w) => w === 'allowed')) return 'allowed';
  if (ways.length > 0 && ways.every((w) => w === 'allowed' || w === 'leashed')) return 'leashed';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Scores des cellules H3

/** Caractéristiques mesurées d'une cellule (résolution 8, ≈ 0,7 km²). */
export type CellFeatures = {
  /** Part de la cellule en forêt ou bois, [0, 1]. */
  forestShare: number;
  /** Part de la cellule en zone bâtie (résidentiel, industriel, commerce), [0, 1]. */
  builtShare: number;
  /** Eau libre, cours d'eau ou littoral dans la cellule. */
  hasWater: boolean;
  /** Falaise ou trait de côte dans la cellule. */
  hasCoastOrCliff: boolean;
  /** Points de vue dans la cellule. */
  viewpoints: number;
  /** Écart-type des altitudes échantillonnées, en m (null si inconnu). */
  elevationStdM: number | null;
  /** Distance en anneaux H3 à la route principale la plus proche (0 = traversée). */
  ringsToMajorRoad: number;
  /** Poids patrimonial de la cellule et de ses voisines immédiates. */
  heritageWeight: number;
};

export type CellScores = { scenic: number; isolation: number; heritage: number; roughness: number };

/** Relief jugé « marqué » à partir de cet écart-type d'altitude dans une cellule. */
export const ROUGHNESS_FULL_STD_M = 20;
/** Isolement maximal à partir de ce nombre d'anneaux (≈ 3,5 km) d'une route principale. */
export const ISOLATION_FULL_RINGS = 4;
/** Patrimoine maximal à partir de ce poids (≈ 3 sites notables proches). */
export const HERITAGE_FULL_WEIGHT = 3;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Scores [0, 1] d'une cellule. Formules volontairement simples et lisibles,
 * pour que chaque suggestion puisse s'expliquer :
 * - paysage = 0,35 forêt + 0,2 eau + 0,15 côte/falaise + 0,2 relief + 0,1 point de vue, moins 0,5 bâti ;
 * - isolement = distance à une route principale, réduite par le bâti ;
 * - patrimoine = poids des sites patrimoniaux de la cellule et de ses voisines.
 */
export function cellScores(f: CellFeatures): CellScores {
  const roughness = f.elevationStdM === null ? 0 : clamp01(f.elevationStdM / ROUGHNESS_FULL_STD_M);
  const scenic =
    0.35 * f.forestShare +
    0.2 * (f.hasWater ? 1 : 0) +
    0.15 * (f.hasCoastOrCliff ? 1 : 0) +
    0.2 * roughness +
    0.1 * Math.min(1, f.viewpoints) -
    0.5 * f.builtShare;
  const isolation = clamp01(f.ringsToMajorRoad / ISOLATION_FULL_RINGS) * (1 - f.builtShare);
  return {
    scenic: clamp01(scenic),
    isolation: clamp01(isolation),
    heritage: clamp01(f.heritageWeight / HERITAGE_FULL_WEIGHT),
    roughness,
  };
}

/** Poids patrimonial d'un lieu : monument notable (Wikidata) plus qu'un simple calvaire. */
export function heritageWeight(place: { category: string; popularity: number }): number {
  if (place.category === 'heritage') return 0.4 + 0.6 * place.popularity;
  if (place.category === 'village') return 0.2 + 0.3 * place.popularity;
  return 0;
}

/** Popularité [0, 1] d'après la présence dans Wikidata / Wikipédia et une protection patrimoniale. */
export function popularity(tags: Record<string, string | undefined>): number {
  return clamp01(
    (tags.wikidata ? 0.5 : 0) + (tags.wikipedia ? 0.3 : 0) + (tags.heritage ? 0.2 : 0),
  );
}

// ---------------------------------------------------------------------------
// Boucles

export type Difficulty = 'easy' | 'moderate' | 'hard';

/** Difficulté d'après la durée DIN et le D+, en plaine normande comme en montagne. */
export function difficulty(durationMin: number, gainM: number | null): Difficulty {
  const gain = gainM ?? 0;
  if (durationMin <= 150 && gain <= 300) return 'easy';
  if (durationMin <= 300 && gain <= 800) return 'moderate';
  return 'hard';
}

export type UncertaintyCode =
  | 'DOG_ACCESS_UNKNOWN'
  | 'RESERVE_REGULATION_CHECK'
  | 'OSM_SURFACE_INCOMPLETE'
  | 'OSM_GEOMETRY_INCOMPLETE'
  | 'ACCESS_RESTRICTED'
  | 'ELEVATION_MISSING';

/** Part de revêtement inconnu au-delà de laquelle le ratio de bitume n'est pas fiable. */
export const SURFACE_UNKNOWN_MAX = 0.3;
/** Trou cumulé au-delà duquel le tracé assemblé n'est pas fiable, en km. */
export const GEOMETRY_GAP_MAX_KM = 0.3;

export function trailUncertainties(t: {
  dogPolicy: DogAccess;
  inReserve: boolean;
  surfaceUnknownShare: number;
  gapKm: number;
  restrictedWays: number;
  gainM: number | null;
}): UncertaintyCode[] {
  const codes: UncertaintyCode[] = [];
  if (t.dogPolicy === 'unknown') codes.push('DOG_ACCESS_UNKNOWN');
  if (t.inReserve) codes.push('RESERVE_REGULATION_CHECK');
  if (t.surfaceUnknownShare > SURFACE_UNKNOWN_MAX) codes.push('OSM_SURFACE_INCOMPLETE');
  if (t.gapKm > GEOMETRY_GAP_MAX_KM) codes.push('OSM_GEOMETRY_INCOMPLETE');
  if (t.restrictedWays > 0) codes.push('ACCESS_RESTRICTED');
  if (t.gainM === null) codes.push('ELEVATION_MISSING');
  return codes;
}

export type IntentWeights = { scenic: number; isolation: number; heritage: number };

/** Pondération par défaut de la spec (`DiscoveryQuerySchema`), hors nouveauté. */
export const DEFAULT_INTENT: IntentWeights = { scenic: 0.5, isolation: 0.5, heritage: 0.3 };

/**
 * Score provisoire d'une boucle pour la revue de la phase 0 : moyenne pondérée
 * des scores le long du tracé, pénalisée par le bitume et un tracé douteux.
 * La phase 3 le remplacera par filtre → score → MMR.
 */
export function provisionalTrailScore(
  t: { scenicAvg: number; isolationAvg: number; heritageAvg: number; pavedRatio: number; gapKm: number },
  intent: IntentWeights = DEFAULT_INTENT,
): number {
  const weights = intent.scenic + intent.isolation + intent.heritage || 1;
  const base =
    (intent.scenic * t.scenicAvg + intent.isolation * t.isolationAvg + intent.heritage * t.heritageAvg) /
    weights;
  const pavedPenalty = 0.4 * t.pavedRatio;
  const gapPenalty = t.gapKm > GEOMETRY_GAP_MAX_KM ? 0.2 : 0;
  return clamp01(base - pavedPenalty - gapPenalty);
}
