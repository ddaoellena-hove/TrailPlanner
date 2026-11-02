import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { NewTripDialog } from '@/components/NewTripDialog';
import { TripCard } from '@/components/TripCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

export function TripsPage() {
  const trips = useQuery({ queryKey: ['trips'], queryFn: api.listTrips });

  const newTripButton = (
    <Button>
      <Plus aria-hidden />
      Nouveau voyage
    </Button>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Mes voyages</h1>
        {Boolean(trips.data?.length) && <NewTripDialog trigger={newTripButton} />}
      </div>

      {trips.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      )}

      {trips.isError && (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les voyages : {trips.error.message}. Le serveur local est-il lancé ?
        </p>
      )}

      {trips.data?.length === 0 && (
        <div className="grid justify-items-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <div>
            <p className="font-medium">Aucun voyage pour l'instant</p>
            <p className="text-sm text-muted-foreground">
              Créez un voyage, puis importez vos GPX AllTrails.
            </p>
          </div>
          <NewTripDialog trigger={newTripButton} />
        </div>
      )}

      {Boolean(trips.data?.length) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trips.data?.map((trip) => <TripCard key={trip.slug} trip={trip} />)}
        </div>
      )}
    </main>
  );
}
