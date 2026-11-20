import { randomUUID } from 'node:crypto';
import {
  SuggestionFeedbackSchema,
  type NewSuggestionFeedback,
  type SuggestionFeedback,
} from '../shared/schema';
import { UserDb } from './db';

/** Avis utilisateur sur les suggestions de découverte (`suggestion_feedback` dans SQLite). */
export class FeedbackStore {
  private readonly userDb: UserDb;

  constructor(dirOrDb: string | UserDb) {
    this.userDb = typeof dirOrDb === 'string' ? new UserDb(dirOrDb) : dirOrDb;
  }

  async list(): Promise<SuggestionFeedback[]> {
    await this.userDb.ensureReady();
    const rows = await this.userDb.db
      .selectFrom('suggestion_feedback')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map((row) =>
      SuggestionFeedbackSchema.parse({
        id: row.id,
        trailId: row.trail_id,
        origin: { lat: row.origin_lat, lng: row.origin_lng },
        verdict: row.verdict,
        ...(row.reason !== null ? { reason: row.reason } : {}),
        createdAt: row.created_at,
      }),
    );
  }

  async add(input: NewSuggestionFeedback): Promise<SuggestionFeedback> {
    await this.userDb.ensureReady();
    const feedback = SuggestionFeedbackSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await this.userDb.db
      .insertInto('suggestion_feedback')
      .values({
        id: feedback.id,
        trail_id: feedback.trailId,
        origin_lat: feedback.origin.lat,
        origin_lng: feedback.origin.lng,
        verdict: feedback.verdict,
        reason: feedback.reason ?? null,
        created_at: feedback.createdAt,
      })
      .execute();
    return feedback;
  }
}
