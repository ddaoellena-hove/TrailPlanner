import { z } from 'zod';
import { type Box, corridorBoxes } from '../shared/charging';
import { stationNetwork } from '../shared/charging-networks';
import type { ChargingStation, LatLng } from '../shared/schema';

/** Le fichier national est republié sous un nouvel identifiant : on part toujours du jeu de données. */
const DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/5448d3e0c751df01f85d0572/';
const tabularUrl = (resourceId: string) =>
  `https://tabular-api.data.gouv.fr/api/resources/${resourceId}/data/`;
const PAGE_SIZE = 100;
const CONCURRENT_REQUESTS = 4;
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
    signal: AbortSignal.timeout(10_000),
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

async function fetchRows(resourceId: string, boxes: Box[], minKw: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let index = 0; index < boxes.length; index += CONCURRENT_REQUESTS) {
    const batch = boxes.slice(index, index + CONCURRENT_REQUESTS);
    rows.push(...(await Promise.all(batch.map((box) => fetchBox(resourceId, box, minKw)))).flat());
  }
  return rows;
}

async function fetchFromLatestResource(boxes: Box[], minKw: number): Promise<Row[]> {
  for (const resourceId of await candidateResources()) {
    try {
      return await fetchRows(resourceId, boxes, minKw);
    } catch (error) {
      if (!(error instanceof ResourceGoneError)) throw error;
    }
  }
  throw new Error('IRVE : aucun fichier disponible');
}

/** Bornes des zones traversées, regroupées par station, les plus puissantes d'abord. */
export async function findStations(
  lines: number[][][],
  stops: LatLng[],
  minKw: number,
): Promise<ChargingStation[]> {
  const boxes = corridorBoxes(lines, stops);
  if (boxes.length === 0) return [];
  const rows = await fetchFromLatestResource(boxes, minKw);

  const byStation = new Map<string, Map<string, Row>>();
  for (const row of rows) {
    if (row.consolidated_is_lon_lat_correct === false) continue;
    const station = byStation.get(row.id_station_itinerance) ?? new Map<string, Row>();
    // Deux zones voisines renvoient les mêmes lignes.
    station.set(JSON.stringify(row), row);
    byStation.set(row.id_station_itinerance, station);
  }
  return [...byStation.values()]
    .map((station) => toStation([...station.values()]))
    .filter((station) => station.maxPowerKw >= minKw)
    .sort((a, b) => b.maxPowerKw - a.maxPowerKw);
}
