import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDateRange } from '../../shared/format';

export function AddEscapadeToTripDialog({
  open,
  escapadeTitle,
  hasBonusStop,
  ensureSaved,
  onClose,
}: {
  open: boolean;
  escapadeTitle: string;
  hasBonusStop: boolean;
  /** Enregistre l'escapade si elle ne l'est pas encore, puis retourne son identifiant. */
  ensureSaved: () => Promise<string>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trips = useQuery({
    queryKey: ['trips'],
    queryFn: api.listTrips,
    enabled: open,
  });

  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [selectedDay, setSelectedDay] = useState<string>('1');

  const activeTripSummary = trips.data?.find((t) => t.slug === selectedSlug) ?? trips.data?.[0];
  const effectiveSlug = activeTripSummary?.slug ?? '';
  const dayCount = activeTripSummary?.dayCount ?? 1;
  const effectiveDay = String(Math.min(dayCount, Math.max(1, Number(selectedDay) || 1)));

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSlug) throw new Error('Aucun voyage sélectionné');
      const escapadeId = await ensureSaved();
      return api.addEscapadeToTrip(escapadeId, {
        tripSlug: effectiveSlug,
        dayIndex: Number(effectiveDay),
      });
    },
    onSuccess: ({ trip }) => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trip', trip.slug] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      toast.success(`Ajoutée au voyage « ${trip.name} »`, {
        action: {
          label: 'Ouvrir le voyage',
          onClick: () => void navigate(`/voyages/${trip.slug}`),
        },
      });
      onClose();
    },
    onError: (error) => {
      toast.error(`Impossible d’ajouter au voyage : ${error.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter à un voyage</DialogTitle>
          <DialogDescription>
            La boucle GPX de « {escapadeTitle} »
            {hasBonusStop ? ' et son étape bonus' : ''} seront ajoutées au jour choisi (et copiées
            dans votre bibliothèque « Mes randos »).
          </DialogDescription>
        </DialogHeader>

        {trips.isPending && (
          <p className="text-sm text-muted-foreground">Chargement de vos voyages...</p>
        )}

        {trips.isSuccess && trips.data.length === 0 && (
          <div className="grid gap-3 rounded-md border border-dashed p-4 text-sm">
            <p className="text-muted-foreground">
              Vous n’avez pas encore de voyage. Créez-en un sur la page d’accueil, puis revenez
              depuis « Mes escapades ».
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                void navigate('/');
              }}
            >
              <ExternalLink className="size-4" aria-hidden />
              Aller à « Mes voyages »
            </Button>
          </div>
        )}

        {trips.isSuccess && trips.data.length > 0 && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="trip-select">Voyage</Label>
              <Select
                value={effectiveSlug}
                onValueChange={(slug) => {
                  setSelectedSlug(slug);
                  setSelectedDay('1');
                }}
              >
                <SelectTrigger id="trip-select">
                  <SelectValue placeholder="Choisir un voyage" />
                </SelectTrigger>
                <SelectContent>
                  {trips.data.map((trip) => (
                    <SelectItem key={trip.slug} value={trip.slug}>
                      {trip.name} ({formatDateRange(trip.startDate, trip.endDate)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="day-select">Jour du voyage</Label>
              <Select value={effectiveDay} onValueChange={setSelectedDay}>
                <SelectTrigger id="day-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: dayCount }, (_, i) => i + 1).map((index) => (
                    <SelectItem key={index} value={String(index)}>
                      Jour {index}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="button"
            disabled={!effectiveSlug || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            <CalendarPlus className="size-4" aria-hidden />
            {addMutation.isPending ? 'Ajout...' : 'Ajouter au voyage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
