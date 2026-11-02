import OpenAI from 'openai';
import {
  type AssistantConversation,
  type AssistantProvider,
  type ModelReply,
  SYSTEM_PROMPT,
  TOOLS,
  type ToolCall,
  type ToolResult,
} from './assistant-provider';

const MAX_TOKENS = 16_000;

const OPENAI_TOOLS = TOOLS.map(({ name, description, parameters }) => ({
  type: 'function' as const,
  function: { name, description, parameters },
}));

/** Une entrée illisible part en erreur vers le modèle : la validation zod la rejettera. */
function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class OpenAIConversation implements AssistantConversation {
  readonly history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  addUserMessage(text: string): void {
    this.history.push({ role: 'user', content: text });
  }

  addToolResults(results: ToolResult[]): void {
    for (const { id, content, isError } of results) {
      this.history.push({
        role: 'tool',
        tool_call_id: id,
        content: isError ? `ERREUR : ${content}` : content,
      });
    }
  }

  async *complete(): AsyncGenerator<string, ModelReply> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: MAX_TOKENS,
      messages: this.history,
      tools: OPENAI_TOOLS,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = '';
    let finishReason: string | null = null;
    let refused = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    // Un appel d'outil arrive en morceaux, repérés par leur index.
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
        cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      finishReason = choice.finish_reason ?? finishReason;
      if (choice.delta.refusal) refused = true;
      if (choice.delta.content) {
        text += choice.delta.content;
        yield choice.delta.content;
      }
      for (const delta of choice.delta.tool_calls ?? []) {
        const call = calls.get(delta.index) ?? { id: '', name: '', args: '' };
        call.id = delta.id ?? call.id;
        call.name = delta.function?.name ?? call.name;
        call.args += delta.function?.arguments ?? '';
        calls.set(delta.index, call);
      }
    }

    const usage = { inputTokens, outputTokens, cacheReadTokens, costUsd: null };
    if (refused || finishReason === 'content_filter') {
      return { stop: 'refused', toolCalls: [], usage };
    }
    if (finishReason === 'length') return { stop: 'truncated', toolCalls: [], usage };

    const ordered = [...calls.values()];
    this.history.push({
      role: 'assistant',
      content: text || null,
      ...(ordered.length > 0
        ? {
            tool_calls: ordered.map(({ id, name, args }) => ({
              id,
              type: 'function' as const,
              function: { name, arguments: args },
            })),
          }
        : {}),
    });
    const toolCalls: ToolCall[] = ordered.map(({ id, name, args }) => ({
      id,
      name,
      input: parseArguments(args),
    }));
    return { stop: toolCalls.length > 0 ? 'tools' : 'end', toolCalls, usage };
  }
}

export function openaiProvider(client: OpenAI, model: string): AssistantProvider {
  return {
    id: 'openai',
    start: () => new OpenAIConversation(client, model),
    describeError(error) {
      if (error instanceof OpenAI.AuthenticationError) return 'Clé OPENAI_API_KEY refusée.';
      if (error instanceof OpenAI.RateLimitError) {
        return 'Trop de demandes pour le moment, réessayez dans un instant.';
      }
      if (error instanceof OpenAI.NotFoundError) return 'Modèle OPENAI_MODEL introuvable.';
      if (error instanceof OpenAI.APIError) return `Service indisponible (${error.status}).`;
      return 'Assistant indisponible.';
    },
  };
}
