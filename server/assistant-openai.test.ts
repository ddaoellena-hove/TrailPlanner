import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Hike, type Trip } from '../shared/schema';
import { addHikeStop, generateDays } from '../shared/trip';
import { type AssistantEvent, runAssistantTurn } from './assistant';
import { OpenAIConversation, openaiProvider } from './assistant-openai';

const hike = {
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
} satisfies Hike;

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

type Chunk = { choices: unknown[]; usage?: unknown };

const delta = (fields: unknown, finish_reason: string | null = null): Chunk => ({
  choices: [{ delta: fields, finish_reason }],
});

const usageChunk: Chunk = {
  choices: [],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 40 },
  },
};

/** Client simulé : chaque appel rejoue une liste de morceaux. */
function fakeClient(replies: Chunk[][]) {
  const requests: { messages: unknown[]; model: string; tools: unknown[] }[] = [];
  const create = vi.fn(async (params: (typeof requests)[number]) => {
    requests.push(structuredClone(params));
    const chunks = replies.shift() ?? [];
    return (async function* () {
      yield* chunks;
    })();
  });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, requests };
}

async function collect(client: OpenAI) {
  const events: AssistantEvent[] = [];
  const conversation = new OpenAIConversation(client, 'modele-test');
  for await (const event of runAssistantTurn({
    provider: openaiProvider(client, 'modele-test'),
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

const args = JSON.stringify({
  summary: 'Déplacer.',
  ops: [{ op: 'move_stop', stopId, dayIndex: 2, position: 0 }],
});

function toolChunks(name: string, text: string, id = 'call-1'): Chunk[] {
  const middle = Math.floor(text.length / 2);
  return [
    delta({ tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: text.slice(0, middle) } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: text.slice(middle) } }] }),
    delta({}, 'tool_calls'),
    usageChunk,
  ];
}

describe('fournisseur OpenAI', () => {
  it('diffuse le texte et compte les tokens, sans inventer de coût', async () => {
    const { client, requests } = fakeClient([
      [delta({ content: 'Bon' }), delta({ content: 'jour' }), delta({}, 'stop'), usageChunk],
    ]);
    const { events, history } = await collect(client);

    expect(events.slice(0, 2)).toEqual([
      { type: 'text', text: 'Bon' },
      { type: 'text', text: 'jour' },
    ]);
    expect(events.at(-1)).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, costUsd: null },
    });
    expect(history.at(-1)).toMatchObject({ role: 'assistant', content: 'Bonjour' });
    expect(requests[0]!.model).toBe('modele-test');
    expect(requests[0]!.messages[0]).toMatchObject({ role: 'system' });
  });

  it('reconstitue un appel d’outil arrivé en morceaux et propose', async () => {
    const { client } = fakeClient([toolChunks('propose_changes', args)]);
    const { events, history } = await collect(client);

    expect(events.find((event) => event.type === 'proposal')).toMatchObject({
      proposal: { descriptions: ['Déplacer Col au J2'] },
    });
    expect(history.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call-1', function: { name: 'propose_changes', arguments: args } }],
    });
    expect(history.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
  });

  it('renvoie une erreur au modèle pour un JSON illisible', async () => {
    const { client, requests } = fakeClient([
      toolChunks('propose_changes', '{"cassé'),
      [delta({ content: 'Pardon.' }), delta({}, 'stop')],
    ]);
    const { events } = await collect(client);
    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('INVALID_INPUT');
  });

  it('n’exécute rien sur une réponse tronquée ou refusée', async () => {
    const cut = fakeClient([
      [
        delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'propose_changes', arguments: args } }] }),
        delta({}, 'length'),
      ],
    ]);
    const truncated = await collect(cut.client);
    expect(truncated.events.some((event) => event.type === 'proposal')).toBe(false);
    expect(truncated.events.some((event) => event.type === 'error')).toBe(true);
    expect(cut.requests).toHaveLength(1);

    for (const chunks of [[delta({}, 'content_filter')], [delta({ refusal: 'non' }), delta({}, 'stop')]]) {
      const { client } = fakeClient([chunks]);
      const { events } = await collect(client);
      expect(events).toContainEqual({ type: 'error', message: 'L’assistant a refusé cette demande.' });
    }
  });

  it('ne propose que les deux outils sans écriture', async () => {
    const { client, requests } = fakeClient([[delta({}, 'stop')]]);
    await collect(client);
    const names = (requests[0]!.tools as { function: { name: string } }[]).map(
      ({ function: { name } }) => name,
    );
    expect(names).toEqual(['simulate_changes', 'propose_changes']);
  });
});
