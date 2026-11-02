import { z } from 'zod';
import { type Box, corridorBoxes } from '../shared/charging';
import { stationNetwork } from '../shared/charging-networks';
import { clearElectraCache, electraStations } from './charging-electra';
import type { ChargingSearch, ChargingStation, LatLng } from '../shared/schema';

/** Le fichier national est republié sous un nouvel identifiant : on part toujours du jeu de données. */
const DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/5448d3e0c751df01f85d0572/';
const tabularUrl = (resourceId: string) =>
  `https://tabular-api.data.gouv.fr/api/resources/${resourceId}/data/`;
const PAGE_SIZE = 100;
const CONCURRENT_REQUESTS = 2;
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 2;
/** La base est republiée chaque jour : une réponse reste valable quelques heures. */
const CACHE_MS = 6 * 60 * 60 * 1000;
const WATTS_THRESHOLD = 1000;

const RowSchema = z.object({
  id_station_itinerance: z.string(),
  nom_station: z.string().nullable(),
  adresse_station: z.string().nullable(),
  nom_operateur: z.string().nullable(),
  nom_enseigne: z.string().nullable(),
  nom_amenageur: z.string().nullable().optional(),
  consolidated_latitude: z.number(),
  consolidated_longitude: z.number(),
  consolidated_is_lon_lat_correct: z.boolean().nullable(),
  puissance_nominale: z.number().nullable(),
  nbre_pdc: z.number().nullable(),
  prise_type_combo_ccs: z.boolean().nullable(),
  prise_type_2: z.boolean().nullable(),
  prise_type_chademo: z.boolean().nullable(),
  horaires: z.string().nullable(),
});
type Row = z.infer<typeof RowSchema>;

const DatasetSchema = z.object({
  resources: z.array(
    z.object({
      id: z.string(),
      format: z.string(),
      type: z.string(),
      last_modified: z.string(),
    }),
  ),
});

/** Le catalogue peut citer un fichier supprimé : on essaie du plus récent au plus ancien. */
async function candidateResources(): Promise<string[]> {
  const response = await fetch(DATASET_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`data.gouv : ${response.status}`);
  const { resources } = DatasetSchema.parse(await response.json());
  return resources
    .filter(({ format, type }) => format === 'csv' && type === 'main')
    .toSorted((a, b) => b.last_modified.localeCompare(a.last_modified))
    .map(({ id }) => id);
}

class ResourceGoneError extends Error {}

/** Certains opérateurs déclarent en W : 22000 veut dire 22 kW. */
function powerKw(row: Row): number {
  const power = row.puissance_nominale ?? 0;
  return power >= WATTS_THRESHOLD ? power / 1000 : power;
}

async function fetchBox(resourceId: string, box: Box, minKw: number): Promise<Row[]> {
  const params = new URLSearchParams({
    consolidated_latitude__greater: String(box.south),
    consolidated_latitude__less: String(box.north),
    consolidated_longitude__greater: String(box.west),
    consolidated_longitude__less: String(box.east),
    puissance_nominale__sort: 'desc',
    page_size: String(PAGE_SIZE),
  });
  // Filtre grossier : le seuil exact s'applique après conversion en kW, dans findStations.
  if (minKw > 0) params.set('puissance_nominale__greater', String(minKw - 1));
  const response = await fetch(`${tabularUrl(resourceId)}?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404 || response.status === 410) throw new ResourceGoneError();
  if (!response.ok) throw new Error(`IRVE : ${response.status}`);
  const { data } = z.object({ data: z.array(z.unknown()) }).parse(await response.json());
  return data.flatMap((row) => {
    const parsed = RowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

function toStation(rows: Row[]): ChargingStation {
  const first = rows[0]!;
  const has = (key: 'prise_type_combo_ccs' | 'prise_type_2' | 'prise_type_chademo') =>
    rows.some((row) => row[key]);
  return {
    id: first.id_station_itinerance,
    name: first.nom_station || first.adresse_station || first.id_station_itinerance,
    address: first.adresse_station ?? '',
    operator: first.nom_enseigne || first.nom_operateur || '',
    network: stationNetwork([
      first.nom_enseigne,
      first.nom_operateur,
      first.nom_amenageur ?? null,
    ]),
    location: { lat: first.consolidated_latitude, lng: first.consolidated_longitude },
    maxPowerKw: Math.max(...rows.map(powerKw)),
    points: Math.max(first.nbre_pdc ?? 0, rows.length),
    connectors: [
      ...(has('prise_type_combo_ccs') ? ['CCS'] : []),
      ...(has('prise_type_2') ? ['Type 2'] : []),
      ...(has('prise_type_chademo') ? ['CHAdeMO'] : []),
    ],
    hours: first.horaires,
  };
}

const boxCache = new Map<string, { at: number; rows: Row[] }>();
let workingResource: string | null = null;

export function clearChargingCache(): void {
  clearElectraCache();
  boxCache.clear();
  workingResource = null;
}

/** Le service peut être lent : un second essai avant d'abandonner la zone. */
async function fetchBoxWithRetry(resourceId: string, box: Box, minKw: number): Promise<Row[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchBox(resourceId, box, minKw);
    } catch (error) {
      if (error instanceof ResourceGoneError || attempt >= ATTEMPTS) throw error;
    }
  }
}

/** Une zone sans réponse n'annule pas les autres : on garde ce qui est arrivé. */
async function fetchRows(resourceId: string, boxes: Box[], minKw: number) {
  const rows: Row[] = [];
  let failed = 0;
  const missing = boxes.flatMap((box) => {
    const cached = boxCache.get(`${JSON.stringify(box)}|${minKw}`);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      rows.push(...cached.rows);
      return [];
    }
    return [box];
  });
  for (let index = 0; index < missing.length; index += CONCURRENT_REQUESTS) {
    const batch = missing.slice(index, index + CONCURRENT_REQUESTS);
    const results = await Promise.allSettled(
      batch.map((box) => fetchBoxWithRetry(resourceId, box, minKw)),
    );
    results.forEach((result, position) => {
      if (result.status === 'fulfilled') {
        const key = `${JSON.stringify(batch[position])}|${minKw}`;
        boxCache.set(key, { at: Date.now(), rows: result.value });
        rows.push(...result.value);
      } else if (result.reason instanceof ResourceGoneError) {
        throw result.reason;
      } else {
        console.warn('Zone de bornes sans réponse :', result.reason);
        failed += 1;
      }
    });
  }
  return { rows, failed };
}

async function fetchFromLatestResource(boxes: Box[], minKw: number) {
  const candidates = workingResource ? [workingResource] : await candidateResources();
  for (const resourceId of candidates) {
    try {
      const result = await fetchRows(resourceId, boxes, minKw);
      workingResource = resourceId;
      return result;
    } catch (error) {
      if (!(error instanceof ResourceGoneError)) throw error;
    }
  }
  // Le fichier mémorisé a pu être remplacé : on repart du catalogue.
  if (workingResource) {
    workingResource = null;
    return fetchFromLatestResource(boxes, minKw);
  }
  throw new Error('IRVE : aucun fichier disponible');
}

/** Une panne d'Open Charge Map rend la liste partielle, sans priver des autres bornes. */
async function electraInBoxes(apiKey: string, boxes: Box[]): Promise<ChargingStation[] | null> {
  try {
    const all = await electraStations(apiKey);
    return all.filter(({ location: { lat, lng } }) =>
      boxes.some(
        (box) => lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east,
      ),
    );
  } catch (error) {
    console.warn('Bornes Electra indisponibles :', error);
    return null;
  }
}

/** Bornes des zones traversées, regroupées par station, les plus puissantes d'abord. */
export async function findStations(
  lines: number[][][],
  stops: LatLng[],
  minKw: number,
  openChargeMapKey?: string,
): Promise<ChargingSearch> {
  const boxes = corridorBoxes(lines, stops);
  if (boxes.length === 0) return { stations: [], incomplete: false };
  const { rows, failed } = await fetchFromLatestResource(boxes, minKw);
  const electra = openChargeMapKey ? await electraInBoxes(openChargeMapKey, boxes) : null;
  if (failed === boxes.length && !electra?.length) {
    throw new Error('IRVE : aucune zone n’a répondu');
  }

  const byStation = new Map<string, Map<string, Row>>();
  for (const row of rows) {
    if (row.consolidated_is_lon_lat_correct === false) continue;
    const station = byStation.get(row.id_station_itinerance) ?? new Map<string, Row>();
    // Deux zones voisines renvoient les mêmes lignes.
    station.set(JSON.stringify(row), row);
    byStation.set(row.id_station_itinerance, station);
  }
  const stations: ChargingStation[] = [
    ...[...byStation.values()].map((station) => toStation([...station.values()])),
    ...(electra ?? []),
  ]
    .filter((station) => station.maxPowerKw >= minKw)
    .sort((a, b) => b.maxPowerKw - a.maxPowerKw);
  return { stations, incomplete: failed > 0 || (openChargeMapKey !== undefined && !electra) };
}
