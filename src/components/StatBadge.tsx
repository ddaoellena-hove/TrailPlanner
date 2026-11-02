import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Une couleur par nature d'information, la même partout dans l'interface. */
const TONES = {
  distance: 'bg-tone-distance/10 text-tone-distance',
  ascent: 'bg-tone-ascent/10 text-tone-ascent',
  duration: 'bg-tone-duration/10 text-tone-duration',
  drive: 'bg-tone-drive/10 text-tone-drive',
  sun: 'bg-tone-sun/10 text-tone-sun',
  weather: 'bg-tone-weather/10 text-tone-weather',
  end: 'bg-tone-end/10 text-tone-end',
  warning: 'bg-tone-warning/10 text-tone-warning',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export type StatTone = keyof typeof TONES;

export const TONE_ICON_CLASSES: Record<StatTone, string> = TONES;

export function StatBadge({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: StatTone;
  children: ReactNode;
}) {
  return (
    <Badge className={cn('tabular-nums', TONES[tone])}>
      <Icon data-icon="inline-start" aria-hidden />
      {children}
    </Badge>
  );
}
