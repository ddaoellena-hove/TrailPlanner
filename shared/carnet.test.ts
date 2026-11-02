import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeAlerts } from './alerts';
import { buildCarnet, CARNET_FOOTER, carnetOutcome, carnetToMarkdown } from './carnet';
import { DEFAULT_SETTINGS, type Hike, type ItineraryLeg, type Place, type Trip } from './schema';
import { addHikeStop, addPlaceStop, generateDays, updateDay } from './trip';

const here = { lat: 45, lng: 6 };

const hike: Hike = {
  id: randomUUID(),
  name: 'Lac | Bleu',
  alltrailsUrl: 'https://www.alltrails.com/fr/randonnee/france/lac',
  gpxFile: 'gpx/x.gpx',
  kind: 'point-to-point',
  stats: {
    distanceKm: 8.8,
    elevationGainM: 443,
    elevationLossM: 400,
    maxAltitudeM: null,
    minAltitudeM: null,
    estimatedDurationMin: 208,
    profile: [],
  },
  start: here,
  end: here,
  dogPolicy: 'unknown',
};

const hotel: Place = {
  id: randomUUID(),
  type: 'lodging',
  name: 'Hôtel du Col',
  location: here,
  url: 'https://hotel.example/',
  price: 90,
  bookingStatus: 'to-book',
};

const empty: Trip = {
  schemaVersion: 1,
  id: randomUUID(),
  slug: 'test',
  name: 'Écrins',
  startDate: '2027-07-01',
  endDate: '2027-07-02',
  travelers: { withDog: true },
  hikes: [],
  places: [],
  days: generateDays('2027-07-01', '2027-07-02'),
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const leg: ItineraryLeg = {
  from: here,
  to: here,
  distanceKm: 152.4,
  durationMin: 134,
  geometry: { type: 'LineString', coordinates: [] },
  source: 'ign',
  fromName: 'Lyon',
  toName: 'Lac | Bleu',
  dayIndex: 1,
  stopId: null,
  phase: 'enter',
  trailToStay: false,
};

function planned(): { trip: Trip; legs: ItineraryLeg[]; markdown: string } {
  const withStops = updateDay(addPlaceStop(addHikeStop(empty, 1, hike), 1, hotel), 1, {
    title: 'Col du Festre',
  });
  const legs = [{ ...leg, stopId: withStops.days[0]!.stops[0]!.id }];
  const alerts = computeAlerts(withStops, legs, DEFAULT_SETTINGS);
  const blocks = buildCarnet(withStops, legs, alerts, new Date('2026-11-02T10:00:00Z'));
  return { trip: withStops, legs, markdown: carnetToMarkdown(blocks) };
}

describe('carnetOutcome', () => {
  it('résume le voyage', () => {
    expect(carnetOutcome(addHikeStop(empty, 1, hike))).toBe(
      '2 jours / 1 nuit, 8,8 km, 443 m D+, départ Lac | Bleu',
    );
  });

  it('se passe du départ pour un voyage vide', () => {
    expect(carnetOutcome(empty)).toBe('2 jours / 1 nuit, 0 km, 0 m D+');
  });
});

describe('carnet', () => {
  const { markdown } = planned();

  it('commence par le récap', () => {
    expect(markdown.startsWith('> Du jeudi 1 juillet au vendredi 2 juillet · 2 jours / 1 nuit')).toBe(
      true,
    );
    expect(markdown).toContain('3 h 28 de marche · 2 h 14 de route · Export du 2026-11-02');
  });

  it('contient le tableau jour par jour, avec le statut issu des alertes', () => {
    expect(markdown).toContain('| Jour | Secteur et marche | Distance / dénivelé | Route | Nuit | Statut |');
    expect(markdown).toContain('| J1 | Col du Festre : Lac \\| Bleu | 8,8 km / 443 m D+ | 2 h 14 | Hôtel du Col |');
    expect(markdown).toContain('Chien à confirmer');
    expect(markdown).toContain('Hébergement à réserver');
    expect(markdown).toMatch(/\| J2 \| — \| — \| — \| — \| OK \|/);
  });

  it('détaille chaque jour avec trajet, rando et lien', () => {
    expect(markdown).toContain('## J1 — Col du Festre');
    expect(markdown).toContain('🚗 Lyon → Lac | Bleu : 2 h 14, 152,4 km');
    expect(markdown).toContain(
      '🥾 [Lac | Bleu](https://www.alltrails.com/fr/randonnee/france/lac) : 8,8 km, 443 m D+, 3 h 28',
    );
    expect(markdown).toContain('🛏️ Nuit : [Hôtel du Col](https://hotel.example/) (À réserver)');
  });

  it('liste les hébergements et les points à vérifier', () => {
    expect(markdown).toContain('| Hôtel du Col | 1 | 90 € | À réserver | À confirmer | [Lien](https://hotel.example/) |');
    expect(markdown).toContain('- [ ] Chien à confirmer : Lac | Bleu');
    expect(markdown).not.toContain('- [ ] Hôtel du Col : à réserver');
  });

  it('donne le soleil et l’horaire de chaque rando', () => {
    expect(markdown).toMatch(/☀️ Lever \d\d:\d\d, coucher \d\d:\d\d/);
    expect(markdown).toContain('3 h 28 (10:44 → 14:12)');
  });

  it('ajoute budget et checklist, avec l’état des tâches', () => {
    const { trip, legs } = planned();
    const blocks = buildCarnet(
      {
        ...trip,
        expenses: [{ id: randomUUID(), label: 'Péage', amount: 25, category: 'toll' }],
        checklist: [
          { id: randomUUID(), label: 'Chaînes', done: true },
          { id: randomUUID(), label: 'Frontale', done: false },
        ],
      },
      legs,
      [],
      new Date(),
    );
    const text = carnetToMarkdown(blocks);
    expect(text).toContain('| Total | 115 € |');
    expect(text).toContain('- [x] Chaînes\n- [ ] Frontale');
  });

  it('finit par le pied de page', () => {
    expect(markdown.endsWith(CARNET_FOOTER)).toBe(true);
  });

  it('omet hébergements et vérifications quand il n’y en a pas', () => {
    const blocks = buildCarnet({ ...empty, travelers: { withDog: false } }, [], [], new Date());
    const text = carnetToMarkdown(blocks);
    expect(text).not.toContain('## Hébergements');
    expect(text).not.toContain('## Points à vérifier');
  });
});
