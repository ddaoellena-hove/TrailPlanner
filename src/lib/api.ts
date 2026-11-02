import { z } from 'zod';
import {
  type GeocodeResult,
  GeocodeResultSchema,
  type Health,
  HealthSchema,
  type Hike,
  HikeSchema,
  type Itinerary,
  ItinerarySchema,
  type NewTrip,
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
