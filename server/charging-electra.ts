import { z } from 'zod';
import type { ChargingStation } from '../shared/schema';

const OCM_URL = 'https://api.openchargemap.io/v3/poi';
/** Identifiant d'Electra dans Open Charge Map. */
const ELECTRA_OPERATOR_ID = 3489;
const MAX_RESULTS = 2000;
const TIMEOUT_MS = 30_000;
const CACHE_MS = 6 * 60 * 60 * 1000;

const PoiSchema = z.object({
  ID: z.number(),
  NumberOfPoints: z.number().nullable().optional(),
  AddressInfo: z.object({
    Title: z.string().nullable().optional(),
    AddressLine1: z.string().nullable().optional(),
    Town: z.string().nullable().optional(),
    Latitude: z.number(),
    Longitude: z.number(),
  }),
  Connections: z
    .array(
      z.object({
        PowerKW: z.number().nullable().optional(),
        Quantity: z.number().nullable().optional(),
        ConnectionTypeID: z.number().nullable().optional(),
        ConnectionType: z.object({ Title: z.string().nullable().optional() }).nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});
type Poi = z.infer<typeof PoiSchema>;

function connectorsOf(connections: NonNullable<Poi['Connections']>): string[] {
  const titles = connections.map(({ ConnectionType }) => ConnectionType?.Title ?? '').join(' ');
  return [
    ...(/ccs/i.test(titles) ? ['CCS'] : []),
    ...(/type 2/i.test(titles) ? ['Type 2'] : []),
    ...(/chademo/i.test(titles) ? ['CHAdeMO'] : []),
  ];
}

function toStation({ ID, NumberOfPoints, AddressInfo, Connections }: Poi): ChargingStation {
  const connections = Connections ?? [];
  const quantity = connections.reduce((sum, { Quantity }) => sum + (Quantity ?? 1), 0);
  return {
    id: `ocm-${ID}`,
    name: AddressInfo.Title || 'Borne Electra',
    address: [AddressInfo.AddressLine1, AddressInfo.Town].filter(Boolean).join(', '),
    operator: 'Electra',
    network: 'electra',
    location: { lat: AddressInfo.Latitude, lng: AddressInfo.Longitude },
    maxPowerKw: Math.max(0, ...connections.map(({ PowerKW }) => PowerKW ?? 0)),
    points: NumberOfPoints ?? quantity,
    connectors: connectorsOf(connections),
    hours: null,
  };
}

let cache: { at: number; stations: ChargingStation[] } | null = null;

export function clearElectraCache(): void {
  cache = null;
}

/** Toutes les stations Electra de France : absentes de la base IRVE, une requête suffit. */
export async function electraStations(apiKey: string): Promise<ChargingStation[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.stations;
  const params = new URLSearchParams({
    output: 'json',
    countrycode: 'FR',
    operatorid: String(ELECTRA_OPERATOR_ID),
    maxresults: String(MAX_RESULTS),
    compact: 'false',
    verbose: 'false',
  });
  const response = await fetch(`${OCM_URL}?${params}`, {
    headers: { 'x-api-key': apiKey, 'user-agent': 'TrailPlanner/0.1' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Open Charge Map : ${response.status}`);
  const rows: unknown = await response.json();
  const stations = z
    .array(z.unknown())
    .parse(rows)
    .flatMap((row) => {
      const parsed = PoiSchema.safeParse(row);
      return parsed.success ? [toStation(parsed.data)] : [];
    });
  cache = { at: Date.now(), stations };
  return stations;
}
