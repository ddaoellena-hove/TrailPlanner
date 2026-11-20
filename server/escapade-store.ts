import { randomUUID } from 'node:crypto';
import { assembleEscapadeTimeline } from '../shared/escapade';
import { EscapadeSchema, type Escapade, type NewEscapade } from '../shared/schema';
import type { UserDb } from './db';

export class EscapadeNotFoundError extends Error {}

/** Persistance des escapades assemblées dans la table SQLite `escapades`. */
export class EscapadeStore {
  constructor(private readonly userDb: UserDb) {}

  async list(): Promise<Escapade[]> {
    await this.userDb.ensureReady();
    const rows = await this.userDb.db
      .selectFrom('escapades')
      .select('data')
      .orderBy('updated_at', 'desc')
      .execute();
    const items: Escapade[] = [];
    for (const row of rows) {
      try {
        items.push(EscapadeSchema.parse(JSON.parse(row.data)));
      } catch (error) {
        console.warn('Escapade ignorée (JSON illisible) :', error);
      }
    }
    return items;
  }

  async get(id: string): Promise<Escapade> {
    await this.userDb.ensureReady();
    const row = await this.userDb.db
      .selectFrom('escapades')
      .select('data')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new EscapadeNotFoundError(id);
    return EscapadeSchema.parse(JSON.parse(row.data));
  }

  async create(input: NewEscapade): Promise<Escapade> {
    await this.userDb.ensureReady();
    const now = new Date().toISOString();
    const assembled = assembleEscapadeTimeline({
      origin: input.origin,
      startTime: input.startTime,
      suggestion: input.suggestion,
      bonusStop: input.bonusStop,
      bonusDurationMin: input.bonusDurationMin,
    });
    const escapade = EscapadeSchema.parse({
      ...input,
      id: randomUUID(),
      ...assembled,
      createdAt: now,
      updatedAt: now,
    });
    await this.userDb.db
      .insertInto('escapades')
      .values({
        id: escapade.id,
        title: escapade.title,
        trail_id: escapade.suggestion.trailId,
        data: JSON.stringify(escapade),
        created_at: escapade.createdAt,
        updated_at: escapade.updatedAt,
      })
      .execute();
    return escapade;
  }

  async update(id: string, input: NewEscapade): Promise<Escapade> {
    const existing = await this.get(id);
    const now = new Date().toISOString();
    const assembled = assembleEscapadeTimeline({
      origin: input.origin,
      startTime: input.startTime,
      suggestion: input.suggestion,
      bonusStop: input.bonusStop,
      bonusDurationMin: input.bonusDurationMin,
    });
    const escapade = EscapadeSchema.parse({
      ...input,
      id: existing.id,
      ...assembled,
      createdAt: existing.createdAt,
      updatedAt: now,
    });
    await this.userDb.db
      .updateTable('escapades')
      .set({
        title: escapade.title,
        trail_id: escapade.suggestion.trailId,
        data: JSON.stringify(escapade),
        updated_at: escapade.updatedAt,
      })
      .where('id', '=', id)
      .execute();
    return escapade;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.userDb.db.deleteFrom('escapades').where('id', '=', id).execute();
  }
}
