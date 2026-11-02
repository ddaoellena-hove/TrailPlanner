import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ProposalCard } from '@/components/ProposalCard';
import { DEFAULT_ASSISTANT_BUDGET_USD } from '@/components/SettingsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { api, type AssistantEvent, type Proposal } from '@/lib/api';
import { useSettings } from '@/lib/hooks';
import { ASSISTANT_LABELS } from '@/lib/labels';
import type { AssistantOp } from '../../shared/assistant-ops';
import type { Trip } from '../../shared/schema';

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'proposal'; proposal: Proposal };

export function AssistantPanel({
  trip,
  onApply,
}: {
  trip: Trip;
  onApply: (ops: AssistantOp[]) => string | null;
}) {
  const health = useQuery({ queryKey: ['health'], queryFn: api.getHealth });
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [costUsd, setCostUsd] = useState<number | null>(0);

  const available = health.data?.assistant === 'configured';
  const budget = settings.assistantBudgetUsd ?? DEFAULT_ASSISTANT_BUDGET_USD;
  const providers = health.data?.assistantProviders ?? [];
  const provider = providers.find((id) => id === settings.assistantProvider) ?? providers[0];
  const label = provider && ASSISTANT_LABELS[provider];

  const onEvent = (event: AssistantEvent) => {
    if (event.type === 'status') setStatus(event.text);
    if (event.type === 'error') {
      setEntries((current) => [...current, { kind: 'error', text: event.message }]);
    }
    if (event.type === 'proposal') {
      setEntries((current) => [...current, { kind: 'proposal', proposal: event.proposal }]);
    }
    if (event.type === 'done') {
      const { costUsd: turnCost } = event.usage;
      setCostUsd((current) =>
        current === null || turnCost === null ? null : current + turnCost,
      );
    }
    if (event.type === 'text') {
      setStatus(null);
      setEntries((current) => {
        const last = current.at(-1);
        return last?.kind === 'assistant'
          ? [...current.slice(0, -1), { ...last, text: last.text + event.text }]
          : [...current, { kind: 'assistant', text: event.text }];
      });
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setMessage('');
    setBusy(true);
    setEntries((current) => [...current, { kind: 'user', text }]);
    try {
      await api.assistant(trip.slug, { conversationId, message: text }, onEvent);
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'Assistant indisponible';
      setEntries((current) => [...current, { kind: 'error', text: failure }]);
    }
    setStatus(null);
    setBusy(false);
  };

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
          <CardHeader className="flex-1">
            <CardTitle className="text-base">Assistant</CardTitle>
          </CardHeader>
          <ChevronDown
            className="mr-6 size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="grid gap-3">
            {health.data && !available && (
              <p className="text-sm text-muted-foreground">
                Assistant désactivé : renseignez ANTHROPIC_API_KEY, ou OPENAI_API_KEY et
                OPENAI_MODEL, dans .env, puis relancez le serveur. Son usage est payant.
              </p>
            )}
            {available && (
              <>
                <p className="text-xs text-muted-foreground">
                  Modèle : {label?.name}. Le contenu du voyage est envoyé à {label?.company} à
                  chaque message. L'assistant propose, vous décidez : rien ne change sans votre
                  clic.
                </p>
                {entries.length > 0 && (
                  <div className="grid max-h-96 gap-2 overflow-y-auto text-sm">
                    {entries.map((entry, index) => {
                      if (entry.kind === 'proposal') {
                        return (
                          <ProposalCard
                            key={index}
                            proposal={entry.proposal}
                            stale={entry.proposal.basedOn !== trip.updatedAt}
                            onApply={onApply}
                          />
                        );
                      }
                      if (entry.kind === 'error') {
                        return (
                          <p key={index} role="alert" className="text-destructive">
                            {entry.text}
                          </p>
                        );
                      }
                      return (
                        <p
                          key={index}
                          className={
                            entry.kind === 'user'
                              ? 'justify-self-end rounded-md bg-accent px-3 py-1.5 whitespace-pre-wrap'
                              : 'whitespace-pre-wrap'
                          }
                        >
                          {entry.text}
                        </p>
                      );
                    })}
                  </div>
                )}
                {busy && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {status ?? 'Réflexion…'}
                  </p>
                )}
                <form onSubmit={(event) => void send(event)} className="grid gap-2">
                  <Textarea
                    aria-label="Votre demande"
                    placeholder="J2 est trop chargé, rééquilibre le voyage"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {costUsd === null && 'Coût non calculé pour ce modèle'}
                      {costUsd !== null &&
                        costUsd > 0 &&
                        `Coût de la conversation : ${costUsd.toFixed(3)} $`}
                      {costUsd !== null &&
                        costUsd >= budget &&
                        ` · au-delà de votre seuil de ${budget} $`}
                    </span>
                    <Button type="submit" size="sm" disabled={busy || !message.trim()}>
                      <Send aria-hidden />
                      Envoyer
                    </Button>
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
