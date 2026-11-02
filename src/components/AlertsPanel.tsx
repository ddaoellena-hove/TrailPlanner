import { ChevronDown, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Alert, AlertLevel } from '../../shared/alerts';
import type { Hike } from '../../shared/schema';

const LEVELS: Record<AlertLevel, { icon: typeof Info; className: string; label: string }> = {
  error: { icon: CircleAlert, className: 'text-destructive', label: 'Erreurs' },
  warning: { icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400', label: 'À vérifier' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Infos' },
};

type DogPolicy = Exclude<Hike['dogPolicy'], 'unknown'>;

const DOG_ACTIONS: [DogPolicy, string][] = [
  ['allowed', 'Autorisés'],
  ['leash', 'En laisse'],
  ['forbidden', 'Interdits'],
];

const isDogAlert = ({ code }: Alert) => code === 'A3' || code === 'A4';

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
  onSetDogPolicy,
}: {
  alerts: Alert[];
  onFocus: (alert: Alert) => void;
  onConvert: (hikeId: string) => void;
  onAddRecovery: (stopId: string) => void;
  onSetDogPolicy: (ids: string[], policy: DogPolicy) => void;
}) {
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const shown = alerts.filter((alert) => filter === 'all' || alert.level === filter);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const dogAlerts = alerts.filter(isDogAlert);
  const selected = dogAlerts.filter(({ id }) => selectedIds.includes(id));
  const allSelected = dogAlerts.length > 0 && selected.length === dogAlerts.length;

  const toggle = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id),
    );

  const applyDogPolicy = (policy: DogPolicy) => {
    onSetDogPolicy(
      selected.flatMap(({ hikeId, placeId }) => hikeId ?? placeId ?? []),
      policy,
    );
    setSelectedIds([]);
  };

  if (alerts.length === 0) return null;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
          <CardHeader className="flex-1">
            <CardTitle className="flex items-center gap-3 text-base">
              Alertes ({alerts.length})
              <AlertBadges alerts={alerts} />
            </CardTitle>
          </CardHeader>
          <ChevronDown
            className="mr-6 size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
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
            {dogAlerts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <Checkbox
                  id="dog-select-all"
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelectedIds(checked === true ? dogAlerts.map(({ id }) => id) : [])
                  }
                />
                <label htmlFor="dog-select-all" className="mr-auto">
                  Chiens : {selected.length} sur {dogAlerts.length}
                </label>
                {DOG_ACTIONS.map(([policy, label]) => (
                  <Button
                    key={policy}
                    variant="outline"
                    size="sm"
                    disabled={selected.length === 0}
                    onClick={() => applyDogPolicy(policy)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
            <ul className="grid max-h-64 gap-2 overflow-y-auto text-sm">
              {shown.map((alert) => {
                const { icon: Icon, className } = LEVELS[alert.level];
                const { hikeId, stopId } = alert;
                return (
                  <li key={alert.id} className="grid gap-1">
                    <div className="flex items-start gap-2">
                      {isDogAlert(alert) && (
                        <Checkbox
                          className="mt-0.5"
                          aria-label={`Sélectionner ${alert.message}`}
                          checked={selectedIds.includes(alert.id)}
                          onCheckedChange={(checked) => toggle(alert.id, checked === true)}
                        />
                      )}
                      <button
                        type="button"
                        className="flex items-start gap-2 text-left hover:underline"
                        onClick={() => onFocus(alert)}
                      >
                        <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
                        {alert.message}
                      </button>
                    </div>
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
