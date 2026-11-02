import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { tripBudget } from './budget';
import { corridorBoxes, MAX_BOXES } from './charging';
import {
  rankStations,
  stationFromLink,
  stationReviewsUrl,
  stationNetwork,
  toggleFavoriteStation,
} from './charging-networks';
import { checklistSuggestions } from './checklist';
import { forecastAvailableFrom, formatWeather, isForecastable } from './weather';
import { parseMapLink } from './map-link';
import { daySchedule } from './schedule';
import { sunTimes } from './sun';
import { emptyHistory, HISTORY_LIMIT, record, redo, undo } from './history';
import { formatClock } from './format';
import { buildProfile, nearestPointIndex } from './profile';
import { DEFAULT_SETTINGS, type Hike, type ItineraryLeg, type Trip } from './schema';
import { dayTotals, loadRatio, tripStats } from './totals';
import { addHikeStop, generateDays, setStopStartTime, updateDay } from './trip';

function hike(alts: number[], stepKm = 1): Hike {
  return {
    id: randomUUID(),
    name: 'Rando',
    gpxFile: 'gpx/x.gpx',
    kind: 'loop',
    stats: {
      distanceKm: (alts.length - 1) * stepKm,
      elevationGainM: 500,
      elevationLossM: 0,
      maxAltitudeM: null,
      minAltitudeM: null,
      estimatedDurationMin: 120,
      profile: alts.map((altM, i) => ({ distKm: i * stepKm, altM, lat: 45 + i, lng: 6 })),
    },
    start: { lat: 45, lng: 6 },
    end: { lat: 45, lng: 6 },
    dogPolicy: 'unknown',
  };
}

const baseTrip = {
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
} satisfies Trip;

const leg = (dayIndex: number, distanceKm: number, durationMin: number): ItineraryLeg => ({
  from: { lat: 0, lng: 0 },
  to: { lat: 0, lng: 0 },
  distanceKm,
  durationMin,
  geometry: { type: 'LineString', coordinates: [] },
  source: 'ign',
  fromName: 'A',
  toName: 'B',
  dayIndex,
  stopId: null,
  phase: 'end',
  trailToStay: false,
});

describe('dayTotals', () => {
  it('additionne marche, route et pauses du seul jour concerné', () => {
    const backup = hike([1000, 1100]);
    const trip = updateDay(addHikeStop({ ...baseTrip, hikes: [backup] }, 1, hike([1000, 1100])), 1, {
      backupHikeIds: [backup.id],
    });
    trip.days[0]!.stops.push({
      id: randomUUID(),
      kind: 'place',
      placeId: randomUUID(),
      durationMin: 45,
    });

    const totals = dayTotals(trip, trip.days[0]!, [leg(1, 80, 75), leg(2, 500, 300)], '08:30');

    expect(totals).toMatchObject({
      hikingKm: 1,
      elevationGainM: 500,
      hikingMin: 120,
      drivingKm: 80,
      drivingMin: 75,
      placesMin: 45,
      activeMin: 240,
      estimatedEndTime: '12:30',
    });
  });

  it('ne compte pas de D+ pour une rando sans altitude', () => {
    const noAltitude = hike([1000, 1100]);
    noAltitude.stats.elevationGainM = null;
    const trip = addHikeStop(baseTrip, 1, noAltitude);
    expect(
      dayTotals(trip, trip.days[0]!, [], DEFAULT_SETTINGS.dayStartTime).elevationGainM,
    ).toBe(0);
  });
});

describe('daySchedule', () => {
  const planned = addHikeStop(baseTrip, 1, hike([1000, 1100]));
  const stopId = planned.days[0]!.stops[0]!.id;
  const drive: ItineraryLeg = { ...leg(1, 50, 30), stopId, phase: 'enter' };

  it('enchaîne le trajet puis la rando depuis l’heure de départ type', () => {
    expect(daySchedule(planned, planned.days[0]!, [drive], '08:30')).toEqual({
      stops: [{ stopId, startMin: 540, endMin: 660 }],
      endMin: 660,
    });
  });

  it('recale la rando sur son heure de départ choisie', () => {
    const fixed = setStopStartTime(planned, stopId, '13:00');
    const schedule = daySchedule(fixed, fixed.days[0]!, [drive], '08:30');
    expect(schedule.stops[0]).toMatchObject({ startMin: 780, endMin: 900 });
  });

  it('compte le trajet vers le séjour et la pause', () => {
    const back: ItineraryLeg = { ...leg(1, 10, 20), stopId, phase: 'stay' };
    const end: ItineraryLeg = { ...leg(1, 10, 15), stopId: null, phase: 'end' };
    expect(daySchedule(planned, planned.days[0]!, [back, end], '08:00').endMin).toBe(635);
  });

  it('dépasse minuit sans se tromper', () => {
    const late = setStopStartTime(planned, stopId, '23:00');
    const { endMin } = daySchedule(late, late.days[0]!, [], '08:00');
    expect(endMin).toBe(1500);
    expect(formatClock(endMin)).toBe('01:00 (+1 j)');
  });
});

describe('sunTimes', () => {
  const ecrins = { lat: 45.05, lng: 5.9 };

  it('donne un coucher précoce en décembre, à l’heure d’hiver', () => {
    const { sunriseMin, sunsetMin } = sunTimes('2026-12-12', ecrins);
    expect(sunriseMin).toBeGreaterThan(8 * 60 - 20);
    expect(sunriseMin).toBeLessThan(8 * 60 + 25);
    expect(sunsetMin).toBeGreaterThan(16 * 60 + 40);
    expect(sunsetMin).toBeLessThan(17 * 60 + 15);
  });

  it('passe à l’heure d’été en juillet', () => {
    const { sunsetMin } = sunTimes('2027-07-01', ecrins);
    expect(sunsetMin).toBeGreaterThan(21 * 60);
  });
});

describe('tripStats', () => {
  it('additionne les randos planifiées et les trajets, sans les replis', () => {
    const backup = hike([1000, 1100]);
    const first = hike([1000, 1100, 1200]);
    first.stats.maxAltitudeM = 2400;
    const second = hike([1000, 1100]);
    second.stats.elevationGainM = null;
    const trip = updateDay(
      addHikeStop(addHikeStop({ ...baseTrip, hikes: [backup] }, 1, first), 2, second),
      1,
      { backupHikeIds: [backup.id] },
    );

    expect(tripStats(trip, [leg(1, 80, 75), leg(2, 20, 25)])).toEqual({
      hikeCount: 2,
      hikingKm: 3,
      elevationGainM: 500,
      elevationLossM: 0,
      hikingMin: 240,
      maxAltitudeM: 2400,
      drivingKm: 100,
      drivingMin: 100,
    });
  });

  it('compte chaque passage d’une rando planifiée deux fois', () => {
    const repeated = hike([1000, 1100]);
    const trip = addHikeStop(baseTrip, 1, repeated);
    trip.days[1]!.stops.push({ id: randomUUID(), kind: 'hike', hikeId: repeated.id });
    expect(tripStats(trip, []).hikingKm).toBe(2);
  });

  it('reste à zéro sans rando', () => {
    expect(tripStats(baseTrip, [])).toMatchObject({ hikeCount: 0, maxAltitudeM: null });
  });
});

describe('loadRatio', () => {
  it('ne donne rien tant que le seuil n’est pas défini', () => {
    expect(loadRatio(300, undefined)).toBeNull();
    expect(loadRatio(300, 5)).toBe(1);
  });
});

describe('profil', () => {
  it('calcule la pente locale', () => {
    const [first, second] = buildProfile([hike([1000, 1100])]);
    expect(first?.slopePct).toBeNull();
    expect(second?.slopePct).toBeCloseTo(10);
  });

  it('enchaîne plusieurs randos sur la distance', () => {
    const points = buildProfile([hike([1000, 1100]), hike([900, 950])]);
    expect(points.map((point) => point.distKm)).toEqual([0, 1, 1, 2]);
    expect(points[2]?.slopePct).toBeNull();
  });

  it('trouve le point le plus proche', () => {
    const points = buildProfile([hike([1000, 1100, 1200])]);
    expect(nearestPointIndex(points, { lat: 46.1, lng: 6 })).toBe(1);
    expect(nearestPointIndex([], { lat: 0, lng: 0 })).toBe(-1);
  });
});

describe('parseMapLink', () => {
  const at = (link: string) => parseMapLink(link).location;

  it('préfère le point exact du lieu au centre de la vue', () => {
    expect(
      at('https://www.google.com/maps/place/X/@45.0,6.0,17z/data=!4m6!3m5!8m2!3d45.0668!4d6.0215'),
    ).toEqual({ lat: 45.0668, lng: 6.0215 });
  });

  it('lit le nom du lieu', () => {
    expect(
      parseMapLink('https://www.google.fr/maps/place/Lidl+Saint-J%C3%A9an/@45.1,6.1,17z').name,
    ).toBe('Lidl Saint-Jéan');
  });

  it('lit les formats courants', () => {
    const expected = { lat: 45.06, lng: 6.02 };
    expect(at('https://www.google.com/maps?q=45.06,6.02')).toEqual(expected);
    expect(at('https://www.google.com/maps/search/?api=1&query=45.06%2C6.02')).toEqual(expected);
    expect(at('https://www.google.com/maps/dir/?api=1&destination=45.06,6.02')).toEqual(expected);
    expect(at('https://www.google.com/maps/search/45.06,+6.02')).toEqual(expected);
    expect(at('https://www.google.com/maps/place/45.06,6.02')).toEqual(expected);
    expect(at('https://www.google.com/maps/@45.06,6.02,15z')).toEqual(expected);
    expect(at('https://maps.google.com/?ll=45.06,6.02&z=15')).toEqual(expected);
  });

  it('accepte les longitudes négatives', () => {
    expect(at('https://www.google.com/maps/@48.85,-2.35,15z')).toEqual({ lat: 48.85, lng: -2.35 });
  });

  it('rend le texte de recherche quand il n’y a pas de coordonnées', () => {
    expect(parseMapLink('https://www.google.com/maps?q=Gap+05000')).toMatchObject({
      location: null,
      query: 'Gap 05000',
    });
  });

  it('écarte des coordonnées impossibles', () => {
    expect(at('https://www.google.com/maps/@145.06,6.02,15z')).toBeNull();
  });
});

describe('budget', () => {
  const hotel = {
    id: randomUUID(),
    type: 'lodging' as const,
    name: 'Hôtel',
    location: { lat: 45, lng: 6 },
    price: 90,
  };

  it('compte l’hébergement par nuit et ajoute les dépenses', () => {
    const trip = updateDay({ ...baseTrip, places: [hotel] }, 1, { nightPlaceId: hotel.id });
    const budget = tripBudget({
      ...trip,
      expenses: [{ id: randomUUID(), label: 'Péage', amount: 25, category: 'toll' }],
    });
    expect(budget.total).toBe(115);
    expect(budget.byCategory).toEqual([
      { category: 'lodging', amount: 90 },
      { category: 'toll', amount: 25 },
    ]);
    expect(budget.nightsWithoutPrice).toBe(0);
  });

  it('signale une nuit sans prix', () => {
    const free = { ...hotel, price: undefined };
    const trip = updateDay({ ...baseTrip, places: [free] }, 1, { nightPlaceId: free.id });
    expect(tripBudget(trip)).toMatchObject({ total: 0, nightsWithoutPrice: 1 });
  });

  it('ne compte pas de nuit le dernier jour', () => {
    const trip = updateDay({ ...baseTrip, places: [hotel] }, 2, { nightPlaceId: hotel.id });
    expect(tripBudget(trip).total).toBe(0);
  });
});

describe('checklist', () => {
  const labels = (trip: Trip) => checklistSuggestions(trip).map(({ label }) => label);

  it('adapte les suggestions au voyage', () => {
    expect(labels(baseTrip)).not.toContain('Pneus hiver ou chaînes');
    expect(labels(baseTrip)).not.toContain('Laisse');
    const winter = {
      ...baseTrip,
      startDate: '2026-12-10',
      endDate: '2026-12-13',
      travelers: { withDog: true, electricVehicle: true },
    };
    expect(labels(winter)).toEqual(
      expect.arrayContaining(['Pneus hiver ou chaînes', 'Laisse', 'Câble de recharge']),
    );
  });

  it('propose de réserver ce qui ne l’est pas', () => {
    const place = {
      id: randomUUID(),
      type: 'lodging' as const,
      name: 'Gîte',
      location: { lat: 45, lng: 6 },
    };
    expect(labels({ ...baseTrip, places: [place] })).toContain('Réserver Gîte');
    const booked = { ...place, bookingStatus: 'booked' as const };
    expect(labels({ ...baseTrip, places: [booked] })).not.toContain('Réserver Gîte');
  });

  it('ne repropose pas ce qui est déjà dans la liste', () => {
    const checklist = [{ id: randomUUID(), label: 'Trousse de secours', done: true }];
    expect(labels({ ...baseTrip, checklist })).not.toContain('Trousse de secours');
  });
});

describe('météo', () => {
  it('situe la fenêtre de prévision', () => {
    expect(forecastAvailableFrom('2026-12-10')).toBe('2026-11-25');
    expect(isForecastable('2026-12-10', '2026-11-24')).toBe(false);
    expect(isForecastable('2026-12-10', '2026-11-25')).toBe(true);
    expect(isForecastable('2026-11-01', '2026-11-25')).toBe(false);
  });

  it('résume une prévision', () => {
    expect(
      formatWeather({
        status: 'forecast',
        code: 73,
        tempMinC: -4.2,
        tempMaxC: 2.6,
        precipitationMm: 6,
        windKmh: 38,
      }),
    ).toBe('Neige · -4 à 3 °C · 6 mm · vent 38 km/h');
  });
});

describe('réseaux favoris', () => {
  const station = (id: string, maxPowerKw: number, network: string | null) => ({
    id,
    name: id,
    address: '',
    operator: '',
    network,
    location: { lat: 45, lng: 6 },
    maxPowerKw,
    points: 2,
    connectors: [],
    hours: null,
  });
  const stations = [
    station('rapide', 400, null),
    station('izivia', 50, 'izivia'),
    station('ionity', 350, 'ionity'),
  ];

  it('reconnaît les noms réels de la base', () => {
    expect(stationNetwork(['IONITY GMBH', null])).toBe('ionity');
    expect(stationNetwork([null, 'IZIVIA'])).toBe('izivia');
    expect(stationNetwork(['Izivia Express'])).toBe('izivia');
    expect(stationNetwork([null, 'Mobilize Power Solutions'])).toBe('mobilize');
    expect(stationNetwork(['SOWATT SOLUTIONS'])).toBe('sowatt');
    expect(stationNetwork(['Le Plein Tarnais'])).toBe('le-plein');
    expect(stationNetwork(['TotalEnergies', null])).toBeNull();
  });

  it('met les favoris en tête, par puissance', () => {
    const ranked = rankStations(stations, ['izivia', 'ionity'], false);
    expect(ranked.map(({ id }) => id)).toEqual(['ionity', 'izivia', 'rapide']);
    expect(ranked.map(({ favorite }) => favorite)).toEqual([true, true, false]);
  });

  it('filtre sur les seuls favoris', () => {
    expect(rankStations(stations, ['izivia'], true).map(({ id }) => id)).toEqual(['izivia']);
  });

  it('place les bornes étoilées avant les réseaux, même avec le filtre', () => {
    const ranked = rankStations(stations, ['ionity'], true, ['rapide']);
    expect(ranked.map(({ id }) => id)).toEqual(['rapide', 'ionity']);
    expect(ranked[0]?.starred).toBe(true);
  });

  it('ajoute puis retire une borne des favoris', () => {
    const added = toggleFavoriteStation([], stations[0]!);
    expect(added).toHaveLength(1);
    expect(toggleFavoriteStation(added, stations[0]!)).toEqual([]);
  });

  it('crée une borne depuis un lien, sans inventer de puissance', () => {
    const link = {
      name: 'Electra',
      location: { lat: 45, lng: 6 },
      url: 'https://maps.app.goo.gl/x',
      approximate: false,
    };
    expect(stationFromLink(link, 'Electra Gap', 'id')).toMatchObject({
      name: 'Electra Gap',
      maxPowerKw: 0,
      network: null,
      url: link.url,
    });
  });

  it('ne marque rien sans favori', () => {
    expect(rankStations(stations, [], false).some(({ favorite }) => favorite)).toBe(false);
  });
});

describe('corridorBoxes', () => {
  it('couvre un long trajet par étapes, extrémités comprises', () => {
    const line = Array.from({ length: 101 }, (_, i) => [6, 44 + i * 0.01]);
    const boxes = corridorBoxes([line], []);
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    expect(boxes[0]!.south).toBeLessThan(44);
    expect(boxes.at(-1)!.north).toBeGreaterThan(45);
  });

  it('dédoublonne les étapes voisines et plafonne le nombre de zones', () => {
    const here = { lat: 45, lng: 6 };
    expect(corridorBoxes([], [here, here])).toHaveLength(1);
    const many = Array.from({ length: 200 }, (_, i) => ({ lat: 40 + i * 0.5, lng: 6 }));
    expect(corridorBoxes([], many)).toHaveLength(MAX_BOXES);
  });
});

describe('historique', () => {
  it('annule puis rétablit dans l’ordre', () => {
    const afterTwo = record(record(emptyHistory<string>(), 'a'), 'b');
    const undone = undo(afterTwo, 'c')!;
    expect(undone.value).toBe('b');
    const redone = redo(undone.history, 'b')!;
    expect(redone.value).toBe('c');
    expect(redone.history.past).toEqual(['a', 'b']);
  });

  it('ne fait rien sans historique', () => {
    expect(undo(emptyHistory<string>(), 'a')).toBeNull();
    expect(redo(emptyHistory<string>(), 'a')).toBeNull();
  });

  it('efface le rétablir après une nouvelle modification', () => {
    const undone = undo(record(emptyHistory<string>(), 'a'), 'b')!;
    expect(record(undone.history, 'a').future).toEqual([]);
  });

  it('garde au moins 20 niveaux, jusqu’à la limite', () => {
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(20);
    let history = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) history = record(history, i);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
  });
});

describe('stationReviewsUrl', () => {
  const query = (url: string) => new URL(url).searchParams.get('query');

  it('cherche par opérateur et adresse, plus fiables que les noms IRVE', () => {
    const url = stationReviewsUrl({
      name: 'ABB 400 RENAULT A',
      operator: 'SOWATT SOLUTIONS',
      address: "30 Route du Puy 38520 Le Bourg-d'Oisans",
    });
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(query(url)).toBe(
      "borne de recharge SOWATT SOLUTIONS 30 Route du Puy 38520 Le Bourg-d'Oisans",
    );
  });

  it('se rabat sur le nom sans adresse', () => {
    const url = stationReviewsUrl({ name: 'Plug Inn Gap', operator: '', address: '' });
    expect(query(url)).toBe('borne de recharge Plug Inn Gap');
  });

  it('garde le lien collé par l’utilisateur', () => {
    const url = 'https://maps.app.goo.gl/abc';
    expect(stationReviewsUrl({ name: 'Borne', operator: '', address: '', url })).toBe(url);
  });
});
