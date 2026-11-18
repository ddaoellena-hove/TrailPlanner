import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type LegendItem = { label: string; color: string; shape: 'line' | 'dashed' | 'dot' };

function Swatch({ color, shape }: Pick<LegendItem, 'color' | 'shape'>) {
  if (shape === 'dot') {
    return <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />;
  }
  return (
    <span
      className={cn('w-4 border-t-[3px]', shape === 'dashed' && 'border-dashed')}
      style={{ borderColor: color }}
    />
  );
}

/** Légende de ce qui est affiché. Fixée en clair, comme le fond de carte. */
export function MapLegend({ items }: { items: LegendItem[] }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] rounded-md bg-white/90 px-2 py-1 text-xs text-neutral-900 shadow ring-1 ring-black/10 sm:max-w-sm">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 font-medium"
        onClick={() => setOpen(!open)}
      >
        Légende
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronUp className="size-3.5" aria-hidden />
        )}
      </button>
      {open && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {items.map(({ label, color, shape }) => (
            <li key={label} className="flex items-center gap-1.5">
              <Swatch color={color} shape={shape} />
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
