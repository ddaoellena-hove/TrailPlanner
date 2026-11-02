import { Plus } from 'lucide-react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { useChargingStations } from '@/lib/hooks';
import { formatStation } from '@/lib/stations';
import type { ChargingStation, Trip } from '../../shared/schema';

const POWER_OPTIONS = { '50': 'Rapides (50 kW et plus)', '22': '22 kW et plus', '0': 'Toutes' };
const LIST_LIMIT = 20;

/** Bornes de la base nationale IRVE, le long des trajets et autour des étapes. */
export function ChargingList({
  trip,
  minKw,
  onMinKwChange,
  onAdd,
}: {
  trip: Trip;
  minKw: number;
  onMinKwChange: (minKw: number) => void;
  onAdd: (station: ChargingStation) => void;
}) {
  const stations = useChargingStations(trip, minKw);
  const shown = stations.data?.slice(0, LIST_LIMIT) ?? [];

  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">Bornes sur le trajet</h3>
      <LabeledSelect
        id="charging-power"
        label="Puissance"
        value={String(minKw) as keyof typeof POWER_OPTIONS}
        options={POWER_OPTIONS}
        onChange={(value) => onMinKwChange(Number(value))}
      />
      {stations.isFetching && !stations.data && (
        <p className="text-sm text-muted-foreground">Recherche des bornes…</p>
      )}
      {stations.isError && (
        <p role="alert" className="text-sm text-destructive">
          {stations.error.message}
        </p>
      )}
      {stations.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucune borne trouvée. Ajoutez des étapes, ou baissez la puissance.
        </p>
      )}
      {shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {stations.data?.length} bornes, en vert sur la carte
          {(stations.data?.length ?? 0) > LIST_LIMIT && ` · les ${LIST_LIMIT} plus puissantes ici`}
        </p>
      )}
      <ul className="grid gap-2">
        {shown.map((station) => (
          <li key={station.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{station.name}</p>
              <p className="text-xs text-muted-foreground">{formatStation(station)}</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Ajouter ${station.name} au voyage`}
              onClick={() => onAdd(station)}
            >
              <Plus aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
