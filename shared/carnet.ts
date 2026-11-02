import type { Alert, AlertCode } from './alerts';
import {
  formatClock,
  formatDay,
  formatDuration,
  formatElevationGain,
  formatKm,
} from './format';
import { EXPENSE_LABELS, tripBudget } from './budget';
import { deriveLegs, plannedStops } from './itinerary';
import { daySchedule } from './schedule';
import { DEFAULT_SETTINGS, type Day, type Hike, type ItineraryLeg, type Place, type Trip } from './schema';
import { daySun } from './sun';
import { tripStats } from './totals';
import { nightOf } from './trip';

export const CARNET_TITLE = '🗺️ Carnet d’itinéraire — généré par TrailPlanner';
/** Titre d'avant le renommage de l'outil : ces carnets sont repris, pas dupliqués. */
export const CARNET_LEGACY_TITLE = '🗺️ Carnet d’itinéraire — généré par Trailplan';
export const CARNET_FOOTER =
  'Généré automatiquement par TrailPlanner — ne pas éditer cette page, elle est remplacée à chaque export.';

export type Inline = { text: string; url?: string };
export type CarnetBlock =
  | { type: 'callout'; text: Inline[] }
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: Inline[] }
  | { type: 'bullet'; text: Inline[] }
  | { type: 'todo'; text: Inline[]; checked?: boolean }
  | { type: 'table'; header: string[]; rows: Inline[][][] };

const STATUS_LABELS: Record<AlertCode, string> = {
  A1: 'Charge élevée',
  A2: 'Nuit à définir',
  A3: 'Chien interdit',
  A4: 'Chien à confirmer',
  A5: 'Véhicule à récupérer',
  A6: '',
  A7: 'Trajet estimé',
  A8: 'Hébergement à réserver',
  A9: 'Fin après le coucher du soleil',
};

const BOOKING: Record<NonNullable<Place['bookingStatus']>, string> = {
  idea: 'Idée',
  'to-book': 'À réserver',
  booked: 'Réservé',
  cancelled: 'Annulé',
};

const DOGS: Record<NonNullable<Place['dogPolicy']>, string> = {
  allowed: 'Autorisés',
  forbidden: 'Interdits',
  unknown: 'À confirmer',
};

const cell = (text: string, url?: string): Inline[] => [url ? { text, url } : { text }];

function hikesOf(trip: Trip, day: Day): Hike[] {
  return day.stops.flatMap((stop) => {
    const hike = stop.kind === 'hike' ? trip.hikes.find(({ id }) => id === stop.hikeId) : undefined;
    return hike ? [hike] : [];
  });
}

function nightsLabel(count: number): string {
  return count > 1 ? `${count} nuits` : `${count} nuit`;
}

/** Résumé de la propriété `Outcome` (SPEC §8). */
export function carnetOutcome(trip: Trip): string {
  const { hikingKm, elevationGainM } = tripStats(trip, []);
  const days = trip.days.length;
  const departure = deriveLegs(trip)[0]?.fromName ?? plannedStops(trip)[0]?.name;
  const parts = [
    `${days} ${days > 1 ? 'jours' : 'jour'} / ${nightsLabel(days - 1)}`,
    formatKm(hikingKm),
    formatElevationGain(elevationGainM),
  ];
  return [...parts, ...(departure ? [`départ ${departure}`] : [])].join(', ');
}

function dayStatus(alerts: Alert[], day: Day): string {
  const labels = alerts
    .filter((alert) => alert.dayIndex === day.index)
    .map((alert) => STATUS_LABELS[alert.code])
    .filter(Boolean);
  return labels.length > 0 ? [...new Set(labels)].join(', ') : 'OK';
}

function daySection(
  trip: Trip,
  day: Day,
  legs: ItineraryLeg[],
  dayStartTime: string,
): CarnetBlock[] {
  const schedule = daySchedule(trip, day, legs, dayStartTime);
  const sun = daySun(trip, day);
  const dayLegs = legs.filter((leg) => leg.dayIndex === day.index);
  const driveBullets = (stopId: string | null, phase: ItineraryLeg['phase']): CarnetBlock[] =>
    dayLegs
      .filter((leg) => leg.stopId === stopId && leg.phase === phase)
      .map((leg) => ({
        type: 'bullet',
        text: [
          {
            text: `🚗 ${leg.fromName} → ${leg.toName} : ${formatDuration(leg.durationMin)}, ${formatKm(leg.distanceKm)}`,
          },
        ],
      }));

  const timeline = day.stops.flatMap((stop): CarnetBlock[] => {
    if (stop.kind === 'hike') {
      const hike = trip.hikes.find(({ id }) => id === stop.hikeId);
      if (!hike) return [];
      const { distanceKm, elevationGainM, estimatedDurationMin } = hike.stats;
      const timing = schedule.stops.find(({ stopId }) => stopId === stop.id);
      const stats = [
        formatKm(distanceKm),
        ...(elevationGainM === null ? [] : [formatElevationGain(elevationGainM)]),
        formatDuration(estimatedDurationMin),
      ].join(', ');
      return [
        ...driveBullets(stop.id, 'enter'),
        {
          type: 'bullet',
          text: [
            { text: '🥾 ' },
            hike.alltrailsUrl ? { text: hike.name, url: hike.alltrailsUrl } : { text: hike.name },
            {
              text: ` : ${stats}${timing ? ` (${formatClock(timing.startMin)} → ${formatClock(timing.endMin)})` : ''}`,
            },
          ],
        },
        ...driveBullets(stop.id, 'stay'),
      ];
    }
    const place = trip.places.find(({ id }) => id === stop.placeId);
    if (!place) return [];
    return [
      ...driveBullets(stop.id, 'enter'),
      { type: 'bullet', text: [{ text: '📍 ' }, ...cell(place.name, place.url)] },
    ];
  });

  const night = nightOf(trip, day);
  const backups = trip.hikes.filter(({ id }) => day.backupHikeIds.includes(id));
  return [
    { type: 'heading', text: `J${day.index} — ${day.title || formatDay(day.date)}` },
    ...(sun
      ? [
          {
            type: 'bullet' as const,
            text: [
              {
                text: `☀️ Lever ${formatClock(sun.sunriseMin)}, coucher ${formatClock(sun.sunsetMin)}`,
              },
            ],
          },
        ]
      : []),
    ...timeline,
    ...driveBullets(null, 'end'),
    ...(night
      ? [
          {
            type: 'bullet' as const,
            text: [
              { text: '🛏️ Nuit : ' },
              ...cell(night.name, night.url),
              ...(night.bookingStatus ? [{ text: ` (${BOOKING[night.bookingStatus]})` }] : []),
            ],
          },
        ]
      : []),
    ...backups.map(
      (hike): CarnetBlock => ({
        type: 'bullet',
        text: [{ text: '🔁 Repli : ' }, ...cell(hike.name, hike.alltrailsUrl)],
      }),
    ),
    ...(day.notes ? [{ type: 'paragraph' as const, text: [{ text: day.notes }] }] : []),
  ];
}

/** Contenu de la sous-page carnet (SPEC §8), commun à l'aperçu et à l'export. */
export function buildCarnet(
  trip: Trip,
  legs: ItineraryLeg[],
  alerts: Alert[],
  exportedAt: Date,
  dayStartTime: string = DEFAULT_SETTINGS.dayStartTime,
): CarnetBlock[] {
  const totals = tripStats(trip, legs);
  const days = trip.days.length;
  const recap = [
    `Du ${formatDay(trip.startDate)} au ${formatDay(trip.endDate)}`,
    `${days} ${days > 1 ? 'jours' : 'jour'} / ${nightsLabel(days - 1)}`,
    formatKm(totals.hikingKm),
    formatElevationGain(totals.elevationGainM),
    `${formatDuration(totals.hikingMin)} de marche`,
    `${formatDuration(totals.drivingMin)} de route`,
    `Export du ${exportedAt.toISOString().slice(0, 10)}`,
  ].join(' · ');

  const dayRows = trip.days.map((day) => {
    const hikes = hikesOf(trip, day);
    const dayLegs = legs.filter((leg) => leg.dayIndex === day.index);
    const sector = [day.title, ...hikes.map(({ name }) => name)].filter(Boolean).join(' : ');
    const km = hikes.reduce((sum, hike) => sum + hike.stats.distanceKm, 0);
    const gain = hikes.reduce((sum, hike) => sum + (hike.stats.elevationGainM ?? 0), 0);
    return [
      cell(`J${day.index}`),
      cell(sector || '—'),
      cell(hikes.length > 0 ? `${formatKm(km)} / ${formatElevationGain(gain)}` : '—'),
      cell(
        dayLegs.length > 0
          ? formatDuration(dayLegs.reduce((sum, leg) => sum + leg.durationMin, 0))
          : '—',
      ),
      cell(nightOf(trip, day)?.name ?? '—'),
      cell(dayStatus(alerts, day)),
    ];
  });

  const lodgings = trip.places.filter(({ type }) => type === 'lodging');
  const lodgingRows = lodgings.map((place) => {
    const nights = trip.days.filter((day) => nightOf(trip, day)?.id === place.id).length;
    return [
      cell(place.name),
      cell(String(nights)),
      cell(place.price === undefined ? '—' : `${place.price} €`),
      cell(place.bookingStatus ? BOOKING[place.bookingStatus] : '—'),
      cell(DOGS[place.dogPolicy ?? 'unknown']),
      place.url ? cell('Lien', place.url) : cell('—'),
    ];
  });

  const checks = alerts.filter(({ level }) => level !== 'info');
  const budget = tripBudget(trip);
  const checklist = trip.checklist ?? [];

  return [
    { type: 'callout', text: [{ text: recap }] },
    {
      type: 'table',
      header: ['Jour', 'Secteur et marche', 'Distance / dénivelé', 'Route', 'Nuit', 'Statut'],
      rows: dayRows,
    },
    ...trip.days.flatMap((day) => daySection(trip, day, legs, dayStartTime)),
    ...(lodgings.length > 0
      ? [
          { type: 'heading' as const, text: 'Hébergements' },
          {
            type: 'table' as const,
            header: ['Nom', 'Nuits', 'Prix', 'Statut', 'Chiens', 'Lien'],
            rows: lodgingRows,
          },
        ]
      : []),
    ...(checks.length > 0
      ? [
          { type: 'heading' as const, text: 'Points à vérifier' },
          ...checks.map(
            (alert): CarnetBlock => ({ type: 'todo', text: [{ text: alert.message }] }),
          ),
        ]
      : []),
    ...(budget.total > 0
      ? [
          { type: 'heading' as const, text: 'Budget' },
          {
            type: 'table' as const,
            header: ['Poste', 'Montant'],
            rows: [
              ...budget.byCategory.map(({ category, amount }) => [
                cell(EXPENSE_LABELS[category]),
                cell(`${amount} €`),
              ]),
              [cell('Total'), cell(`${budget.total} €`)],
            ],
          },
        ]
      : []),
    ...(checklist.length > 0
      ? [
          { type: 'heading' as const, text: 'Checklist' },
          ...checklist.map(
            ({ label, done }): CarnetBlock => ({
              type: 'todo',
              text: [{ text: label }],
              checked: done,
            }),
          ),
        ]
      : []),
    { type: 'paragraph', text: [{ text: CARNET_FOOTER }] },
  ];
}

function inlineMarkdown(text: Inline[]): string {
  return text.map(({ text: value, url }) => (url ? `[${value}](${url})` : value)).join('');
}

function tableCell(text: Inline[]): string {
  return inlineMarkdown(text).replaceAll('|', '\\|');
}

export function carnetToMarkdown(blocks: CarnetBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'callout':
          return `> ${inlineMarkdown(block.text)}`;
        case 'heading':
          return `## ${block.text}`;
        case 'paragraph':
          return inlineMarkdown(block.text);
        case 'bullet':
          return `- ${inlineMarkdown(block.text)}`;
        case 'todo':
          return `- [${block.checked ? 'x' : ' '}] ${inlineMarkdown(block.text)}`;
        case 'table':
          return [
            `| ${block.header.join(' | ')} |`,
            `| ${block.header.map(() => '---').join(' | ')} |`,
            ...block.rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`),
          ].join('\n');
      }
    })
    .join('\n\n')
    .replaceAll(/(- .+)\n\n(?=- )/g, '$1\n');
}

