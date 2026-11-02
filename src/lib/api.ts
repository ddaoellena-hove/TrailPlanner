import { z } from 'zod';
import type { Proposal } from '../../shared/plan-impact';
import { ProposalSchema } from '../../shared/plan-impact';
import {
  type ChargingSearch,
  ChargingSearchSchema,
  type DayWeather,
  DayWeatherSchema,
  type GeocodeResult,
  GeocodeResultSchema,
  type Health,
  HealthSchema,
  type Hike,
  HikeSchema,
  type MapLinkResult,
  MapLinkResultSchema,
  type Itinerary,
  ItinerarySchema,
  type LibraryHike,
  type LibraryHikeFields,
  LibraryHikeSchema,
  type LibraryLinks,
  LibraryLinksSchema,
  type NewOuting,
  type NewTrip,
  type Poi,
  PoiSchema,
  type NotionExportRequest,
  type NotionPreview,
  NotionPreviewSchema,
  type NotionProject,
  NotionProjectSchema,
  type Settings,
  SettingsSchema,
  type Trip,
  TripSchema,
  type TripSummary,
  TripSummarySchema,
} from '../../shared/schema';

const AssistantEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('status'), text: z.string() }),
  z.object({ type: z.literal('proposal'), proposal: ProposalSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('done'),
    usage: z.object({ costUsd: z.number().nullable() }).loose(),
  }),
]);
export type AssistantEvent = z.infer<typeof AssistantEventSchema>;
export type { Proposal };

async function request(route: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api${route}`, init);
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  const parsed = z.object({ error: z.string() }).safeParse(body);
  throw new Error(parsed.success ? parsed.data.error : `Erreur ${response.status}`);
}

export const api = {
  async listTrips(): Promise<TripSummary[]> {
    const response = await request('/trips');
    return z.array(TripSummarySchema).parse(await response.json());
  },

  async getTrip(slug: string): Promise<Trip> {
    return TripSchema.parse(await (await request(`/trips/${slug}`)).json());
  },

  async createTrip(input: NewTrip): Promise<Trip> {
    const response = await request('/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return TripSchema.parse(await response.json());
  },

  async saveTrip(trip: Trip): Promise<Trip> {
    const response = await request(`/trips/${trip.slug}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(trip),
    });
    return TripSchema.parse(await response.json());
  },

  async uploadGpx(
    slug: string,
    file: File,
    fields: { name: string; alltrailsUrl: string } = { name: '', alltrailsUrl: '' },
  ): Promise<Hike> {
    const body = new FormData();
    body.set('file', file);
    body.set('name', fields.name);
    body.set('alltrailsUrl', fields.alltrailsUrl);
    const response = await request(`/trips/${slug}/gpx`, { method: 'POST', body });
    return HikeSchema.parse(await response.json());
  },

  async library(): Promise<LibraryHike[]> {
    return z.array(LibraryHikeSchema).parse(await (await request('/library')).json());
  },

  async updateLibraryHike(id: string, fields: LibraryHikeFields): Promise<LibraryHike> {
    const response = await request(`/library/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    return LibraryHikeSchema.parse(await response.json());
  },

  async deleteLibraryHike(id: string): Promise<void> {
    await request(`/library/${id}`, { method: 'DELETE' });
  },

  async addOuting(id: string, outing: NewOuting): Promise<LibraryHike> {
    const response = await request(`/library/${id}/outings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(outing),
    });
    return LibraryHikeSchema.parse(await response.json());
  },

  async deleteOuting(id: string, outingId: string): Promise<LibraryHike> {
    const response = await request(`/library/${id}/outings/${outingId}`, { method: 'DELETE' });
    return LibraryHikeSchema.parse(await response.json());
  },

  async libraryLinks(slug: string): Promise<LibraryLinks> {
    return LibraryLinksSchema.parse(await (await request(`/trips/${slug}/library-links`)).json());
  },

  async copyLibraryHike(slug: string, id: string): Promise<Hike> {
    const response = await request(`/trips/${slug}/library-hikes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    return HikeSchema.parse(await response.json());
  },

  async getSettings(): Promise<Settings> {
    return SettingsSchema.parse(await (await request('/settings')).json());
  },

  async saveSettings(settings: Settings): Promise<Settings> {
    const response = await request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return SettingsSchema.parse(await response.json());
  },

  async getHealth(): Promise<Health> {
    return HealthSchema.parse(await (await request('/health')).json());
  },

  async notionPreview(slug: string): Promise<NotionPreview> {
    const response = await request(`/trips/${slug}/notion/preview`, { method: 'POST' });
    return NotionPreviewSchema.parse(await response.json());
  },

  async notionExport(slug: string, body: NotionExportRequest): Promise<Trip> {
    const response = await request(`/trips/${slug}/notion/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return TripSchema.parse(await response.json());
  },

  async notionProjects(query: string): Promise<NotionProject[]> {
    const response = await request(`/notion/projects?q=${encodeURIComponent(query)}`);
    return z.array(NotionProjectSchema).parse(await response.json());
  },

  async chargingStations(slug: string, minKw: number): Promise<ChargingSearch> {
    const response = await request(`/trips/${slug}/charging?minKw=${minKw}`);
    return ChargingSearchSchema.parse(await response.json());
  },

  async resolveMapLink(url: string): Promise<MapLinkResult> {
    const response = await request('/map-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return MapLinkResultSchema.parse(await response.json());
  },

  async weather(slug: string): Promise<Record<string, DayWeather>> {
    const response = await request(`/trips/${slug}/weather`);
    return z.record(z.string(), DayWeatherSchema).parse(await response.json());
  },

  async pois(slug: string): Promise<Poi[]> {
    return z.array(PoiSchema).parse(await (await request(`/trips/${slug}/poi`)).json());
  },

  /** Lit la réponse ligne par ligne, au fil de l'eau. */
  async assistant(
    slug: string,
    body: { conversationId: string; message: string },
    onEvent: (event: AssistantEvent) => void,
  ): Promise<void> {
    const response = await request(`/trips/${slug}/assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    while (reader) {
      const { done, value } = await reader.read();
      pending += value ?? '';
      const lines = pending.split('\n');
      pending = done ? '' : (lines.pop() ?? '');
      for (const line of lines.filter(Boolean)) {
        onEvent(AssistantEventSchema.parse(JSON.parse(line)));
      }
      if (done) break;
    }
  },

  async geocode(query: string): Promise<GeocodeResult[]> {
    const response = await request(`/geocode?q=${encodeURIComponent(query)}`);
    return z.array(GeocodeResultSchema).parse(await response.json());
  },

  async computeItinerary(slug: string, refresh = false): Promise<Itinerary> {
    const route = `/trips/${slug}/itinerary${refresh ? '?refresh=1' : ''}`;
    const response = await request(route, { method: 'POST' });
    return ItinerarySchema.parse(await response.json());
  },

  async duplicateTrip(slug: string): Promise<Trip> {
    const response = await request(`/trips/${slug}/duplicate`, { method: 'POST' });
    return TripSchema.parse(await response.json());
  },

  async deleteTrip(slug: string): Promise<void> {
    await request(`/trips/${slug}`, { method: 'DELETE' });
  },
};
