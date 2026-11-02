import type { Hike, Place, PlaceType } from '../../shared/schema';

export const KIND_LABELS: Record<Hike['kind'], string> = {
  loop: 'Boucle',
  'out-and-back': 'Aller-retour',
  'point-to-point': 'Traversée',
};

export const DOG_LABELS: Record<Hike['dogPolicy'], string> = {
  unknown: 'Chiens : à confirmer',
  allowed: 'Chiens autorisés',
  leash: 'Chiens en laisse',
  forbidden: 'Chiens interdits',
};

export const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  lodging: 'Séjour',
  charging: 'Recharge',
  food: 'Ravitaillement',
  parking: 'Parking',
  poi: 'Point d’intérêt',
};

export const BOOKING_LABELS: Record<NonNullable<Place['bookingStatus']>, string> = {
  idea: 'Idée',
  'to-book': 'À réserver',
  booked: 'Réservé',
  cancelled: 'Annulé',
};

/** Palette catégorielle contrastée sur les fonds de carte clairs. */
const DAY_COLORS = ['#d55e00', '#0072b2', '#009e73', '#cc79a7', '#7b3294', '#b2182b', '#8c6d1f', '#1b7837'];

export function dayColor(dayIndex: number): string {
  return DAY_COLORS[(dayIndex - 1) % DAY_COLORS.length]!;
}

/** Trajets voiture sur la carte : le retour du trail à l'hébergement ressort. */
export const DRIVE_COLOR = '#334155';
export const TRAIL_TO_STAY_COLOR = '#7c3aed';
