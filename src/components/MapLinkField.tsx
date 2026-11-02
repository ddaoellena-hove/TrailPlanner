import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { MapLinkResult } from '../../shared/schema';

/** Récupère une position depuis un lien Google Maps collé. */
export function MapLinkField({
  onResolved,
  onClear,
}: {
  onResolved: (result: MapLinkResult) => void;
  onClear: () => void;
}) {
  const [link, setLink] = useState('');
  const resolve = useMutation({ mutationFn: api.resolveMapLink, onSuccess: onResolved });

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="map-link">Lien Google Maps</Label>
      <div className="flex gap-2">
        <Input
          id="map-link"
          placeholder="https://maps.app.goo.gl/…"
          value={link}
          onChange={(event) => {
            setLink(event.target.value);
            resolve.reset();
            onClear();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!link.trim() || resolve.isPending}
          onClick={() => resolve.mutate(link)}
        >
          Lire le lien
        </Button>
      </div>
      {resolve.isError && (
        <p role="alert" className="text-sm text-destructive">
          {resolve.error.message}
        </p>
      )}
      {resolve.data && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {resolve.data.approximate
            ? 'Pas de coordonnées dans ce lien : position estimée d’après le lieu recherché, à vérifier.'
            : `Position : ${resolve.data.location.lat.toFixed(5)}, ${resolve.data.location.lng.toFixed(5)}`}
        </p>
      )}
    </div>
  );
}
