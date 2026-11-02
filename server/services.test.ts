import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place, Trip } from '../shared/schema';
import { addPlaceStop } from '../shared/trip';
import { clearChargingCache, findStations } from './charging';
import { findPois, overpassQuery, toPois } from './poi';
import { tripWeather } from './weather';
import { MapLinkError, resolveMapLink } from './map-link';
import { geocode } from './geocode';
import { checkKeys } from './health';
import { computeItinerary } from './routing';
import { TripStore } from './trip-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function lodging(lat: number, lng: number): Place {
  return { id: crypto.randomUUID(), type: 'lodging', name: 'Lieu', location: { lat, lng } };
}

const orsBody = {
  features: [
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [6, 44],
          [6.5, 44.5],
        ],
      },
      properties: { summary: { distance: 90_000, duration: 5400 } },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geocode', () => {
  it('n’appelle pas le service sous 3 caractères', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await geocode(' ga ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dédoublonne et garde l’ordre de pertinence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          results: [
            { fulltext: 'Gap, 05000', x: 6.08, y: 44.56 },
            { fulltext: 'Gap, 05000', x: 6.07, y: 44.55 },
            { fulltext: 'Gaillac, 81600', x: 1.9, y: 43.9 },
          ],
        }),
      ),
    );
    const results = await geocode('gap');
    expect(results.map((result) => result.label)).toEqual(['Gap, 05000', 'Gaillac, 81600']);
    expect(results[0]?.location).toEqual({ lat: 44.56, lng: 6.08 });
  });
});

describe('computeItinerary', () => {
  let dir: string;
  let store: TripStore;
  let trip: Trip;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'trailplanner-'));
    store = new TripStore(dir);
    const created = await store.create({
      name: 'Test',
      startDate: '2027-07-01',
      endDate: '2027-07-01',
      withDog: false,
    });
    trip = addPlaceStop(addPlaceStop(created, 1, lodging(44, 6)), 1, lodging(44.5, 6.5));
    await store.save(trip);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passe par l’IGN sans clé et met le trajet en cache', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      json({
        distance: 104.4,
        duration: 95.5,
        geometry: orsBody.features[0]!.geometry,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { legs } = await computeItinerary(store, trip.slug, undefined);
    await computeItinerary(store, trip.slug, undefined);

    expect(legs[0]).toMatchObject({ source: 'ign', distanceKm: 104.4, durationMin: 95.5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.searchParams.get('start')).toBe('6,44');
    expect(url.searchParams.get('end')).toBe('6.5,44.5');
  });

  it('se replie sur la ligne droite si l’IGN échoue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: {} }, 500)));
    const { legs } = await computeItinerary(store, trip.slug, undefined);
    expect(legs[0]?.source).toBe('straight-line-fallback');
  });

  it('convertit la réponse ORS et ne rappelle pas ORS pour un trajet en cache', async () => {
    const fetchMock = vi.fn(async () => json(orsBody));
    vi.stubGlobal('fetch', fetchMock);

    const first = await computeItinerary(store, trip.slug, 'cle');
    const second = await computeItinerary(store, trip.slug, 'cle');

    expect(first.legs[0]).toMatchObject({ source: 'ors', distanceKm: 90, durationMin: 90 });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recalcule malgré le cache quand on actualise', async () => {
    const fetchMock = vi.fn(async () => json(orsBody));
    vi.stubGlobal('fetch', fetchMock);

    await computeItinerary(store, trip.slug, 'cle');
    await computeItinerary(store, trip.slug, 'cle', { refresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('se replie sur erreur ORS et retente au calcul suivant', async () => {
    const fetchMock = vi.fn(async () => json({}, 500));
    vi.stubGlobal('fetch', fetchMock);
    const { legs } = await computeItinerary(store, trip.slug, 'cle');
    expect(legs[0]?.source).toBe('straight-line-fallback');

    fetchMock.mockImplementation(async () => json(orsBody));
    expect((await computeItinerary(store, trip.slug, 'cle')).legs[0]?.source).toBe('ors');
  });

  it('réessaie après un 429', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValue(json(orsBody));
    vi.stubGlobal('fetch', fetchMock);

    const pending = computeItinerary(store, trip.slug, 'cle');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();

    expect((await pending).legs[0]?.source).toBe('ors');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('checkKeys', () => {
  const notion = (me: () => Promise<unknown>) => ({ users: { me } }) as never;

  it('signale les clés manquantes sans rien appeler', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkKeys(undefined, undefined)).toEqual({
      ors: 'missing',
      notion: 'missing',
      assistant: 'missing',
      assistantProviders: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('repère une clé refusée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 403)));
    const refused = Object.assign(new Error('refus'), { status: 401 });
    const result = await checkKeys('cle', notion(() => Promise.reject(refused)));
    expect(result).toMatchObject({ ors: 'invalid', notion: 'invalid' });
  });

  it('ne déclare pas une clé invalide sur panne réseau', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('réseau'))));
    const down = notion(() => Promise.reject(new Error('réseau')));
    expect(await checkKeys('cle', down, ['openai'])).toEqual({
      ors: 'configured',
      notion: 'configured',
      assistant: 'configured',
      assistantProviders: ['openai'],
    });
  });
});

describe('findStations', () => {
  beforeEach(clearChargingCache);

  const row = (overrides: Record<string, unknown>) => ({
    id_station_itinerance: 'FR1',
    nom_station: 'Gap Centre',
    adresse_station: '1 rue de Gap',
    nom_operateur: 'Opérateur',
    nom_enseigne: 'Enseigne',
    consolidated_latitude: 44.56,
    consolidated_longitude: 6.08,
    consolidated_is_lon_lat_correct: true,
    puissance_nominale: 22,
    nbre_pdc: 4,
    prise_type_combo_ccs: false,
    prise_type_2: true,
    prise_type_chademo: false,
    horaires: '24/7',
    ...overrides,
  });

  const dataset = {
    resources: [
      { id: 'ancien', format: 'csv', type: 'main', last_modified: '2026-11-01T04:00:00' },
      { id: 'doc', format: 'csv', type: 'documentation', last_modified: '2026-11-03T04:00:00' },
      { id: 'geo', format: 'geojson', type: 'main', last_modified: '2026-11-03T04:00:00' },
      { id: 'recent', format: 'csv', type: 'main', last_modified: '2026-11-02T04:00:00' },
    ],
  };

  const respond = (rows: unknown[]) =>
    vi.fn(async (url: string) =>
      url.includes('/datasets/') ? json(dataset) : json({ data: rows, meta: {} }),
    );

  it('regroupe les points de charge par station', async () => {
    vi.stubGlobal(
      'fetch',
      respond([
        row({ puissance_nominale: 150, prise_type_combo_ccs: true }),
        row({ puissance_nominale: 22 }),
        row({ id_station_itinerance: 'FR2', nom_station: 'Autre', puissance_nominale: 60 }),
      ]),
    );

    const { stations } = await findStations([], [{ lat: 44.56, lng: 6.08 }], 0);

    expect(stations.map(({ id }) => id)).toEqual(['FR1', 'FR2']);
    expect(stations[0]).toMatchObject({
      maxPowerKw: 150,
      points: 4,
      connectors: ['CCS', 'Type 2'],
      location: { lat: 44.56, lng: 6.08 },
    });
  });

  it('reconnaît le réseau d’une station, y compris par son aménageur', async () => {
    vi.stubGlobal(
      'fetch',
      respond([
        row({ nom_enseigne: 'Autre', nom_operateur: 'Autre', nom_amenageur: 'Izivia Express' }),
        row({ id_station_itinerance: 'FR2', nom_enseigne: 'Autre', nom_operateur: 'Autre' }),
      ]),
    );
    const { stations } = await findStations([], [{ lat: 44.56, lng: 6.08 }], 0);
    expect(stations.map(({ id, network }) => [id, network])).toEqual([
      ['FR1', 'izivia'],
      ['FR2', null],
    ]);
  });

  it('ramène en kW les puissances saisies en W et filtre après conversion', async () => {
    vi.stubGlobal(
      'fetch',
      respond([
        row({ puissance_nominale: 50000 }),
        row({ id_station_itinerance: 'FR2', puissance_nominale: 22 }),
      ]),
    );
    const { stations } = await findStations([], [{ lat: 44.56, lng: 6.08 }], 50);
    expect(stations.map(({ id, maxPowerKw }) => [id, maxPowerKw])).toEqual([['FR1', 50]]);
  });

  it('écarte les coordonnées signalées incorrectes', async () => {
    vi.stubGlobal('fetch', respond([row({ consolidated_is_lon_lat_correct: false })]));
    expect((await findStations([], [{ lat: 44.56, lng: 6.08 }], 0)).stations).toEqual([]);
  });

  it('interroge chaque zone une seule fois, et rien sans zone', async () => {
    const fetchMock = respond([]);
    vi.stubGlobal('fetch', fetchMock);
    await findStations([], [], 0);
    expect(fetchMock).not.toHaveBeenCalled();
    const here = { lat: 44.56, lng: 6.08 };
    await findStations([], [here, here], 50);
    const tabular = fetchMock.mock.calls.filter(([url]) => url.includes('tabular-api'));
    expect(tabular).toHaveLength(1);
    expect(tabular[0]![0]).toContain('/resources/recent/');
  });

  it('passe au fichier suivant si le plus récent a été supprimé', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/datasets/')) return json(dataset);
      if (url.includes('/recent/')) return new Response('supprimé', { status: 410 });
      return json({ data: [row({})], meta: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { stations } = await findStations([], [{ lat: 44.56, lng: 6.08 }], 0);
    expect(stations.map(({ id }) => id)).toEqual(['FR1']);
  });

  const two = [
    { lat: 44.56, lng: 6.08 },
    { lat: 45.5, lng: 6.5 },
  ];

  it('garde les zones qui répondent quand une autre expire', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/datasets/')) return json(dataset);
        if (url.includes('45.45')) throw new DOMException('expiré', 'TimeoutError');
        return json({ data: [row({})], meta: {} });
      }),
    );
    const result = await findStations([], two, 0);
    expect(result.incomplete).toBe(true);
    expect(result.stations.map(({ id }) => id)).toEqual(['FR1']);
  });

  it('réessaie une zone lente avant de l’abandonner', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/datasets/')) return json(dataset);
        calls += 1;
        if (calls === 1) throw new DOMException('expiré', 'TimeoutError');
        return json({ data: [row({})], meta: {} });
      }),
    );
    const result = await findStations([], [two[0]!], 0);
    expect(result).toMatchObject({ incomplete: false });
    expect(calls).toBe(2);
  });

  it('échoue seulement si aucune zone ne répond', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/datasets/')) return json(dataset);
        throw new DOMException('expiré', 'TimeoutError');
      }),
    );
    await expect(findStations([], two, 0)).rejects.toThrow(/aucune zone/);
  });

  it('ne rappelle pas le service pour une zone déjà connue', async () => {
    const fetchMock = respond([row({})]);
    vi.stubGlobal('fetch', fetchMock);
    await findStations([], [two[0]!], 0);
    const after = fetchMock.mock.calls.length;
    await findStations([], [two[0]!], 0);
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  it('repart du catalogue si le fichier mémorisé disparaît', async () => {
    let gone = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/datasets/')) return json(dataset);
      if (gone && url.includes('/recent/')) return new Response('', { status: 410 });
      return json({ data: [row({})], meta: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    await findStations([], [two[0]!], 0);
    gone = true;
    const result = await findStations([], [two[1]!], 0);
    expect(result.stations).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/ancien/'))).toBe(true);
  });

  const electraPoi = {
    ID: 7,
    NumberOfPoints: 6,
    AddressInfo: { Title: 'Electra - Gap', Town: 'Gap', Latitude: 44.56, Longitude: 6.08 },
    Connections: [
      { PowerKW: 300, Quantity: 4, ConnectionType: { Title: 'CCS (Type 2)' } },
      { PowerKW: 22, Quantity: 2, ConnectionType: { Title: 'Type 2 (Socket Only)' } },
    ],
  };
  const farPoi = {
    ...electraPoi,
    ID: 8,
    AddressInfo: { ...electraPoi.AddressInfo, Latitude: 48.85, Longitude: 2.35 },
  };
  const withElectra = (poi: () => Response) =>
    vi.fn(async (url: string) => {
      if (url.includes('openchargemap')) return poi();
      if (url.includes('/datasets/')) return json(dataset);
      return json({ data: [], meta: {} });
    });

  it('ajoute les stations Electra des zones du voyage, sans les autres', async () => {
    vi.stubGlobal('fetch', withElectra(() => json([electraPoi, farPoi])));
    const { stations, incomplete } = await findStations([], [two[0]!], 50, 'cle');
    expect(incomplete).toBe(false);
    expect(stations).toEqual([
      expect.objectContaining({
        id: 'ocm-7',
        name: 'Electra - Gap',
        network: 'electra',
        maxPowerKw: 300,
        points: 6,
        connectors: ['CCS', 'Type 2'],
      }),
    ]);
  });

  it('envoie la clé en en-tête, et ne rappelle pas Electra pour chaque recherche', async () => {
    const fetchMock = withElectra(() => json([electraPoi]));
    vi.stubGlobal('fetch', fetchMock);
    await findStations([], [two[0]!], 0, 'cle');
    await findStations([], [two[1]!], 0, 'cle');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const ocm = calls.filter(([url]) => url.includes('openchargemap'));
    expect(ocm).toHaveLength(1);
    expect(ocm[0]![0]).not.toContain('cle');
    expect(ocm[0]![1].headers).toMatchObject({ 'x-api-key': 'cle' });
  });

  it('applique le filtre de puissance à Electra', async () => {
    vi.stubGlobal('fetch', withElectra(() => json([electraPoi])));
    expect((await findStations([], [two[0]!], 350, 'cle')).stations).toEqual([]);
  });

  it('n’appelle pas Open Charge Map sans clé', async () => {
    const fetchMock = withElectra(() => json([electraPoi]));
    vi.stubGlobal('fetch', fetchMock);
    await findStations([], [two[0]!], 0);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('openchargemap'))).toBe(false);
  });

  it('garde les autres bornes si Open Charge Map tombe, et le signale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('openchargemap')) return json({}, 500);
        if (url.includes('/datasets/')) return json(dataset);
        return json({ data: [row({})], meta: {} });
      }),
    );
    const result = await findStations([], [two[0]!], 0, 'cle');
    expect(result.incomplete).toBe(true);
    expect(result.stations.map(({ id }) => id)).toEqual(['FR1']);
  });

  it('signale l’échec si aucun fichier ne répond', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/datasets/') ? json(dataset) : new Response('', { status: 410 }),
      ),
    );
    await expect(findStations([], [{ lat: 44.56, lng: 6.08 }], 0)).rejects.toThrow(/aucun fichier/);
  });
});

describe('resolveMapLink', () => {
  const redirect = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  it('lit un lien long sans aucun appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const link = await resolveMapLink(
      'https://www.google.com/maps/place/Borne+Gap/@44.5,6.0,17z/data=!3d44.5612!4d6.0811',
    );
    expect(link).toMatchObject({
      name: 'Borne Gap',
      location: { lat: 44.5612, lng: 6.0811 },
      approximate: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suit un lien court jusqu’à la position, sans lire de page', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValue(
        redirect('https://www.google.com/maps/place/Lidl/data=!3d45.1!4d6.2?g_st=ic'),
      );
    vi.stubGlobal('fetch', fetchMock);
    const link = await resolveMapLink('https://maps.app.goo.gl/AbCd123');
    expect(link.location).toEqual({ lat: 45.1, lng: 6.2 });
    expect(link.url).toBe('https://maps.app.goo.gl/AbCd123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('traverse l’écran de consentement', async () => {
    const target = encodeURIComponent('https://www.google.com/maps/@45.2,6.3,15z');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => redirect(`https://consent.google.com/m?continue=${target}`)),
    );
    expect((await resolveMapLink('https://maps.app.goo.gl/x')).location).toEqual({
      lat: 45.2,
      lng: 6.3,
    });
  });

  it('refuse de suivre une redirection hors de Google', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => redirect('http://127.0.0.1:5174/api/settings')));
    await expect(resolveMapLink('https://maps.app.goo.gl/x')).rejects.toThrow(MapLinkError);
  });

  it('refuse un lien qui n’est pas Google Maps, sans l’appeler', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveMapLink('https://evil.example/maps')).rejects.toThrow(/Google Maps/);
    await expect(resolveMapLink('https://google.com.evil.example/')).rejects.toThrow(/Google Maps/);
    await expect(resolveMapLink('pas un lien')).rejects.toThrow(/adresse web/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('géocode une recherche sans coordonnées et le signale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ results: [{ fulltext: 'Gap, 05000', x: 6.08, y: 44.56 }] })),
    );
    const link = await resolveMapLink('https://www.google.com/maps?q=Gap');
    expect(link).toMatchObject({ approximate: true, location: { lat: 44.56, lng: 6.08 } });
  });
});

describe('tripWeather', () => {
  const base = (date: string): Trip => {
    const stop = { id: crypto.randomUUID(), kind: 'place' as const, placeId: 'x' };
    const place = lodging(45, 6);
    return {
      startDate: date,
      endDate: date,
      hikes: [],
      places: [place],
      days: [
        { date, index: 1, stops: [{ ...stop, placeId: place.id }], backupHikeIds: [] },
      ],
    } as unknown as Trip;
  };

  it('annonce la date de prévision pour un jour trop lointain, sans appel', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await tripWeather(base('2026-12-10'), '2026-11-02')).toEqual({
      1: { status: 'later', availableFrom: '2026-11-25' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rend la prévision du jour', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        daily: {
          temperature_2m_max: [3],
          temperature_2m_min: [-4],
          precipitation_sum: [5],
          wind_speed_10m_max: [40],
          weather_code: [73],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const weather = await tripWeather(base('2026-11-05'), '2026-11-02');
    expect(weather[1]).toMatchObject({ status: 'forecast', tempMinC: -4, code: 73 });
  });

  it('reste utilisable en cas de panne', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    expect(await tripWeather(base('2026-11-06'), '2026-11-02')).toEqual({
      1: { status: 'unavailable' },
    });
  });

  it('ignore un jour passé', async () => {
    expect(await tripWeather(base('2026-10-01'), '2026-11-02')).toEqual({});
  });
});

describe('points utiles', () => {
  const hike = {
    stats: { profile: [{ distKm: 0, altM: 1000, lat: 45, lng: 6 }] },
  };
  const trip = { slug: 'test', hikes: [hike] } as unknown as Trip;
  const element = {
    type: 'node',
    id: 1,
    lat: 45.01,
    lon: 6.01,
    tags: { amenity: 'drinking_water' },
  };
  const memoryStore = () => {
    let cache: Awaited<ReturnType<TripStore['readPoiCache']>> = null;
    return {
      readPoiCache: async () => cache,
      writePoiCache: async (_slug: string, value: typeof cache) => {
        cache = value;
      },
    } as unknown as TripStore;
  };

  it('nomme un point sans nom et ignore le reste', () => {
    const pois = toPois([
      element,
      { type: 'way', id: 2, center: { lat: 45, lon: 6 }, tags: { tourism: 'alpine_hut', name: 'Refuge X' } },
      { type: 'node', id: 3, lat: 45, lon: 6, tags: { shop: 'bakery' } },
      { type: 'node', id: 4, tags: { amenity: 'parking' } },
    ]);
    expect(pois.map(({ id, kind, name }) => [id, kind, name])).toEqual([
      ['node/1', 'water', 'Point d’eau'],
      ['way/2', 'hut', 'Refuge X'],
    ]);
  });

  it('construit une seule requête pour toutes les zones', () => {
    const query = overpassQuery([{ south: 1, west: 2, north: 3, east: 4 }]);
    expect(query).toContain('"drinking_water"](1,2,3,4)');
    expect(query).toContain('alpine_hut');
  });

  it('passe au serveur suivant, puis garde le résultat en cache', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValue(json({ elements: [element] }));
    vi.stubGlobal('fetch', fetchMock);
    const store = memoryStore();

    expect(await findPois(store, trip)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await findPois(store, trip)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('remonte l’erreur si tout est saturé et que rien n’est en cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 502)));
    await expect(findPois(memoryStore(), trip)).rejects.toThrow(/Overpass/);
  });

  it('ne cherche rien sans rando', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await findPois(memoryStore(), { ...trip, hikes: [] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
