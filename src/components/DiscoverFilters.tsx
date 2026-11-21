import { ChevronDown, ChevronUp, MapPin, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AddressField } from '@/components/AddressField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { DiscoveryIntent, EscapadeOrigin } from '../../shared/schema';

export type DiscoverFilterState = {
  origin: EscapadeOrigin;
  maxDriveMin: number;
  minDistanceKm: number;
  maxDistanceKm: number;
  maxElevationGainM: number | null;
  maxPavedPercent: number | null;
  withDog: boolean;
  intent: DiscoveryIntent;
};

export const ORIGIN_PRESETS: EscapadeOrigin[] = [
  { name: 'Rouen', location: { lat: 49.4431, lng: 1.0993 } },
  { name: 'Le Havre', location: { lat: 49.4944, lng: 0.1079 } },
  { name: 'Évreux', location: { lat: 49.027, lng: 1.1514 } },
];

const INTENT_ITEMS: { key: keyof DiscoveryIntent; label: string }[] = [
  { key: 'scenic', label: 'Paysage' },
  { key: 'isolation', label: 'Calme' },
  { key: 'heritage', label: 'Patrimoine' },
  { key: 'novelty', label: 'Nouveauté' },
];

export function DiscoverFilters({
  value,
  pickOriginMode,
  isSearching,
  onChange,
  onTogglePickOrigin,
  onSearch,
  onSurprise,
}: {
  value: DiscoverFilterState;
  pickOriginMode: boolean;
  isSearching: boolean;
  onChange: (next: DiscoverFilterState) => void;
  onTogglePickOrigin: () => void;
  onSearch: () => void;
  onSurprise: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <AddressField
              key={`${value.origin.name}-${value.origin.location.lat.toFixed(3)}-${value.origin.location.lng.toFixed(3)}`}
              id="discover-origin"
              label="Point de départ"
              initialValue={value.origin.name}
              placeholder="Ville ou adresse en France..."
              onType={() => undefined}
              onSelect={(result) =>
                onChange({
                  ...value,
                  origin: { name: result.label, location: result.location },
                })
              }
            />
          </div>
          <Button
            type="button"
            variant={pickOriginMode ? 'default' : 'outline'}
            size="icon"
            aria-label="Choisir le départ sur la carte"
            title="Choisir le départ sur la carte"
            onClick={onTogglePickOrigin}
          >
            <MapPin className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Accès rapide :</span>
          {ORIGIN_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              variant={value.origin.name === preset.name ? 'secondary' : 'ghost'}
              onClick={() => onChange({ ...value, origin: preset })}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label htmlFor="discover-drive">Route max</Label>
            <span className="font-medium tabular-nums">{value.maxDriveMin} min</span>
          </div>
          <Slider
            id="discover-drive"
            min={15}
            max={120}
            step={5}
            value={[value.maxDriveMin]}
            onValueChange={([next]) =>
              next !== undefined && onChange({ ...value, maxDriveMin: next })
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="discover-min-km" className="text-xs">
              Distance min (km)
            </Label>
            <Input
              id="discover-min-km"
              type="number"
              min={1}
              max={60}
              step={1}
              value={value.minDistanceKm}
              onChange={(event) => {
                const min = Math.max(1, Number(event.target.value) || 1);
                onChange({
                  ...value,
                  minDistanceKm: min,
                  maxDistanceKm: Math.max(min, value.maxDistanceKm),
                });
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="discover-max-km" className="text-xs">
              Distance max (km)
            </Label>
            <Input
              id="discover-max-km"
              type="number"
              min={1}
              max={80}
              step={1}
              value={value.maxDistanceKm}
              onChange={(event) => {
                const max = Math.max(value.minDistanceKm, Number(event.target.value) || value.minDistanceKm);
                onChange({ ...value, maxDistanceKm: max });
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Switch
            checked={value.withDog}
            onCheckedChange={(checked) => onChange({ ...value, withDog: checked })}
          />
          Avec chien
        </label>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Envies & limites
          {advancedOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button>
      </div>

      {advancedOpen && (
        <div className="grid gap-3 border-t pt-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {INTENT_ITEMS.map(({ key, label }) => (
              <div key={key} className="grid gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="tabular-nums font-medium">
                    {Math.round(value.intent[key] * 100)} %
                  </span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={10}
                  value={[Math.round(value.intent[key] * 100)]}
                  onValueChange={([pct]) =>
                    pct !== undefined &&
                    onChange({
                      ...value,
                      intent: { ...value.intent, [key]: pct / 100 },
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="discover-max-gain" className="text-xs">
                D+ max (m)
              </Label>
              <Input
                id="discover-max-gain"
                type="number"
                min={50}
                max={3000}
                step={50}
                placeholder="Sans limite"
                value={value.maxElevationGainM ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  onChange({
                    ...value,
                    maxElevationGainM: raw === '' ? null : Math.max(0, Number(raw) || 0),
                  });
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="discover-max-paved" className="text-xs">
                Bitume max (%)
              </Label>
              <Input
                id="discover-max-paved"
                type="number"
                min={0}
                max={100}
                step={5}
                placeholder="Sans limite"
                value={value.maxPavedPercent ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  onChange({
                    ...value,
                    maxPavedPercent:
                      raw === '' ? null : Math.min(100, Math.max(0, Number(raw) || 0)),
                  });
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" className="flex-1" disabled={isSearching} onClick={onSearch}>
          <Search className="size-4" aria-hidden />
          {isSearching ? 'Recherche...' : 'Explorer'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSearching}
          onClick={onSurprise}
        >
          <Sparkles className="size-4" aria-hidden />
          Surprends-moi
        </Button>
      </div>
    </div>
  );
}
