import type { Expense, Trip } from './schema';
import { nightOf } from './trip';

export const EXPENSE_LABELS: Record<Expense['category'], string> = {
  lodging: 'Hébergement',
  energy: 'Carburant et recharge',
  toll: 'Péages',
  food: 'Repas',
  activity: 'Activités',
  other: 'Divers',
};

export type TripBudget = {
  total: number;
  byCategory: { category: Expense['category']; amount: number }[];
  /** Nuits dont l'hébergement n'a pas de prix : le total est alors sous-estimé. */
  nightsWithoutPrice: number;
};

export function tripBudget(trip: Trip): TripBudget {
  const nights = trip.days.slice(0, -1).map((day) => nightOf(trip, day));
  const lodging = nights.reduce((sum, night) => sum + (night?.price ?? 0), 0);
  const amounts = new Map<Expense['category'], number>([['lodging', lodging]]);
  for (const { category, amount } of trip.expenses ?? []) {
    amounts.set(category, (amounts.get(category) ?? 0) + amount);
  }
  const byCategory = (Object.keys(EXPENSE_LABELS) as Expense['category'][])
    .map((category) => ({ category, amount: amounts.get(category) ?? 0 }))
    .filter(({ amount }) => amount > 0);
  return {
    total: byCategory.reduce((sum, { amount }) => sum + amount, 0),
    byCategory,
    nightsWithoutPrice: nights.filter((night) => night && night.price === undefined).length,
  };
}
