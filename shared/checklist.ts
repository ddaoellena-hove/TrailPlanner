import type { ChecklistItem, Trip } from './schema';

const BASE = ['Trousse de secours', 'Cartes hors ligne téléchargées', 'Chargeur et batterie externe'];
const DOG = ['Eau et gamelle du chien', 'Laisse', 'Carnet de vaccination'];
const ELECTRIC = ['Câble de recharge', 'Badge ou application de recharge'];
const WINTER = [
  'Pneus hiver ou chaînes',
  'Lampe frontale',
  'Vêtements chauds et gants',
  'Vérifier l’enneigement et le bulletin d’avalanche',
];

function isWinter(date: string): boolean {
  const month = Number(date.slice(5, 7));
  return month >= 11 || month <= 4;
}

/** Tâches suggérées selon le voyage, sans celles déjà dans la liste. */
export function checklistSuggestions(trip: Trip): ChecklistItem[] {
  const toBook = trip.places
    .filter(({ type, bookingStatus }) => type === 'lodging' && bookingStatus !== 'booked')
    .filter(({ bookingStatus }) => bookingStatus !== 'cancelled')
    .map(({ name }) => `Réserver ${name}`);
  const labels = [
    ...BASE,
    ...(trip.travelers.withDog ? DOG : []),
    ...(trip.travelers.electricVehicle ? ELECTRIC : []),
    ...(isWinter(trip.startDate) || isWinter(trip.endDate) ? WINTER : []),
    ...toBook,
  ];
  const existing = new Set((trip.checklist ?? []).map(({ label }) => label));
  return labels
    .filter((label) => !existing.has(label))
    .map((label) => ({ id: crypto.randomUUID(), label, done: false }));
}
