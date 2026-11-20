import { describe, expect, it } from 'vitest';
import {
  buildWalkGraph,
  fastDistanceKm,
  findLoopsFromSeed,
  findNearestNode,
  wayWeightMultiplier,
  type TrailWayInput,
} from './loop-generator';
import type { LatLng } from './schema';

/** Grille de chemins carrée de `n × n` nœuds espacés de `stepDeg` (~1,1 km en lat). */
function makeGrid(
  rows: number,
  cols: number,
  stepLat = 0.012,
  stepLng = 0.018,
  override?: (r1: number, c1: number, r2: number, c2: number) => Partial<TrailWayInput>,
): TrailWayInput[] {
  const pt = (r: number, c: number): LatLng => ({ lat: 49.0 + r * stepLat, lng: 1.0 + c * stepLng });
  const ways: TrailWayInput[] = [];
  let id = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        ways.push({
          id: id++,
          coords: [pt(r, c), pt(r, c + 1)],
          highway: 'path',
          surface: 'unpaved',
          dog: 'unknown',
          ...override?.(r, c, r, c + 1),
        });
      }
      if (r + 1 < rows) {
        ways.push({
          id: id++,
          coords: [pt(r, c), pt(r + 1, c)],
          highway: 'track',
          surface: 'unpaved',
          dog: 'unknown',
          ...override?.(r, c, r + 1, c),
        });
      }
    }
  }
  return ways;
}

describe('loop-generator', () => {
  it('pénalise les routes goudronnées par rapport aux sentiers', () => {
    expect(wayWeightMultiplier('path', 'unpaved')).toBeLessThan(wayWeightMultiplier('track', 'unknown'));
    expect(wayWeightMultiplier('track', 'unknown')).toBeLessThan(
      wayWeightMultiplier('unclassified', 'paved'),
    );
  });

  it('coupe les chemins OSM aux intersections partagées et retrouve le nœud le plus proche', () => {
    // Deux chemins en croix qui se croisent en (49.01, 1.01) sans s'y arrêter.
    const graph = buildWalkGraph([
      {
        id: 1,
        coords: [
          { lat: 49.0, lng: 1.01 },
          { lat: 49.01, lng: 1.01 },
          { lat: 49.02, lng: 1.01 },
        ],
        highway: 'path',
        surface: 'unpaved',
        dog: 'unknown',
      },
      {
        id: 2,
        coords: [
          { lat: 49.01, lng: 1.0 },
          { lat: 49.01, lng: 1.01 },
          { lat: 49.01, lng: 1.02 },
        ],
        highway: 'path',
        surface: 'unpaved',
        dog: 'unknown',
      },
    ]);

    const center = findNearestNode(graph, { lat: 49.01, lng: 1.01 }, 0.2);
    expect(center).not.toBeNull();
    expect(graph.adj[center!]!).toHaveLength(4);
    expect(findNearestNode(graph, { lat: 48.0, lng: 0.0 }, 0.5)).toBeNull();
  });

  it('génère une vraie boucle fermée (faible recouvrement) dans la plage demandée', () => {
    const graph = buildWalkGraph(makeGrid(5, 5));
    const seed = { lat: 49.024, lng: 1.036 };
    const loops = findLoopsFromSeed(graph, seed, {
      minKm: 5.5,
      maxKm: 14.5,
      targetKm: 8,
      maxPavedRatio: 0.35,
      maxOverlapRatio: 0.18,
    });

    expect(loops).toHaveLength(1);
    const [loop] = loops;
    expect(loop!.lengthKm).toBeGreaterThanOrEqual(5.5);
    expect(loop!.lengthKm).toBeLessThanOrEqual(14.5);
    expect(loop!.overlapRatio).toBeLessThanOrEqual(0.18);
    expect(loop!.pavedRatio).toBe(0);
    // Fermée : premier et dernier point confondus.
    expect(fastDistanceKm(loop!.points[0]!, loop!.points.at(-1)!)).toBeLessThan(0.01);
  });

  it('rejette un simple aller-retour en impasse (recouvrement 100 %)', () => {
    const deadEnd: TrailWayInput[] = [
      {
        id: 1,
        coords: Array.from({ length: 10 }, (_, i) => ({ lat: 49.0 + i * 0.006, lng: 1.0 })),
        highway: 'path',
        surface: 'unpaved',
        dog: 'unknown',
      },
    ];
    const graph = buildWalkGraph(deadEnd);
    const loops = findLoopsFromSeed(graph, { lat: 49.0, lng: 1.0 });
    expect(loops).toEqual([]);
  });

  it('écarte les boucles trop goudronnées (> maxPavedRatio)', () => {
    const allRoads = makeGrid(4, 4, 0.012, 0.018, () => ({
      highway: 'unclassified',
      surface: 'paved',
    }));
    const graph = buildWalkGraph(allRoads);
    const loops = findLoopsFromSeed(graph, { lat: 49.012, lng: 1.018 }, { maxPavedRatio: 0.3 });
    expect(loops).toEqual([]);
  });
});
