import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DOG_LABELS, KIND_LABELS } from '@/lib/labels';
import type { Hike } from '../../shared/schema';

export function LabeledSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(options) as T[]).map((option) => (
            <SelectItem key={option} value={option}>
              {options[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Type de rando et politique chiens, communs à l'import et à la fiche. */
export function HikeSelects({
  idPrefix,
  kind,
  dogPolicy,
  onChange,
}: {
  idPrefix: string;
  kind: Hike['kind'];
  dogPolicy: Hike['dogPolicy'];
  onChange: (changes: Partial<Pick<Hike, 'kind' | 'dogPolicy'>>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <LabeledSelect
        id={`${idPrefix}-kind`}
        label="Type"
        value={kind}
        options={KIND_LABELS}
        onChange={(value) => onChange({ kind: value })}
      />
      <LabeledSelect
        id={`${idPrefix}-dog`}
        label="Politique chiens"
        value={dogPolicy}
        options={DOG_LABELS}
        onChange={(value) => onChange({ dogPolicy: value })}
      />
    </div>
  );
}
