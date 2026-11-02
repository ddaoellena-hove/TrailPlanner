import { ExternalLink, Footprints, MapPinned, Mountain, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatBadge } from '@/components/StatBadge';
import { BOOKING_LABELS } from '@/lib/labels';
import { formatDuration, formatElevationGain, formatKm } from '../../shared/format';
import type { Hike, LatLng, Place } from '../../shared/schema';
import { directionsUrl } from '../../shared/trip';

export function hikeSummary({ stats }: Hike): string {
  return [
    formatKm(stats.distanceKm),
    stats.elevationGainM === null ? 'D+ inconnu' : formatElevationGain(stats.elevationGainM),
    formatDuration(stats.estimatedDurationMin),
  ].join(' · ');
}

export function HikeBadges({ hike: { stats } }: { hike: Hike }) {
  return (
    <>
      <StatBadge icon={Footprints} tone="distance">
        {formatKm(stats.distanceKm)}
      </StatBadge>
      <StatBadge icon={Mountain} tone="ascent">
        {stats.elevationGainM === null ? 'D+ inconnu' : formatElevationGain(stats.elevationGainM)}
      </StatBadge>
      <StatBadge icon={Timer} tone="duration">
        {formatDuration(stats.estimatedDurationMin)}
      </StatBadge>
    </>
  );
}

function ExternalAnchor({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </a>
  );
}

export function StopDetails({
  icon,
  name,
  summary,
  directionsTo,
  alltrailsUrl,
  departure,
  stay,
  onShowOnMap,
  onOpen,
  extra,
}: {
  icon: ReactNode;
  name: string;
  summary: ReactNode;
  directionsTo: LatLng;
  alltrailsUrl?: string;
  departure?: Place;
  stay?: Place;
  onShowOnMap?: () => void;
  onOpen?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <span className="mt-1 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        {onOpen ? (
          <button type="button" className="text-left font-medium hover:underline" onClick={onOpen}>
            {name}
          </button>
        ) : (
          <p className="font-medium">{name}</p>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5 text-sm text-muted-foreground">{summary}</div>
        {departure && <p className="text-sm text-muted-foreground">Départ : {departure.name}</p>}
        {stay && stay.name !== name && (
          <p className="text-sm text-muted-foreground">Séjour : {stay.name}</p>
        )}
        {stay?.bookingStatus && (
          <p className="text-sm text-muted-foreground">{BOOKING_LABELS[stay.bookingStatus]}</p>
        )}
        {extra}
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
          {onShowOnMap && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={onShowOnMap}
            >
              Voir sur la carte
            </button>
          )}
          <ExternalAnchor href={directionsUrl(directionsTo)} icon={<MapPinned aria-hidden />}>
            Itinéraire
          </ExternalAnchor>
          {alltrailsUrl && (
            <ExternalAnchor href={alltrailsUrl} icon={<ExternalLink aria-hidden />}>
              AllTrails
            </ExternalAnchor>
          )}
          {stay?.url && (
            <ExternalAnchor href={stay.url} icon={<ExternalLink aria-hidden />}>
              Lien du séjour
            </ExternalAnchor>
          )}
        </div>
      </div>
    </div>
  );
}
