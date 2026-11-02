import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { GeocodeResult } from '../../shared/schema';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

export function AddressField({
  id,
  label,
  initialValue = '',
  placeholder,
  onType,
  onSelect,
}: {
  id: string;
  label: string;
  initialValue?: string;
  placeholder: string;
  onType: () => void;
  onSelect: (result: GeocodeResult) => void;
}) {
  const [query, setQuery] = useState(initialValue);
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ['geocode', debounced],
    queryFn: () => api.geocode(debounced),
    enabled: open && debounced.length >= MIN_QUERY_LENGTH,
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="relative grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          onType();
        }}
      />
      {results.isError && open && (
        <p role="alert" className="text-sm text-destructive">
          {results.error.message}
        </p>
      )}
      {open && results.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun résultat en France.</p>
      )}
      {open && Boolean(results.data?.length) && (
        <ul
          role="listbox"
          aria-label="Suggestions d'adresses"
          className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover py-1 text-sm shadow-md"
        >
          {results.data?.map((result) => (
            <li key={result.label} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  setQuery(result.label);
                  setOpen(false);
                  onSelect(result);
                }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
