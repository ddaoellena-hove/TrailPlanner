import { type ReactNode, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_CONSUMPTION_KWH_PER_100KM } from '../../shared/battery';
import { VehicleSchema, type Trip } from '../../shared/schema';

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        step="any"
        value={value}
        className="w-32"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Enregistrés ensemble quand on quitte le groupe : le calcul demande les trois valeurs. */
export function VehicleFields({ trip, onSave }: { trip: Trip; onSave: (trip: Trip) => void }) {
  const { vehicle } = trip;
  const [batteryKwh, setBatteryKwh] = useState(vehicle?.batteryKwh.toString() ?? '');
  const [startPercent, setStartPercent] = useState(vehicle?.startPercent.toString() ?? '');
  const [consumption, setConsumption] = useState(
    (vehicle?.consumptionKwhPer100km ?? DEFAULT_CONSUMPTION_KWH_PER_100KM).toString(),
  );
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (batteryKwh === '' || startPercent === '') {
      setInvalid(false);
      if (vehicle) onSave({ ...trip, vehicle: undefined });
      return;
    }
    const parsed = VehicleSchema.safeParse({
      batteryKwh: Number(batteryKwh),
      startPercent: Number(startPercent),
      consumptionKwhPer100km: Number(consumption),
    });
    setInvalid(!parsed.success);
    const unchanged = JSON.stringify(parsed.data) === JSON.stringify(vehicle);
    if (parsed.success && !unchanged) onSave({ ...trip, vehicle: parsed.data });
  };

  return (
    <div
      className="grid gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <NumberField
          id="vehicle-battery"
          label="Batterie (kWh)"
          value={batteryKwh}
          onChange={setBatteryKwh}
        />
        <NumberField
          id="vehicle-start"
          label="Niveau au départ (%)"
          value={startPercent}
          onChange={setStartPercent}
        />
        <NumberField
          id="vehicle-consumption"
          label="Conso. (kWh/100 km)"
          value={consumption}
          onChange={setConsumption}
        />
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          Le niveau va de 0 à 100 %, la batterie et la consommation doivent être positives.
        </p>
      )}
    </div>
  );
}
