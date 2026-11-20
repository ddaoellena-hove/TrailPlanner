import type { SuggestionResult } from '../schema';
import type { CatalogMeta, CatalogTrail } from './types';

const pct = (value: number) => `${Math.round(value * 100)} %`;

/**
 * Construit une explication factuelle (points forts, compromis, incertitudes, provenance)
 * exclusivement à partir des mesures du catalogue.
 */
export function buildExplanation(
  trail: CatalogTrail,
  noveltyStatus: SuggestionResult['noveltyStatus'],
  meta: CatalogMeta,
): {
  explanation: SuggestionResult['explanation'];
  provenance: SuggestionResult['provenance'];
} {
  const positives: string[] = [];
  const tradeoffs: string[] = [];

  if (trail.scenicAvg >= 0.4) positives.push('Paysage marqué (forêt, relief ou eau)');
  if (trail.isolationAvg >= 0.45) positives.push('Secteur calme et isolé des grands axes');
  if (trail.heritageAvg >= 0.35) positives.push('Patrimoine ou villages remarquables');
  if (trail.pavedRatio <= 0.15) {
    positives.push(`Très peu de bitume (${pct(trail.pavedRatio)})`);
  }
  if (trail.sourceType === 'osm_relation') {
    positives.push('Itinéraire pédestre balisé dans OpenStreetMap');
  }
  if (noveltyStatus === 'new') {
    positives.push('Secteur jamais parcouru dans « Mes sorties »');
  }

  if (trail.pavedRatio >= 0.3) {
    tradeoffs.push(`Part de bitume notable (${pct(trail.pavedRatio)})`);
  }
  if (trail.sourceType === 'generated_loop') {
    tradeoffs.push('Boucle générée sur le réseau de chemins OSM (non balisée)');
  }
  if (noveltyStatus === 'done_before') {
    tradeoffs.push('Boucle déjà parcourue dans « Mes sorties »');
  } else if (noveltyStatus === 'rejected_before') {
    tradeoffs.push('Déjà écartée lors d’une découverte précédente');
  }
  if (trail.elevationGainMeters !== null && trail.elevationGainMeters >= 400) {
    tradeoffs.push(`Dénivelé soutenu (+${trail.elevationGainMeters} m)`);
  }
  if (trail.kind !== 'loop') {
    tradeoffs.push('Itinéraire non bouclé (retour à prévoir)');
  }

  return {
    explanation: {
      positives,
      tradeoffs,
      uncertainties: [...trail.uncertainties],
    },
    provenance: {
      snapshotId: meta.snapshotId,
      regionName: meta.regionName,
      sources: ['© OpenStreetMap contributors (ODbL)', meta.demSource],
      sourceType: trail.sourceType,
      osmRelationId: trail.osmRelationId,
    },
  };
}
