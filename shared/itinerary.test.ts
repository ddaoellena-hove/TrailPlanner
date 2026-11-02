import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveLegs,
  itineraryTotals,
  plannedStops,
  routeCacheKey,
  straightLineLeg,
} from './itinerary';
import type { Hike, LatLng, Place, Trip } from './schema';
import { addHikeStop, addPlaceStop, generateDays, setStopPlaces } from './trip';

const gap: LatLng = { lat: 44.56, lng: 6.08 };
const briancon: LatLng = { lat: 44.9, lng: 6.64 };
const trailEnd: LatLng = { lat: 44.7, lng: 6.3 };

function place(location: LatLng, name = 'Lieu'): Place {
  return { id: randomUUID(), type: 'lodging', name, location };
}

function hike(start: LatLng, end: LatLng): Hike {
  return {
    id: randomUUID(),
    name: 'Rando',
    gpxFile: 'gpx/x.gpx',
    kind: 'point-to-point',
    stats: {
      distanceKm: 1,
      elevationGainM: 0,
      elevationLossM: 0,
      maxAltitudeM: null,
      minAltitudeM: null,
      estimatedDurationMin: 60,
      profile: [],
    },
    start,
    end,
    dogPolicy: 'unknown',
  };
}

const trip: Trip = {
  schemaVersion: 1,
  id: randomUUID(),
  slug: 'test',
  name: 'Test',
  startDate: '2027-07-01',
  endDate: '2027-07-02',
  travelers: { withDog: false },
  hikes: [],
  places: [],
  days: generateDays('2027-07-01', '2027-07-02'),
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const ends = (planned: Trip) => deriveLegs(planned).map(({ from, to }) => ({ from, to }));

describe('deriveLegs', () => {
  it('ne produit rien sans au moins deux points', () => {
    expect(ends(trip)).toEqual([]);
    expect(ends(addPlaceStop(trip, 1, place(gap)))).toEqual([]);
  });

  it('commence à la première étape sans départ, et enchaîne les jours', () => {
    const planned = addPlaceStop(addPlaceStop(trip, 1, place(gap)), 2, place(briancon));
    expect(ends(planned)).toEqual([{ from: gap, to: briancon }]);
  });

  it('part de l’origine et finit à la destination quand elles existent', () => {
    const lyon: LatLng = { lat: 45.76, lng: 4.84 };
    const planned = addPlaceStop(
      { ...trip, origin: place(lyon), destination: place(lyon) },
      1,
      place(gap),
    );
    expect(ends(planned)).toEqual([
      { from: lyon, to: gap },
      { from: gap, to: lyon },
    ]);
  });

  it('repart de l’arrivée d’une traversée', () => {
    const planned = addPlaceStop(addHikeStop(trip, 1, hike(gap, trailEnd)), 1, place(briancon));
    expect(ends(planned)).toEqual([{ from: trailEnd, to: briancon }]);
  });

  it('passe par la nuit du jour', () => {
    const night = place(briancon);
    const planned = addPlaceStop(addPlaceStop(trip, 1, place(gap)), 2, place(gap));
    planned.places.push(night);
    planned.days[0]!.nightPlaceId = night.id;
    expect(ends(planned)).toEqual([
      { from: gap, to: briancon },
      { from: briancon, to: gap },
    ]);
  });

  it('passe par le séjour d’une rando puis en repart par défaut', () => {
    const withHike = addPlaceStop(addHikeStop(trip, 1, hike(gap, trailEnd)), 2, place(gap));
    const stopId = withHike.days[0]!.stops[0]!.id;
    const planned = setStopPlaces(withHike, stopId, {
      departure: null,
      stay: { name: 'Hôtel', location: briancon },
    });
    expect(ends(planned)).toEqual([
      { from: trailEnd, to: briancon },
      { from: briancon, to: gap },
    ]);
    expect(deriveLegs(planned)[0]).toMatchObject({ fromName: 'Rando', toName: 'Hôtel' });
  });

  it('repart du départ renseigné, sans trajet pour le rejoindre', () => {
    const lyon: LatLng = { lat: 45.76, lng: 4.84 };
    const base = addPlaceStop(addPlaceStop(trip, 1, place(gap)), 2, place(briancon));
    const planned = setStopPlaces(base, base.days[1]!.stops[0]!.id, {
      departure: { name: 'Lyon', location: lyon },
      stay: { name: 'Lieu', location: briancon },
    });
    expect(ends(planned)).toEqual([{ from: lyon, to: briancon }]);
  });

  it('donne à la première étape un trajet quand son départ est renseigné', () => {
    const base = addHikeStop(trip, 1, hike(gap, trailEnd));
    const planned = setStopPlaces(base, base.days[0]!.stops[0]!.id, {
      departure: { name: 'Lyon', location: briancon },
      stay: null,
    });
    expect(ends(planned)).toEqual([{ from: briancon, to: gap }]);
    expect(plannedStops(planned).map(({ name }) => name)).toEqual(['Lyon', 'Rando']);
  });

  it('distingue le trajet du trail à l’hébergement', () => {
    const base = addPlaceStop(addHikeStop(trip, 1, hike(gap, trailEnd)), 2, place(briancon));
    const stopId = base.days[0]!.stops[0]!.id;
    const planned = setStopPlaces(base, stopId, {
      departure: null,
      stay: { name: 'Hôtel', location: { lat: 44.8, lng: 6.5 } },
    });
    expect(deriveLegs(planned).map((leg) => leg.trailToStay)).toEqual([true, false]);
  });

  it('situe chaque trajet par rapport à son étape', () => {
    const first = addHikeStop(addPlaceStop(trip, 1, place(briancon)), 1, hike(gap, trailEnd));
    const stopId = first.days[0]!.stops[1]!.id;
    const planned = setStopPlaces(first, stopId, {
      departure: null,
      stay: { name: 'Hôtel', location: briancon },
    });
    expect(deriveLegs(planned).map((leg) => [leg.stopId, leg.phase])).toEqual([
      [stopId, 'enter'],
      [stopId, 'stay'],
    ]);
    const home = { ...planned, destination: place(gap) };
    expect(deriveLegs(home).at(-1)).toMatchObject({ stopId: null, phase: 'end' });
  });

  it('ignore les trajets de moins de 300 m', () => {
    const near: LatLng = { lat: gap.lat + 0.001, lng: gap.lng };
    const planned = addPlaceStop(addPlaceStop(trip, 1, place(gap)), 1, place(near));
    expect(ends(planned)).toEqual([]);
  });
});

describe('plannedStops', () => {
  it('liste les étapes dans l’ordre, au point d’entrée', () => {
    const planned = addPlaceStop(addHikeStop(trip, 1, hike(gap, trailEnd)), 2, place(briancon, 'Gîte'));
    expect(plannedStops(planned).map(({ kind, location }) => [kind, location])).toEqual([
      ['hike', gap],
      ['lodging', briancon],
    ]);
  });
});

describe('repli et totaux', () => {
  it('applique ×1,3 à 70 km/h', () => {
    const { distanceKm, durationMin, source } = straightLineLeg({ from: gap, to: briancon });
    expect(source).toBe('straight-line-fallback');
    expect(distanceKm).toBeGreaterThan(75);
    expect(durationMin).toBeCloseTo((distanceKm / 70) * 60, 5);
  });

  it('additionne et signale une estimation', () => {
    const leg = straightLineLeg({ from: gap, to: briancon });
    const totals = itineraryTotals([leg, leg]);
    expect(totals.distanceKm).toBeCloseTo(leg.distanceKm * 2);
    expect(totals.estimated).toBe(true);
    expect(itineraryTotals([]).estimated).toBe(false);
  });

  it('arrondit la clé de cache à 4 décimales', () => {
    expect(routeCacheKey({ from: { lat: 44.123456, lng: 6 }, to: briancon })).toBe(
      '44.1235,6.0000→44.9000,6.6400',
    );
  });
});
