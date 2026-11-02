import { Layers } from 'lucide-react';
import { useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useSaveSettings } from '@/lib/hooks';
import { BASE_LAYERS, mapViewOf, OVERLAYS, TRIP_LAYERS } from '@/lib/map-layers';
import type { Settings } from '../../shared/schema';

const BASE_OPTIONS = Object.fromEntries(
  Object.entries(BASE_LAYERS).map(([id, { label }]) => [id, label]),
) as Record<Settings['mapBaseLayer'], string>;

function toggled(list: string[], id: string, present: boolean): string[] {
  return present ? [...list.filter((item) => item !== id), id] : list.filter((item) => item !== id);
}

function LayerSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Personnalisation de la carte : s'applique tout de suite et reste d'un voyage à l'autre. */
export function LayersMenu({ settings }: { settings: Settings }) {
  const view = mapViewOf(settings);
  const [opacity, setOpacity] = useState<number | null>(null);
  const save = useSaveSettings();

  const update = (changes: Partial<Settings>) => save.mutate({ ...settings, ...changes });
  const shownOpacity = opacity ?? view.baseOpacity;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Layers aria-hidden />
          Couches
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-4">
        <div className="grid gap-3">
          <LabeledSelect
            id="map-base-layer"
            label="Fond de carte"
            value={settings.mapBaseLayer}
            options={BASE_OPTIONS}
            onChange={(mapBaseLayer) => update({ mapBaseLayer })}
          />
          <div className="grid gap-2">
            <Label id="map-base-opacity" className="font-normal">
              Atténuer le fond : {Math.round(shownOpacity * 100)} %
            </Label>
            <Slider
              aria-labelledby="map-base-opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={[shownOpacity]}
              onValueChange={([value]) => setOpacity(value ?? 1)}
              onValueCommit={([value]) => {
                setOpacity(null);
                update({ mapBaseOpacity: value ?? 1 });
              }}
            />
          </div>
        </div>

        <section className="grid gap-2 border-t pt-3">
          <h3 className="text-sm font-medium">Terrain</h3>
          {OVERLAYS.map(({ id, label }) => (
            <LayerSwitch
              key={id}
              id={`overlay-${id}`}
              label={label}
              checked={view.overlays.includes(id)}
              onChange={(checked) =>
                update({ mapOverlays: toggled(view.overlays, id, checked) })
              }
            />
          ))}
        </section>

        <section className="grid gap-2 border-t pt-3">
          <h3 className="text-sm font-medium">Voyage</h3>
          {TRIP_LAYERS.map(({ id, label }) => (
            <LayerSwitch
              key={id}
              id={`trip-layer-${id}`}
              label={label}
              checked={!view.hidden.includes(id)}
              onChange={(checked) =>
                update({ mapHiddenLayers: toggled(view.hidden, id, !checked) })
              }
            />
          ))}
        </section>

        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            update({
              mapBaseLayer: 'ign-plan',
              mapBaseOpacity: undefined,
              mapOverlays: undefined,
              mapHiddenLayers: undefined,
            })
          }
        >
          Réinitialiser la carte
        </Button>
      </PopoverContent>
    </Popover>
  );
}
