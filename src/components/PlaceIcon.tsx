import { BedDouble, Fuel, MapPin, SquareParking, Utensils } from 'lucide-react';
import type { PlaceType } from '../../shared/schema';

const ICONS = {
  lodging: BedDouble,
  charging: Fuel,
  food: Utensils,
  parking: SquareParking,
  poi: MapPin,
} satisfies Record<PlaceType, unknown>;

export function PlaceIcon({ type, className }: { type: PlaceType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} aria-hidden />;
}
