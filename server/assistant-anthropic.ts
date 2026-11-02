import Anthropic from '@anthropic-ai/sdk';
import {
  type AssistantConversation,
  type AssistantProvider,
  type ModelReply,
  SYSTEM_PROMPT,
  TOOLS,
  type ToolResult,
  type TurnUsage,
} from './assistant-provider';

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16_000;
/** $ par million de tokens pour MODEL : entrée, sortie, écriture et lecture du cache. */
const PRICES = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

const ANTHROPIC_TOOLS = TOOLS.map(({ name, description, parameters }) => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: parameters,
}));

function toUsage(usage: Anthropic.Beta.BetaUsage): TurnUsage {
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const cost =
    usage.input_tokens * PRICES.input +
    usage.output_tokens * PRICES.output +
    write * PRICES.cacheWrite +
    read * PRICES.cacheRead;
  return {
    inputTokens: usage.input_tokens + write + read,
    outputTokens: usage.output_tokens,
    cacheReadTokens: read,
    costUsd: cost / 1_000_000,
  };
}

/** Historique en ajout seul : le contenu renvoyé par l'API n'est jamais retouché. */
export class AnthropicConversation implements AssistantConversation {
  readonly history: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(private readonly client: Anthropic) {}

  addUserMessage(text: string): void {
    this.history.push({ role: 'user', content: text });
  }

  /** Tous les résultats partent dans un seul message, comme l'exige l'API. */
  addToolResults(results: ToolResult[]): void {
    this.history.push({
      role: 'user',
      content: results.map(({ id, content, isError }) => ({
        type: 'tool_result',
        tool_use_id: id,
        content,
        is_error: isError,
      })),
    });
  }

  async *complete(): AsyncGenerator<string, ModelReply> {
    const stream = this.client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      tools: ANTHROPIC_TOOLS,
      messages: this.history,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    const response = await stream.finalMessage();
    this.history.push({ role: 'assistant', content: response.content });

    const usage = toUsage(response.usage);
    if (response.stop_reason === 'refusal') return { stop: 'refused', toolCalls: [], usage };
    if (response.stop_reason === 'max_tokens') return { stop: 'truncated', toolCalls: [], usage };
    const toolCalls = response.content.flatMap((block) =>
      block.type === 'tool_use'
        ? [{ id: block.id, name: block.name, input: block.input }]
        : [],
    );
    return { stop: toolCalls.length > 0 ? 'tools' : 'end', toolCalls, usage };
  }
}

export function anthropicProvider(client: Anthropic): AssistantProvider {
  return {
    id: 'anthropic',
    start: () => new AnthropicConversation(client),
    describeError(error) {
      if (error instanceof Anthropic.AuthenticationError) return 'Clé ANTHROPIC_API_KEY refusée.';
      if (error instanceof Anthropic.RateLimitError) {
        return 'Trop de demandes pour le moment, réessayez dans un instant.';
      }
      if (error instanceof Anthropic.APIError) return `Service indisponible (${error.status}).`;
      return 'Assistant indisponible.';
    },
  };
}
