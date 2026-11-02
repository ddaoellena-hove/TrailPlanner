import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Une couleur par nature d'information, la même partout dans l'interface. */
const TONES = {
  distance: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ascent: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  duration: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  drive: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  sun: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  weather: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  end: 'border-primary/40 bg-primary/10 text-primary',
  warning: 'border-destructive/40 bg-destructive/10 text-destructive',
  neutral: 'border-border bg-muted text-muted-foreground',
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
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium whitespace-nowrap tabular-nums', TONES[tone])}
    >
      <Icon className="size-3" aria-hidden />
      {children}
    </Badge>
  );
}
