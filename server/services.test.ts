import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place, Trip } from '../shared/schema';
import { addPlaceStop } from '../shared/trip';
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
    dir = await mkdtemp(path.join(tmpdir(), 'trailplan-'));
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
    expect(await checkKeys(undefined, undefined)).toEqual({ ors: 'missing', notion: 'missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('repère une clé refusée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 403)));
    const refused = Object.assign(new Error('refus'), { status: 401 });
    const result = await checkKeys('cle', notion(() => Promise.reject(refused)));
    expect(result).toEqual({ ors: 'invalid', notion: 'invalid' });
  });

  it('ne déclare pas une clé invalide sur panne réseau', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('réseau'))));
    const down = notion(() => Promise.reject(new Error('réseau')));
    expect(await checkKeys('cle', down)).toEqual({ ors: 'configured', notion: 'configured' });
  });
});
