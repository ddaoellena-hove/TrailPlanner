import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Hike, type Trip } from '../shared/schema';
import { addHikeStop, generateDays } from '../shared/trip';
import { type AssistantEvent, runAssistantTurn } from './assistant';
import { AnthropicConversation, anthropicProvider } from './assistant-anthropic';

const hike: Hike = {
  id: randomUUID(),
  name: 'Col',
  gpxFile: 'gpx/x.gpx',
  kind: 'loop',
  stats: {
    distanceKm: 8,
    elevationGainM: 400,
    elevationLossM: 400,
    maxAltitudeM: null,
    minAltitudeM: null,
    estimatedDurationMin: 120,
    profile: [],
  },
  start: { lat: 45, lng: 6 },
  end: { lat: 45, lng: 6 },
  dogPolicy: 'allowed',
};

const trip = addHikeStop(
  {
    schemaVersion: 1,
    id: randomUUID(),
    slug: 'test',
    name: 'Test',
    startDate: '2027-07-01',
    endDate: '2027-07-02',
    travelers: { withDog: false },
    hikes: [],
    places: [],
    days: generateDays('2027-07-01', '2027-07-02'),
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
  } satisfies Trip,
  1,
  hike,
);
const stopId = trip.days[0]!.stops[0]!.id;

const usage = {
  input_tokens: 1000,
  output_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 500,
};

type Reply = { content: unknown[]; stop_reason: string; text?: string };

/** Client simulé : rejoue des réponses et garde une copie de chaque requête. */
function fakeClient(replies: (Reply | Error)[]) {
  const requests: { messages: unknown[]; tools: unknown[]; model: string }[] = [];
  const stream = vi.fn((params: { messages: unknown[]; tools: unknown[]; model: string }) => {
    requests.push(structuredClone(params));
    const reply = replies.shift();
    if (!reply) throw new Error('plus de réponse');
    if (reply instanceof Error) throw reply;
    return {
      async *[Symbol.asyncIterator]() {
        if (reply.text) {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: reply.text },
          };
        }
      },
      finalMessage: async () => ({ ...reply, usage }),
    };
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, requests, stream };
}

async function collect(client: Anthropic, conversation = new AnthropicConversation(client)) {
  const events: AssistantEvent[] = [];
  for await (const event of runAssistantTurn({
    provider: anthropicProvider(client),
    conversation,
    trip,
    context: '{}',
    message: 'Rééquilibre',
    routeCache: {},
    settings: DEFAULT_SETTINGS,
  })) {
    events.push(event);
  }
  return { events, history: conversation.history };
}

const toolUse = (name: string, input: unknown, id = 'tool-1') => ({
  type: 'tool_use',
  id,
  name,
  input,
});

const move = { op: 'move_stop', stopId, dayIndex: 2, position: 0 };

describe('runAssistantTurn', () => {
  it('répond à une question sans outil', async () => {
    const { client } = fakeClient([
      { content: [{ type: 'text', text: 'Oui.' }], stop_reason: 'end_turn', text: 'Oui.' },
    ]);
    const { events } = await collect(client);
    expect(events[0]).toEqual({ type: 'text', text: 'Oui.' });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('simule, puis propose, et le voyage reste intact', async () => {
    const before = JSON.stringify(trip);
    const { client, requests } = fakeClient([
      { content: [toolUse('simulate_changes', { ops: [move] })], stop_reason: 'tool_use' },
      {
        content: [toolUse('propose_changes', { summary: 'Déplacer.', ops: [move] }, 'tool-2')],
        stop_reason: 'tool_use',
      },
    ]);

    const { events, history } = await collect(client);

    const proposal = events.find((event) => event.type === 'proposal');
    expect(proposal).toMatchObject({
      proposal: { summary: 'Déplacer.', descriptions: ['Déplacer Col au J2'], basedOn: trip.updatedAt },
    });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(trip)).toBe(before);
    expect(history.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-2', is_error: false }],
    });
  });

  it('renvoie l’erreur au modèle pour une opération invalide, sans proposer', async () => {
    const bad = { op: 'remove_stop', stopId: 'inconnu' };
    const { client, requests } = fakeClient([
      { content: [toolUse('propose_changes', { summary: 'X', ops: [bad] })], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Pardon.' }], stop_reason: 'end_turn' },
    ]);

    const { events } = await collect(client);

    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('is_error":true');
  });

  it('rejette une entrée hors schéma, y compris une opération d’écriture inventée', async () => {
    const { client, requests } = fakeClient([
      {
        content: [toolUse('propose_changes', { summary: 'X', ops: [{ op: 'delete_trip' }] })],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Ok.' }], stop_reason: 'end_turn' },
    ]);
    const { events } = await collect(client);
    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('INVALID_INPUT');
  });

  it('n’exécute aucun outil sur un refus ou une réponse tronquée', async () => {
    for (const stop_reason of ['refusal', 'max_tokens']) {
      const { client, requests } = fakeClient([
        { content: [toolUse('propose_changes', { summary: 'X', ops: [move] })], stop_reason },
      ]);
      const { events } = await collect(client);
      expect(events.some((event) => event.type === 'proposal')).toBe(false);
      expect(events.some((event) => event.type === 'error')).toBe(true);
      expect(requests).toHaveLength(1);
    }
  });

  it('s’arrête après 8 itérations', async () => {
    const replies = Array.from({ length: 12 }, () => ({
      content: [toolUse('simulate_changes', { ops: [move] })],
      stop_reason: 'tool_use',
    }));
    const { client, requests } = fakeClient(replies);
    const { events } = await collect(client);
    expect(requests).toHaveLength(8);
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  it('transforme une panne de l’API en message, et finit proprement', async () => {
    const { client } = fakeClient([new Error('réseau')]);
    const { events } = await collect(client);
    expect(events.map(({ type }) => type)).toEqual(['error', 'done']);
  });

  it('compte le coût, cache compris', async () => {
    const { client } = fakeClient([{ content: [], stop_reason: 'end_turn' }]);
    const { events } = await collect(client);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 1500, outputTokens: 100, cacheReadTokens: 500, costUsd: 0.0061 },
    });
  });

  it('garde l’historique en ajout seul d’un tour à l’autre', async () => {
    const content = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'A' }];
    const { client, requests } = fakeClient([
      { content, stop_reason: 'end_turn' },
      { content: [], stop_reason: 'end_turn' },
    ]);
    const conversation = new AnthropicConversation(client);
    await collect(client, conversation);
    await collect(client, conversation);
    expect(requests[1]!.messages[1]).toEqual({ role: 'assistant', content });
    expect(requests[1]!.messages).toHaveLength(3);
  });

  it('n’offre aucun outil d’écriture', async () => {
    const { client, requests } = fakeClient([{ content: [], stop_reason: 'end_turn' }]);
    await collect(client);
    const names = (requests[0]!.tools as { name: string }[]).map(({ name }) => name);
    expect(names).toEqual(['simulate_changes', 'propose_changes']);
    expect(requests[0]!.model).toBe('claude-opus-5-5');
    expect(JSON.stringify(requests[0]!.tools)).not.toContain('$schema');
  });
});
