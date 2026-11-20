/**
 * Génération pure de boucles pédestres à partir du graphe de chemins OSM
 * (étape 4b de VAGARI-PLAN.md). Complète les relations OSM balisées là où
 * elles manquent (ex. Eure, Pays de Caux) sans jamais masquer leur origine.
 */
import type { DogAccess, Surface } from './catalog';
import type { LatLng } from './schema';

export type TrailWayInput = {
  id: number;
  coords: LatLng[];
  highway: string;
  surface: Surface;
  dog: DogAccess;
};

export type WalkEdge = {
  /** Identifiant partagé par les deux sens d'un même tronçon (pour mesurer le recouvrement). */
  segmentId: number;
  from: number;
  to: number;
  coords: LatLng[];
  lengthKm: number;
  cost: number;
  surface: Surface;
  dog: DogAccess;
  highway: string;
};

export type WalkGraph = {
  nodes: LatLng[];
  adj: WalkEdge[][];
  /** Grille spatiale (~1 km) pour trouver le nœud le plus proche en O(1). */
  grid: Map<string, number[]>;
};

export type GeneratedLoop = {
  points: LatLng[];
  lengthKm: number;
  pavedRatio: number;
  surfaceUnknownRatio: number;
  overlapRatio: number;
  dogWays: DogAccess[];
  bearingDeg: number;
  midpoint: LatLng;
};

export type LoopSearchOptions = {
  minKm?: number;
  maxKm?: number;
  targetKm?: number;
  maxPavedRatio?: number;
  maxOverlapRatio?: number;
  maxSnapKm?: number;
  maxLoops?: number;
};

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

/** Distance haversine sans allocation GeoJSON, pour parcourir des graphes OSM de > 100 k arêtes. */
export function fastDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pénalise fortement les routes goudronnées pour privilégier sentiers et chemins ruraux. */
export function wayWeightMultiplier(highway: string, surface: Surface): number {
  if (highway === 'path' || highway === 'bridleway') return surface === 'paved' ? 1.6 : 1.0;
  if (highway === 'track') {
    if (surface === 'unpaved') return 1.05;
    if (surface === 'unknown') return 1.2;
    return 1.8;
  }
  if (highway === 'footway' || highway === 'steps') return surface === 'paved' ? 1.6 : 1.25;
  if (highway === 'cycleway' || highway === 'pedestrian' || highway === 'living_street') return 1.9;
  // Petites routes rurales : pénalisées par rapport aux sentiers, mais autorisées comme liaisons.
  if (highway === 'unclassified') return surface === 'unpaved' ? 1.4 : 2.6;
  // Voies résidentielles et desserte : uniquement comme courts raccords.
  return surface === 'unpaved' ? 1.5 : 3.8;
}

const nodeKey = (p: LatLng) => `${Math.round(p.lat * 1e5)},${Math.round(p.lng * 1e5)}`;
const gridKey = (lat: number, lng: number) => `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;

/**
 * Construit le graphe pédestre non orienté en coupant chaque chemin OSM à ses
 * intersections (tout sommet partagé par au moins deux chemins ou visité deux fois).
 */
export function buildWalkGraph(ways: TrailWayInput[]): WalkGraph {
  const counts = new Map<string, number>();
  for (const way of ways) {
    if (way.coords.length < 2) continue;
    for (const p of way.coords) {
      const k = nodeKey(p);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const nodes: LatLng[] = [];
  const adj: WalkEdge[][] = [];
  const nodeIndex = new Map<string, number>();
  const grid = new Map<string, number[]>();

  const getOrAddNode = (p: LatLng): number => {
    const k = nodeKey(p);
    const existing = nodeIndex.get(k);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push(p);
    adj.push([]);
    nodeIndex.set(k, id);
    const gk = gridKey(p.lat, p.lng);
    const bucket = grid.get(gk);
    if (bucket) bucket.push(id);
    else grid.set(gk, [id]);
    return id;
  };

  let segmentId = 0;

  for (const way of ways) {
    if (way.coords.length < 2) continue;
    const mult = wayWeightMultiplier(way.highway, way.surface);
    let segStart = 0;

    for (let i = 1; i < way.coords.length; i++) {
      const isLast = i === way.coords.length - 1;
      const isJunction = (counts.get(nodeKey(way.coords[i]!)) ?? 0) >= 2;
      if (!isLast && !isJunction) continue;

      const slice = way.coords.slice(segStart, i + 1);
      let lengthKm = 0;
      for (let j = 1; j < slice.length; j++) {
        lengthKm += fastDistanceKm(slice[j - 1]!, slice[j]!);
      }
      if (lengthKm > 0.001) {
        const from = getOrAddNode(slice[0]!);
        const to = getOrAddNode(slice.at(-1)!);
        if (from !== to || lengthKm >= 0.5) {
          const id = segmentId++;
          const cost = lengthKm * mult;
          adj[from]!.push({
            segmentId: id,
            from,
            to,
            coords: slice,
            lengthKm,
            cost,
            surface: way.surface,
            dog: way.dog,
            highway: way.highway,
          });
          if (from !== to) {
            adj[to]!.push({
              segmentId: id,
              from: to,
              to: from,
              coords: [...slice].reverse(),
              lengthKm,
              cost,
              surface: way.surface,
              dog: way.dog,
              highway: way.highway,
            });
          }
        }
      }
      segStart = i;
    }
  }

  return { nodes, adj, grid };
}

class MinHeap<T> {
  private readonly items: { priority: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(priority: number, value: T): void {
    const items = this.items;
    items.push({ priority, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.priority <= items[i]!.priority) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): { priority: number; value: T } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      while (true) {
        const left = (i << 1) + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left]!.priority < items[smallest]!.priority) smallest = left;
        if (right < items.length && items[right]!.priority < items[smallest]!.priority) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

/** Trouve le nœud du graphe le plus proche dans `maxSnapKm`, en privilégiant un carrefour (degré ≥ 2). */
export function findNearestNode(graph: WalkGraph, target: LatLng, maxSnapKm = 0.5): number | null {
  const latCell = Math.floor(target.lat * 100);
  const lngCell = Math.floor(target.lng * 100);
  const radiusCells = Math.max(1, Math.ceil(maxSnapKm));
  let best: number | null = null;
  let bestScore = Infinity;

  for (let dLat = -radiusCells; dLat <= radiusCells; dLat++) {
    for (let dLng = -radiusCells; dLng <= radiusCells; dLng++) {
      const bucket = graph.grid.get(`${latCell + dLat},${lngCell + dLng}`);
      if (!bucket) continue;
      for (const id of bucket) {
        const d = fastDistanceKm(target, graph.nodes[id]!);
        if (d > maxSnapKm) continue;
        // Légère préférence pour un nœud de degré ≥ 2 (évite les impasses).
        const degreePenalty = graph.adj[id]!.length >= 2 ? 0 : 0.15;
        if (d + degreePenalty < bestScore) {
          bestScore = d + degreePenalty;
          best = id;
        }
      }
    }
  }
  return best;
}

type SearchTree = {
  cost: Map<number, number>;
  distKm: Map<number, number>;
  pavedKm: Map<number, number>;
  prevNode: Map<number, number>;
  prevEdge: Map<number, WalkEdge>;
};

function dijkstraOutbound(graph: WalkGraph, start: number, maxDistKm: number, maxCost: number): SearchTree {
  const cost = new Map<number, number>([[start, 0]]);
  const distKm = new Map<number, number>([[start, 0]]);
  const pavedKm = new Map<number, number>([[start, 0]]);
  const prevNode = new Map<number, number>();
  const prevEdge = new Map<number, WalkEdge>();
  const heap = new MinHeap<number>();
  heap.push(0, start);

  while (heap.size > 0) {
    const current = heap.pop()!;
    const u = current.value;
    if (current.priority > (cost.get(u) ?? Infinity)) continue;
    const uDist = distKm.get(u)!;
    const uPaved = pavedKm.get(u)!;

    for (const edge of graph.adj[u]!) {
      const nextDist = uDist + edge.lengthKm;
      if (nextDist > maxDistKm) continue;
      const nextCost = current.priority + edge.cost;
      if (nextCost > maxCost) continue;
      if (nextCost < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, nextCost);
        distKm.set(edge.to, nextDist);
        pavedKm.set(edge.to, uPaved + (edge.surface === 'paved' ? edge.lengthKm : 0));
        prevNode.set(edge.to, u);
        prevEdge.set(edge.to, edge);
        heap.push(nextCost, edge.to);
      }
    }
  }

  return { cost, distKm, pavedKm, prevNode, prevEdge };
}

function reconstructEdges(tree: SearchTree, start: number, target: number): WalkEdge[] | null {
  const edges: WalkEdge[] = [];
  let current = target;
  while (current !== start) {
    const edge = tree.prevEdge.get(current);
    const prev = tree.prevNode.get(current);
    if (!edge || prev === undefined) return null;
    edges.push(edge);
    current = prev;
  }
  edges.reverse();
  return edges;
}

/** Retour `from → target` en pénalisant fortement les arêtes et nœuds de l'aller pour former une vraie boucle. */
function dijkstraReturn(
  graph: WalkGraph,
  from: number,
  target: number,
  usedSegments: Set<number>,
  usedInteriorNodes: Set<number>,
  maxDistKm: number,
): WalkEdge[] | null {
  const cost = new Map<number, number>([[from, 0]]);
  const distKm = new Map<number, number>([[from, 0]]);
  const prevNode = new Map<number, number>();
  const prevEdge = new Map<number, WalkEdge>();
  const heap = new MinHeap<number>();
  heap.push(0, from);

  while (heap.size > 0) {
    const current = heap.pop()!;
    const u = current.value;
    if (u === target) {
      return reconstructEdges({ cost, distKm, pavedKm: new Map(), prevNode, prevEdge }, from, target);
    }
    if (current.priority > (cost.get(u) ?? Infinity)) continue;
    const uDist = distKm.get(u)!;

    for (const edge of graph.adj[u]!) {
      const nextDist = uDist + edge.lengthKm;
      if (nextDist > maxDistKm) continue;
      let edgeCost = edge.cost;
      if (usedSegments.has(edge.segmentId)) {
        edgeCost *= 18;
      } else if (usedInteriorNodes.has(edge.to)) {
        edgeCost *= 3;
      }
      const nextCost = current.priority + edgeCost;
      if (nextCost < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, nextCost);
        distKm.set(edge.to, nextDist);
        prevNode.set(edge.to, u);
        prevEdge.set(edge.to, edge);
        heap.push(nextCost, edge.to);
      }
    }
  }

  return null;
}

function bearingDegrees(from: LatLng, to: LatLng): number {
  const dLng = (to.lng - from.lng) * DEG;
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/**
 * Génère des boucles pédestres propres (5,5–14,5 km, peu goudronnées, faible recouvrement aller/retour)
 * autour d'un point de départ dans le graphe OSM.
 */
export function findLoopsFromSeed(
  graph: WalkGraph,
  seed: LatLng,
  options: LoopSearchOptions = {},
): GeneratedLoop[] {
  const minKm = options.minKm ?? 5.5;
  const maxKm = options.maxKm ?? 14.5;
  const targetKm = options.targetKm ?? 9.5;
  const maxPavedRatio = options.maxPavedRatio ?? 0.35;
  const maxOverlapRatio = options.maxOverlapRatio ?? 0.18;
  const maxSnapKm = options.maxSnapKm ?? 0.5;
  const maxLoops = options.maxLoops ?? 1;

  const startNode = findNearestNode(graph, seed, maxSnapKm);
  if (startNode === null) return [];
  const startCoord = graph.nodes[startNode]!;

  const maxOutboundKm = maxKm * 0.58;
  const tree = dijkstraOutbound(graph, startNode, maxOutboundKm, maxOutboundKm * 3.5);

  // Sélectionne le meilleur point de demi-tour par secteur de 45° (8 directions).
  const minOutboundKm = minKm * 0.42;
  const minCrowKm = minKm * 0.22;
  const bestBySector = new Map<number, { node: number; rank: number; bearing: number }>();

  for (const [node, outDist] of tree.distKm) {
    if (node === startNode || outDist < minOutboundKm || outDist > maxOutboundKm) continue;
    const pavedShare = (tree.pavedKm.get(node) ?? 0) / outDist;
    if (pavedShare > maxPavedRatio + 0.1) continue;
    const coord = graph.nodes[node]!;
    const crowKm = fastDistanceKm(startCoord, coord);
    if (crowKm < minCrowKm) continue;

    const bearing = bearingDegrees(startCoord, coord);
    const sector = Math.floor(bearing / 45) % 8;
    const distFit = Math.abs(outDist - targetKm / 2) / (targetKm / 2);
    // Favorise les chemins peu goudronnés et bien étendus dans le paysage.
    const rank = (1 - pavedShare) * 1.4 + Math.min(1, crowKm / (outDist * 0.7)) * 0.4 - distFit * 0.5;
    const prev = bestBySector.get(sector);
    if (!prev || rank > prev.rank) bestBySector.set(sector, { node, rank, bearing });
  }

  const candidates: (GeneratedLoop & { rank: number })[] = [];
  const sectors = [...bestBySector.values()].sort((a, b) => b.rank - a.rank);

  for (const { node: midNode, bearing } of sectors) {
    const outEdges = reconstructEdges(tree, startNode, midNode);
    if (!outEdges || outEdges.length === 0) continue;
    const outKm = tree.distKm.get(midNode)!;

    const usedSegments = new Set(outEdges.map((e) => e.segmentId));
    const interiorNodes = new Set<number>();
    for (const edge of outEdges) {
      if (edge.to !== startNode && edge.to !== midNode) interiorNodes.add(edge.to);
    }

    const retEdges = dijkstraReturn(
      graph,
      midNode,
      startNode,
      usedSegments,
      interiorNodes,
      maxKm - outKm + 0.2,
    );
    if (!retEdges || retEdges.length === 0) continue;

    const allEdges = [...outEdges, ...retEdges];
    const lengthKm = allEdges.reduce((sum, e) => sum + e.lengthKm, 0);
    if (lengthKm < minKm || lengthKm > maxKm) continue;

    const overlapKm = retEdges
      .filter((e) => usedSegments.has(e.segmentId))
      .reduce((sum, e) => sum + e.lengthKm, 0);
    const overlapRatio = overlapKm / lengthKm;
    if (overlapRatio > maxOverlapRatio) continue;

    const pavedKm = allEdges
      .filter((e) => e.surface === 'paved')
      .reduce((sum, e) => sum + e.lengthKm, 0);
    const unknownKm = allEdges
      .filter((e) => e.surface === 'unknown')
      .reduce((sum, e) => sum + e.lengthKm, 0);
    const pavedRatio = pavedKm / lengthKm;
    if (pavedRatio > maxPavedRatio) continue;

    const points: LatLng[] = [];
    for (const edge of allEdges) {
      if (points.length === 0) points.push(...edge.coords);
      else points.push(...edge.coords.slice(1));
    }

    const distFit = Math.abs(lengthKm - targetKm) / targetKm;
    const rank = (1 - pavedRatio) * 1.5 - overlapRatio * 2 - distFit * 0.4;
    candidates.push({
      points,
      lengthKm,
      pavedRatio,
      surfaceUnknownRatio: unknownKm / lengthKm,
      overlapRatio,
      dogWays: allEdges.map((e) => e.dog),
      bearingDeg: bearing,
      midpoint: graph.nodes[midNode]!,
      rank,
    });
  }

  candidates.sort((a, b) => b.rank - a.rank);

  // Garde les meilleures boucles dans des directions distinctes (≥ 90° d'écart si > 1).
  const picked: GeneratedLoop[] = [];
  for (const candidate of candidates) {
    const angularGap = (a: number, b: number) => {
      const diff = Math.abs(a - b) % 360;
      return diff > 180 ? 360 - diff : diff;
    };
    if (picked.some((p) => angularGap(p.bearingDeg, candidate.bearingDeg) < 90)) continue;
    const { rank: _unused, ...loop } = candidate;
    void _unused;
    picked.push(loop);
    if (picked.length >= maxLoops) break;
  }

  return picked;
}
