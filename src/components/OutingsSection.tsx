import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { formatDay, formatDuration } from '../../shared/format';
import type { LibraryHike } from '../../shared/schema';

/** Sorties d'une rando de la bibliothèque, depuis sa fiche ou depuis un voyage. */
export function OutingsSection({
  hike,
  defaultDate,
  tripSlug,
}: {
  hike: LibraryHike;
  defaultDate: string;
  tripSlug?: string;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(defaultDate);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['library'] });
  const onError = (error: Error) => toast.error(`Sortie non enregistrée : ${error.message}`);

  const add = useMutation({
    mutationFn: () => {
      const durationMin = Number(hours) * 60 + Number(minutes);
      return api.addOuting(hike.id, {
        date,
        ...(durationMin > 0 ? { durationMin } : {}),
        ...(tripSlug ? { tripSlug } : {}),
      });
    },
    onSuccess: async () => {
      setHours('');
      setMinutes('');
      await refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (outingId: string) => api.deleteOuting(hike.id, outingId),
    onSuccess: refresh,
    onError,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <section className="grid gap-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-medium">J'ai fait cette rando</h3>
        <p className="text-xs text-muted-foreground">
          Estimée à {formatDuration(hike.stats.estimatedDurationMin)}. La durée réelle sert à
          ajuster votre rythme.
        </p>
      </div>
      {hike.outings.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {hike.outings.map((outing) => (
            <li key={outing.id} className="flex items-center justify-between gap-2">
              <span className="tabular-nums">
                {formatDay(outing.date)}
                {outing.durationMin !== undefined && ` · ${formatDuration(outing.durationMin)}`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Retirer la sortie du ${formatDay(outing.date)}`}
                onClick={() => remove.mutate(outing.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="outing-date" className="text-xs text-muted-foreground">
            Date
          </Label>
          <Input
            id="outing-date"
            type="date"
            required
            value={date}
            className="w-40"
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="outing-hours" className="text-xs text-muted-foreground">
            Heures
          </Label>
          <Input
            id="outing-hours"
            type="number"
            min={0}
            value={hours}
            className="w-20"
            onChange={(event) => setHours(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="outing-minutes" className="text-xs text-muted-foreground">
            Minutes
          </Label>
          <Input
            id="outing-minutes"
            type="number"
            min={0}
            max={59}
            value={minutes}
            className="w-20"
            onChange={(event) => setMinutes(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={add.isPending}>
          Enregistrer la sortie
        </Button>
      </form>
    </section>
  );
}
