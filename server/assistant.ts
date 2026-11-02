import { z } from 'zod';
import { type AssistantOp, AssistantOpSchema, applyOps } from '../shared/assistant-ops';
import { planImpact, type Proposal } from '../shared/plan-impact';
import type { DriveLeg, Settings, Trip } from '../shared/schema';
import type {
  AssistantConversation,
  AssistantProvider,
  ToolCall,
  TurnUsage,
} from './assistant-provider';

const MAX_ITERATIONS = 8;
const MAX_CONVERSATIONS = 20;

const SimulateInput = z.object({ ops: z.array(AssistantOpSchema) });
const ProposeInput = z.object({
  summary: z.string().min(1),
  ops: z.array(AssistantOpSchema).min(1),
});

export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: TurnUsage };

function addUsage(total: TurnUsage, usage: TurnUsage): TurnUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
    costUsd:
      total.costUsd === null || usage.costUsd === null ? null : total.costUsd + usage.costUsd,
  };
}

/** Conversations en mémoire, une par fournisseur : changer de modèle repart de zéro. */
export class ConversationStore {
  private readonly conversations = new Map<string, AssistantConversation>();

  get(id: string, provider: AssistantProvider): AssistantConversation {
    const key = `${provider.id}:${id}`;
    const existing = this.conversations.get(key);
    if (existing) return existing;
    if (this.conversations.size >= MAX_CONVERSATIONS) {
      const oldest = this.conversations.keys().next().value;
      if (oldest) this.conversations.delete(oldest);
    }
    const conversation = provider.start();
    this.conversations.set(key, conversation);
    return conversation;
  }
}

type TurnInput = {
  provider: AssistantProvider;
  conversation: AssistantConversation;
  trip: Trip;
  context: string;
  message: string;
  routeCache: Record<string, DriveLeg>;
  settings: Settings;
};

function evaluate(input: TurnInput, ops: AssistantOp[]) {
  const applied = applyOps(input.trip, ops);
  if (!applied.ok) return applied;
  const impact = planImpact(input.trip, applied.trip, input.routeCache, input.settings);
  return { ...applied, impact };
}

function runTool(
  input: TurnInput,
  call: ToolCall,
): { result: string; isError: boolean; proposal?: Proposal } {
  if (call.name === 'simulate_changes') {
    const parsed = SimulateInput.safeParse(call.input);
    if (!parsed.success) return { result: 'INVALID_INPUT', isError: true };
    const outcome = evaluate(input, parsed.data.ops);
    if (!outcome.ok) return { result: outcome.error, isError: true };
    return { result: JSON.stringify(outcome.impact), isError: false };
  }
  if (call.name === 'propose_changes') {
    const parsed = ProposeInput.safeParse(call.input);
    if (!parsed.success) return { result: 'INVALID_INPUT', isError: true };
    const outcome = evaluate(input, parsed.data.ops);
    if (!outcome.ok) return { result: outcome.error, isError: true };
    return {
      result: 'Proposition présentée à David.',
      isError: false,
      proposal: {
        summary: parsed.data.summary,
        ops: parsed.data.ops,
        descriptions: outcome.descriptions,
        impact: outcome.impact,
        basedOn: input.trip.updatedAt,
      },
    };
  }
  return { result: `Outil inconnu : ${call.name}`, isError: true };
}

/** Un tour de conversation : l'assistant simule, puis propose. Aucun outil n'écrit. */
export async function* runAssistantTurn(input: TurnInput): AsyncGenerator<AssistantEvent> {
  const { provider, conversation, context, message } = input;
  let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  conversation.addUserMessage(`<voyage>${context}</voyage>\n\n${message}`);

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const replies = conversation.complete();
      let step = await replies.next();
      while (!step.done) {
        yield { type: 'text', text: step.value };
        step = await replies.next();
      }
      const reply = step.value;
      usage = addUsage(usage, reply.usage);

      if (reply.stop === 'refused') {
        yield { type: 'error', message: 'L’assistant a refusé cette demande.' };
        break;
      }
      if (reply.stop === 'truncated') {
        yield { type: 'error', message: 'Réponse trop longue, précisez la demande.' };
        break;
      }
      if (reply.toolCalls.length === 0) break;

      yield { type: 'status', text: 'Vérification du planning…' };
      const results = reply.toolCalls.map((call) => ({ call, ...runTool(input, call) }));
      conversation.addToolResults(
        results.map(({ call, result, isError }) => ({ id: call.id, content: result, isError })),
      );
      const proposal = results.find((result) => result.proposal)?.proposal;
      if (proposal) {
        yield { type: 'proposal', proposal };
        break;
      }
      if (iteration === MAX_ITERATIONS - 1) {
        yield { type: 'error', message: 'Pas de solution trouvée, reformulez la demande.' };
      }
    }
  } catch (error) {
    console.warn('Assistant indisponible :', error);
    yield { type: 'error', message: provider.describeError(error) };
  }
  yield { type: 'done', usage };
}
