import { ChevronDown, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Alert, AlertLevel } from '../../shared/alerts';

const LEVELS: Record<AlertLevel, { icon: typeof Info; className: string; label: string }> = {
  error: { icon: CircleAlert, className: 'text-destructive', label: 'Erreurs' },
  warning: { icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400', label: 'À vérifier' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Infos' },
};

const FILTERS = { all: 'Toutes', error: 'Erreurs', warning: 'À vérifier', info: 'Infos' };

/** Badges d'alertes d'un jour : un compteur par niveau. */
export function AlertBadges({ alerts }: { alerts: Alert[] }) {
  return (Object.keys(LEVELS) as AlertLevel[]).map((level) => {
    const count = alerts.filter((alert) => alert.level === level).length;
    if (count === 0) return null;
    const { icon: Icon, className, label } = LEVELS[level];
    return (
      <span
        key={level}
        title={alerts.filter((alert) => alert.level === level).map((a) => a.message).join('\n')}
        aria-label={`${label} : ${count}`}
        className={cn('inline-flex items-center gap-0.5 text-xs font-medium', className)}
      >
        <Icon className="size-3.5" aria-hidden />
        {count}
      </span>
    );
  });
}

export function AlertsPanel({
  alerts,
  onFocus,
  onConvert,
  onAddRecovery,
}: {
  alerts: Alert[];
  onFocus: (alert: Alert) => void;
  onConvert: (hikeId: string) => void;
  onAddRecovery: (stopId: string) => void;
}) {
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const shown = alerts.filter((alert) => filter === 'all' || alert.level === filter);
  const hasBlocking = alerts.some(({ level }) => level !== 'info');

  if (alerts.length === 0) return null;

  return (
    <Card>
      <Collapsible defaultOpen={hasBlocking}>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-3 text-base">
            Alertes ({alerts.length})
            <AlertBadges alerts={alerts} />
          </CardTitle>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="group size-8"
              aria-label="Afficher ou masquer les alertes"
            >
              <ChevronDown
                className="transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-3">
            <div className="w-40 [&_label]:sr-only">
              <LabeledSelect
                id="alerts-filter"
                label="Filtrer les alertes"
                value={filter}
                options={FILTERS}
                onChange={setFilter}
              />
            </div>
            <ul className="grid max-h-64 gap-2 overflow-y-auto text-sm">
              {shown.map((alert) => {
                const { icon: Icon, className } = LEVELS[alert.level];
                const { hikeId, stopId } = alert;
                return (
                  <li key={alert.id} className="grid gap-1">
                    <button
                      type="button"
                      className="flex items-start gap-2 text-left hover:underline"
                      onClick={() => onFocus(alert)}
                    >
                      <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
                      {alert.message}
                    </button>
                    {alert.code === 'A5' && hikeId && stopId && (
                      <div className="flex flex-wrap gap-2 pl-6">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Convertir ${alert.message.split(' : ')[0]} en aller-retour`}
                          onClick={() => onConvert(hikeId)}
                        >
                          Convertir en aller-retour
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onAddRecovery(stopId)}>
                          Ajouter un trajet de récupération
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
