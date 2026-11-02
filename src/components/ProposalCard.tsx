import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatDuration, formatKm } from '../../shared/format';
import type { AssistantOp } from '../../shared/assistant-ops';
import type { Proposal } from '../../shared/plan-impact';

/** Proposition de l'assistant : rien ne change avant « Appliquer ». */
export function ProposalCard({
  proposal,
  stale,
  onApply,
}: {
  proposal: Proposal;
  stale: boolean;
  onApply: (ops: AssistantOp[]) => string | null;
}) {
  const [state, setState] = useState<'open' | 'applied' | 'ignored'>('open');
  const [error, setError] = useState<string | null>(null);
  const { impact } = proposal;

  return (
    <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">{proposal.summary}</p>
      <ul className="list-disc pl-5">
        {proposal.descriptions.map((description) => (
          <li key={description}>{description}</li>
        ))}
      </ul>

      {impact.days.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground tabular-nums">
          {impact.days.map(({ dayIndex, before, after }) => (
            <li key={dayIndex}>
              J{dayIndex} : {formatKm(before.hikingKm)} → {formatKm(after.hikingKm)} ·{' '}
              {formatDuration(before.hikingMin + before.drivingMin)} →{' '}
              {formatDuration(after.hikingMin + after.drivingMin)} actives · fin {before.end} →{' '}
              {after.end}
            </li>
          ))}
        </ul>
      )}
      {impact.alertsResolved.map((alert) => (
        <p key={alert} className="text-xs text-primary">
          Résolue : {alert}
        </p>
      ))}
      {impact.alertsAdded.map((alert) => (
        <p key={alert} className="text-xs text-destructive">
          Nouvelle alerte : {alert}
        </p>
      ))}

      {state === 'open' ? (
        <>
          {stale && (
            <p className="text-xs text-muted-foreground">
              Le voyage a changé depuis cette proposition : son effet peut différer.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const failure = onApply(proposal.ops);
                setError(failure);
                if (!failure) setState('applied');
              }}
            >
              Appliquer
            </Button>
            <Button size="sm" variant="outline" onClick={() => setState('ignored')}>
              Ignorer
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {state === 'applied' ? 'Appliquée, annulable avec Ctrl/Cmd+Z.' : 'Ignorée.'}
        </p>
      )}
    </div>
  );
}
