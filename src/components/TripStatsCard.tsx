import {
  Car,
  Footprints,
  type LucideIcon,
  MapIcon,
  Mountain,
  MountainSnow,
  Route,
  Timer,
  TrendingDown,
} from 'lucide-react';
import { type StatTone, TONE_ICON_CLASSES } from '@/components/StatBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDuration, formatElevationGain, formatKm } from '../../shared/format';
import type { ItineraryLeg, Trip } from '../../shared/schema';
import { tripStats } from '../../shared/totals';

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function TripStatsCard({ trip, legs }: { trip: Trip; legs: ItineraryLeg[] }) {
  const stats = tripStats(trip, legs);
  const items: [string, string, LucideIcon, StatTone][] = [
    ['Randos', String(stats.hikeCount), MapIcon, 'distance'],
    ['Distance à pied', formatKm(stats.hikingKm), Footprints, 'distance'],
    ['Dénivelé positif', formatElevationGain(stats.elevationGainM), Mountain, 'ascent'],
    ['Dénivelé négatif', `${integer.format(stats.elevationLossM)} m D−`, TrendingDown, 'ascent'],
    ['Temps de marche', formatDuration(stats.hikingMin), Timer, 'duration'],
    [
      'Point culminant',
      stats.maxAltitudeM === null ? '—' : `${integer.format(stats.maxAltitudeM)} m`,
      MountainSnow,
      'ascent',
    ],
    ['Distance en voiture', formatKm(stats.drivingKm), Route, 'drive'],
    ['Temps de route', formatDuration(stats.drivingMin), Car, 'drive'],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Résumé du voyage</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
          {items.map(([label, value, Icon, tone]) => (
            <div key={label} data-testid={`stat-${label}`} className="flex items-start gap-2">
              <span className={cn('rounded-md p-1.5', TONE_ICON_CLASSES[tone])}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-base leading-tight font-semibold tabular-nums">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
