import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatDuration,
  formatElevationGain,
  formatKm,
} from '../../shared/format';
import type { ItineraryLeg, Trip } from '../../shared/schema';
import { tripStats } from '../../shared/totals';

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function TripStatsCard({ trip, legs }: { trip: Trip; legs: ItineraryLeg[] }) {
  const stats = tripStats(trip, legs);
  const items = [
    ['Randos', String(stats.hikeCount)],
    ['Distance à pied', formatKm(stats.hikingKm)],
    ['Dénivelé positif', formatElevationGain(stats.elevationGainM)],
    ['Dénivelé négatif', `${integer.format(stats.elevationLossM)} m D−`],
    ['Temps de marche', formatDuration(stats.hikingMin)],
    ['Point culminant', stats.maxAltitudeM === null ? '—' : `${integer.format(stats.maxAltitudeM)} m`],
    ['Distance en voiture', formatKm(stats.drivingKm)],
    ['Temps de route', formatDuration(stats.drivingMin)],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Résumé du voyage</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map(([label, value]) => (
            <div key={label} data-testid={`stat-${label}`}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
