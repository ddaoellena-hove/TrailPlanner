import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Une couleur par nature d'information, la même partout dans l'interface. */
const TONES = {
  distance: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ascent: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  duration: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  drive: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  sun: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  weather: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  end: 'bg-primary/10 text-primary',
  warning: 'bg-destructive/10 text-destructive',
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
