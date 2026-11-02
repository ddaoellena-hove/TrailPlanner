import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, EllipsisVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import {
  formatDateRange,
  formatDayCount,
  formatElevationGain,
  formatKm,
} from '../../shared/format';
import type { TripSummary } from '../../shared/schema';

export function TripCard({ trip }: { trip: TripSummary }) {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const refreshTrips = () => queryClient.invalidateQueries({ queryKey: ['trips'] });

  const duplicateTrip = useMutation({
    mutationFn: () => api.duplicateTrip(trip.slug),
    onSuccess: refreshTrips,
    onError: (error) => toast.error(`Duplication impossible : ${error.message}`),
  });

  const deleteTrip = useMutation({
    mutationFn: () => api.deleteTrip(trip.slug),
    onSuccess: refreshTrips,
    onError: (error) => toast.error(`Suppression impossible : ${error.message}`),
  });

  return (
    <Card className="relative transition-colors hover:border-primary/50">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-base leading-snug">
          <Link to={`/voyages/${trip.slug}`} className="after:absolute after:inset-0">
            {trip.name}
          </Link>
        </CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative z-10 -mt-1 -mr-2 size-8"
              aria-label={`Actions pour ${trip.name}`}
            >
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => duplicateTrip.mutate()}>
              <Copy aria-hidden />
              Dupliquer
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmingDelete(true)}
            >
              <Trash2 className="text-destructive" aria-hidden />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          {formatDateRange(trip.startDate, trip.endDate)} · {formatDayCount(trip.dayCount)}
        </p>
        <p className="tabular-nums">
          {formatKm(trip.totalKm)} · {formatElevationGain(trip.totalElevationGainM)}
        </p>
        <div>
          <Badge variant={trip.lastNotionExportAt ? 'secondary' : 'outline'}>
            {trip.lastNotionExportAt
              ? `Exporté le ${formatDateRange(trip.lastNotionExportAt.slice(0, 10), trip.lastNotionExportAt.slice(0, 10))}`
              : 'Non exporté'}
          </Badge>
        </div>
      </CardContent>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {trip.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le voyage est déplacé dans la corbeille (trips/.trash) avec ses fichiers GPX.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => deleteTrip.mutate()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
