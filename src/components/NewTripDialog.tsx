import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { NewTripSchema } from '../../shared/schema';

export function NewTripDialog({ trigger }: { trigger: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [withDog, setWithDog] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const createTrip = useMutation({
    mutationFn: api.createTrip,
    onSuccess: async (trip) => {
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
      void navigate(`/voyages/${trip.slug}`);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input = NewTripSchema.safeParse({ name, startDate, endDate, withDog });
    if (!input.success) {
      setValidationError(input.error.issues[0]?.message ?? 'Formulaire invalide');
      return;
    }
    setValidationError(null);
    createTrip.mutate(input.data);
  };

  const error = validationError ?? createTrip.error?.message;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Nouveau voyage</DialogTitle>
            <DialogDescription>
              Les jours sont générés à partir des dates. Vous ajouterez ensuite les étapes de
              chaque jour.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="trip-name">Nom du voyage</Label>
            <Input
              id="trip-name"
              required
              autoFocus
              placeholder="Dévoluy & Champsaur"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="trip-start">Début</Label>
              <Input
                id="trip-start"
                type="date"
                required
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="trip-end">Fin</Label>
              <Input
                id="trip-end"
                type="date"
                required
                min={startDate || undefined}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="trip-dog"
              checked={withDog}
              onCheckedChange={(checked) => setWithDog(checked === true)}
            />
            <Label htmlFor="trip-dog">Avec chien</Label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={createTrip.isPending}>
              Créer le voyage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
