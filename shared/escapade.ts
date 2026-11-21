import type { UncertaintyCode } from './catalog';
import { estimateDriveMinutes } from './discovery/filter';
import { FALLBACK_DRIVE_SPEED_KMH, FALLBACK_ROAD_DETOUR } from './discovery/types';
import { fastDistanceKm } from './loop-generator';
import type {
  BonusStop,
  BonusStopCategory,
  EscapadeOrigin,
  EscapadeTimelineItem,
  Hike,
  LatLng,
  SuggestionResult,
} from './schema';

/** Lieu d'intérêt issu du catalogue DuckDB (`places`), indépendant de toute couche SQL. */
export type CatalogPlace = {
  placeId: string;
  name: string;
  category: BonusStopCategory;
  location: LatLng;
  /** Popularité [0, 1] dérivée de Wikidata / Wikipédia / protection patrimoniale. */
  popularity: number;
  attribution: string;
};

/** Détour maximal autorisé pour une étape bonus (strictement inférieur à 15 min). */
export const MAX_BONUS_DETOUR_MIN = 15;
const MAX_TRAIL_RADIUS_KM = 12;
const DEDUP_RADIUS_KM = 0.3;

export const BONUS_CATEGORY_LABELS: Record<BonusStopCategory, string> = {
  viewpoint: 'Point de vue',
  heritage: 'Patrimoine',
  village: 'Village',
  water: 'Bord d’eau',
  peak: 'Sommet',
};

export const UNCERTAINTY_LABELS: Record<UncertaintyCode, string> = {
  DOG_ACCESS_UNKNOWN: 'Accès chien non renseigné dans OSM (à vérifier sur place)',
  RESERVE_REGULATION_CHECK: 'Traverse une zone protégée — vérifier la réglementation locale',
  OSM_SURFACE_INCOMPLETE: 'Revêtement incomplet dans OSM (part de bitume approximative)',
  OSM_GEOMETRY_INCOMPLETE: 'Tracé OSM partiellement discontinu (vérifier la liaison)',
  ACCESS_RESTRICTED: 'Tronçon signalé en accès restreint dans OSM',
  ELEVATION_MISSING: 'Dénivelé non calculé (altitude absente)',
};

export const DIFFICULTY_LABELS: Record<SuggestionResult['difficulty'], string> = {
  easy: 'Facile',
  moderate: 'Modérée',
  hard: 'Soutenue',
};

export const DOG_POLICY_LABELS: Record<SuggestionResult['dogPolicy'], string> = {
  allowed: 'Chiens autorisés',
  leashed: 'Chiens en laisse',
  forbidden: 'Chiens interdits',
  unknown: 'Accès chien inconnu',
};

const CATEGORY_PRIORITY: Record<BonusStopCategory, number> = {
  heritage: 1.0,
  viewpoint: 0.95,
  water: 0.7,
  peak: 0.65,
  village: 0.55,
};

function estimatedRoadKm(a: LatLng, b: LatLng): number {
  return fastDistanceKm(a, b) * FALLBACK_ROAD_DETOUR;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizePlaceName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Sélectionne les meilleures étapes bonus autour d'une boucle, ajoutant strictement
 * moins de `maxDetourMin` minutes de détour par rapport au retour direct `trailStart → origin`.
 */
export function findBonusStops(
  trailStart: LatLng,
  origin: LatLng,
  places: CatalogPlace[],
  options: { maxDetourMin?: number; limit?: number } = {},
): BonusStop[] {
  const maxDetourMin = options.maxDetourMin ?? MAX_BONUS_DETOUR_MIN;
  const limit = options.limit ?? 5;
  if (limit <= 0 || places.length === 0) return [];

  const directReturnKm = estimatedRoadKm(trailStart, origin);

  const scored: { stop: BonusStop; score: number }[] = [];
  for (const place of places) {
    const trimmed = place.name.trim();
    if (!trimmed) continue;

    const distFromTrailKm = fastDistanceKm(trailStart, place.location);
    if (distFromTrailKm > MAX_TRAIL_RADIUS_KM) continue;

    const legToBonusKm = estimatedRoadKm(trailStart, place.location);
    const legBonusToOriginKm = estimatedRoadKm(place.location, origin);
    const detourKm = Math.max(0, legToBonusKm + legBonusToOriginKm - directReturnKm);
    const detourMin =
      distFromTrailKm < 0.2
        ? 0
        : Math.max(1, Math.round((detourKm / FALLBACK_DRIVE_SPEED_KMH) * 60));

    if (detourMin >= maxDetourMin) continue;

    const detourPenalty = detourMin / maxDetourMin;
    const score =
      CATEGORY_PRIORITY[place.category] * 0.55 +
      place.popularity * 0.35 -
      detourPenalty * 0.25 -
      (distFromTrailKm / MAX_TRAIL_RADIUS_KM) * 0.1;

    scored.push({
      score,
      stop: {
        placeId: place.placeId,
        name: trimmed,
        category: place.category,
        location: place.location,
        detourMin,
        detourKm: roundOne(detourKm),
        distanceFromTrailKm: roundOne(distFromTrailKm),
        attribution: place.attribution,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score || a.stop.detourMin - b.stop.detourMin);

  // Déduplication par nom normalisé ou proximité immédiate, et diversité par catégorie (max 2 par catégorie en passe 1).
  const picked: BonusStop[] = [];
  const seenNames = new Set<string>();
  const categoryCounts = new Map<BonusStopCategory, number>();
  const overflow: BonusStop[] = [];

  const isDuplicate = (candidate: BonusStop): boolean => {
    const key = normalizePlaceName(candidate.name);
    if (seenNames.has(key)) return true;
    return picked.some((p) => fastDistanceKm(p.location, candidate.location) < DEDUP_RADIUS_KM);
  };

  for (const { stop } of scored) {
    if (picked.length >= limit) break;
    if (isDuplicate(stop)) continue;
    const count = categoryCounts.get(stop.category) ?? 0;
    if (count >= 2) {
      overflow.push(stop);
      continue;
    }
    picked.push(stop);
    seenNames.add(normalizePlaceName(stop.name));
    categoryCounts.set(stop.category, count + 1);
  }

  for (const stop of overflow) {
    if (picked.length >= limit) break;
    if (isDuplicate(stop)) continue;
    picked.push(stop);
    seenNames.add(normalizePlaceName(stop.name));
  }

  return picked;
}

/** Convertit « HH:mm » en minutes depuis minuit. */
export function parseTimeToMinutes(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Assemble de manière déterministe la chronologie porte-à-porte d'une escapade :
 * `origine → approche voiture → ancre (boucle) → [détour + étape bonus] → retour voiture`.
 */
export function assembleEscapadeTimeline(input: {
  origin: EscapadeOrigin;
  startTime: string;
  suggestion: SuggestionResult;
  bonusStop: BonusStop | null;
  bonusDurationMin: number;
}): {
  timeline: EscapadeTimelineItem[];
  totalDriveMin: number;
  totalDurationMin: number;
} {
  const startClock = parseTimeToMinutes(input.startTime);
  let cursor = startClock;
  const timeline: EscapadeTimelineItem[] = [];

  timeline.push({
    kind: 'origin',
    label: `Départ — ${input.origin.name}`,
    startMin: cursor,
    endMin: cursor,
    durationMin: 0,
  });

  const approachMin = Math.max(0, Math.round(input.suggestion.estimatedDriveMin));
  const approachKm = roundOne(estimatedRoadKm(input.origin.location, input.suggestion.start));
  timeline.push({
    kind: 'approach',
    label: `Approche voiture → ${input.suggestion.name}`,
    startMin: cursor,
    endMin: cursor + approachMin,
    durationMin: approachMin,
    distanceKm: approachKm,
  });
  cursor += approachMin;

  const hikeMin = Math.max(1, Math.round(input.suggestion.estimatedDurationMin));
  timeline.push({
    kind: 'anchor',
    label: `Randonnée — ${input.suggestion.name}`,
    startMin: cursor,
    endMin: cursor + hikeMin,
    durationMin: hikeMin,
    distanceKm: roundOne(input.suggestion.distanceMeters / 1000),
  });
  cursor += hikeMin;

  let returnDriveMin = approachMin;
  let bonusDriveMin = 0;

  if (input.bonusStop) {
    const legToBonusKm = roundOne(
      estimatedRoadKm(input.suggestion.start, input.bonusStop.location),
    );
    bonusDriveMin = estimateDriveMinutes(input.suggestion.start, input.bonusStop.location);
    if (bonusDriveMin > 0) {
      timeline.push({
        kind: 'bonus-drive',
        label: `Trajet → ${input.bonusStop.name}`,
        startMin: cursor,
        endMin: cursor + bonusDriveMin,
        durationMin: bonusDriveMin,
        distanceKm: legToBonusKm,
      });
      cursor += bonusDriveMin;
    }

    const visitMin = Math.max(10, Math.round(input.bonusDurationMin));
    timeline.push({
      kind: 'bonus-visit',
      label: `Étape bonus — ${input.bonusStop.name}`,
      startMin: cursor,
      endMin: cursor + visitMin,
      durationMin: visitMin,
    });
    cursor += visitMin;

    returnDriveMin = estimateDriveMinutes(input.bonusStop.location, input.origin.location);
    const returnKm = roundOne(estimatedRoadKm(input.bonusStop.location, input.origin.location));
    timeline.push({
      kind: 'return',
      label: `Retour voiture → ${input.origin.name}`,
      startMin: cursor,
      endMin: cursor + returnDriveMin,
      durationMin: returnDriveMin,
      distanceKm: returnKm,
    });
    cursor += returnDriveMin;
  } else {
    timeline.push({
      kind: 'return',
      label: `Retour voiture → ${input.origin.name}`,
      startMin: cursor,
      endMin: cursor + returnDriveMin,
      durationMin: returnDriveMin,
      distanceKm: approachKm,
    });
    cursor += returnDriveMin;
  }

  return {
    timeline,
    totalDriveMin: approachMin + bonusDriveMin + returnDriveMin,
    totalDurationMin: cursor - startClock,
  };
}

/** Traduit la politique chien du catalogue (`leashed`) vers celle d'une rando de voyage (`leash`). */
export function mapCatalogDogPolicy(
  policy: SuggestionResult['dogPolicy'],
): Hike['dogPolicy'] {
  if (policy === 'leashed') return 'leash';
  return policy;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Sérialise la géométrie d'une suggestion en GPX 1.1 valide, sans inventer d'altitude,
 * afin d'être importée dans un voyage et stockée dans le coffre GPX immuable.
 */
export function suggestionToGpxXml(suggestion: SuggestionResult): string {
  const safeName = escapeXml(suggestion.name);
  const safeDesc = escapeXml(
    `${suggestion.provenance.sources.join(' · ')} (${suggestion.provenance.snapshotId})`,
  );
  const points = suggestion.geometry.coordinates
    .map(
      ([lng, lat]) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Itinera" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${safeName}</name>`,
    `    <desc>${safeDesc}</desc>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${safeName}</name>`,
    '    <trkseg>',
    points,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
