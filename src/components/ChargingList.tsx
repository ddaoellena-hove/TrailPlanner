import { Plus, Star } from 'lucide-react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useRankedStations, useSaveSettings, useSettings } from '@/lib/hooks';
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
  const stations = useRankedStations(trip, minKw);
  const settings = useSettings();
  const save = useSaveSettings();
  const shown = stations.stations.slice(0, LIST_LIMIT);

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
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="charging-favorites" className="font-normal">
          Mes réseaux uniquement
        </Label>
        <Switch
          id="charging-favorites"
          checked={settings.favoriteNetworksOnly ?? false}
          onCheckedChange={(favoriteNetworksOnly) =>
            save.mutate({ ...settings, favoriteNetworksOnly })
          }
        />
      </div>
      {stations.isFetching && !stations.data && (
        <p className="text-sm text-muted-foreground">Recherche des bornes…</p>
      )}
      {stations.isError && (
        <p role="alert" className="text-sm text-destructive">
          {stations.error.message}
        </p>
      )}
      {stations.data && stations.stations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucune borne trouvée. Ajoutez des étapes, baissez la puissance ou élargissez aux autres
          réseaux.
        </p>
      )}
      {stations.data?.incomplete && (
        <p className="text-xs text-muted-foreground">
          Le service des bornes est lent : certaines zones n'ont pas répondu, la liste peut être
          partielle.
        </p>
      )}
      {shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {stations.stations.length} bornes sur la carte : orange pour vos réseaux, vert pour les
          autres
          {stations.stations.length > LIST_LIMIT && ` · les ${LIST_LIMIT} premières ici`}
        </p>
      )}
      <ul className="grid gap-2">
        {shown.map((station) => (
          <li key={station.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-medium">
                {station.favorite && (
                  <Star
                    className="size-3.5 shrink-0 fill-amber-500 text-amber-500"
                    aria-label="Réseau favori"
                  />
                )}
                <span className="truncate">{station.name}</span>
              </p>
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
