import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import { ActivityStore, DuplicateActivityError } from './activity-store';
import { GpxError } from './gpx';

const sortie = Buffer.from(recordedGpx([northboundPoints(40)]));
// Même sortie, autre enregistrement : départ 2 min plus tard, points décalés de ~20 m.
const sameOuting = Buffer.from(
  recordedGpx([northboundPoints(40, { start: '2026-07-01T06:02:00Z', lng: 6.00025 })]),
);
const otherDay = Buffer.from(
  recordedGpx([northboundPoints(40, { start: '2026-07-08T06:00:00Z' })]),
);

class FailingIndexStore extends ActivityStore {
  protected override async writeIndex(): Promise<void> {
    throw new Error('disque plein');
  }
}

describe('ActivityStore', () => {
  let dir: string;
  let store: ActivityStore;
  const root = () => path.join(dir, '.activities');

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'itinera-activities-'));
    store = new ActivityStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('importe une activité, garde le GPX intact et la relit depuis le disque', async () => {
    const activity = await store.add(sortie, 'col.gpx');
    expect(activity).toMatchObject({
      title: 'Sortie au col',
      source: 'alltrails',
      sourceId: null,
      linkedRouteId: null,
      durationSeconds: 39 * 60,
      originalFileName: 'col.gpx',
      metricsOrigin: { distance: 'calculated', duration: 'calculated', elevation: 'calculated' },
    });
    expect(await readFile(path.join(root(), activity.originalFile))).toEqual(sortie);
    expect(await new ActivityStore(dir).list()).toEqual([activity]);
    expect(await readdir(root())).toEqual(['activities.json', 'gpx']);
  });

  it('prévisualise sans rien écrire', async () => {
    const preview = await store.preview(sortie, 'col.gpx');
    expect(preview.duplicate).toEqual({ status: 'none' });
    expect(preview.draft.distanceMeters).toBeGreaterThan(4000);
    await expect(readdir(root())).rejects.toThrow();
  });

  it('bloque un doublon exact, sans écrire', async () => {
    const first = await store.add(sortie, 'col.gpx');
    expect((await store.preview(sortie, 'copie.gpx')).duplicate).toEqual({
      status: 'exact',
      activityId: first.id,
    });
    const error = await store.add(sortie, 'copie.gpx').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DuplicateActivityError);
    expect(await store.list()).toHaveLength(1);
    expect(await readdir(path.join(root(), 'gpx'))).toHaveLength(1);
  });

  it('demande une confirmation pour un doublon probable', async () => {
    const first = await store.add(sortie, 'col.gpx');
    await expect(store.add(sameOuting, 'montre.gpx')).rejects.toMatchObject({
      duplicate: { status: 'probable', activityId: first.id },
    });
    const confirmed = await store.add(sameOuting, 'montre.gpx', {
      confirmProbableDuplicate: true,
      title: '  Col, montre  ',
    });
    expect(confirmed.title).toBe('Col, montre');
    // L'activité existante n'est pas modifiée.
    expect((await store.list())[0]).toEqual(first);
    expect(await store.list()).toHaveLength(2);
  });

  it('importe librement la même rando refaite un autre jour', async () => {
    await store.add(sortie, 'col.gpx');
    await store.add(otherDay, 'col-2.gpx');
    expect(await store.list()).toHaveLength(2);
  });

  it('ne laisse ni activité ni fichier quand l’index ne peut pas être écrit', async () => {
    const existing = await store.add(sortie, 'col.gpx');
    const failing = new FailingIndexStore(dir);
    await expect(failing.add(otherDay, 'autre.gpx')).rejects.toThrow('disque plein');
    expect(await store.list()).toEqual([existing]);
    expect(await readdir(path.join(root(), 'gpx'))).toEqual([`${existing.id}.gpx`]);
  });

  it('refuse un GPX invalide sans toucher aux données', async () => {
    const existing = await store.add(sortie, 'col.gpx');
    await expect(store.add(Buffer.from('<gpx>'), 'cassé.gpx')).rejects.toThrow(GpxError);
    expect(await store.list()).toEqual([existing]);
  });

  it('sérialise les imports simultanés', async () => {
    const results = await Promise.allSettled([
      store.add(sortie, 'a.gpx'),
      store.add(sortie, 'b.gpx'),
    ]);
    expect(results.map(({ status }) => status).toSorted()).toEqual(['fulfilled', 'rejected']);
    expect(await store.list()).toHaveLength(1);
  });

  it('lie et délie une rando prévue sans toucher au reste de la sortie', async () => {
    const activity = await store.add(sortie, 'col.gpx');
    const routeId = crypto.randomUUID();
    const linked = await store.setLink(activity.id, routeId);
    expect(linked).toEqual({ ...activity, linkedRouteId: routeId });
    expect(await new ActivityStore(dir).get(activity.id)).toEqual(linked);
    expect(await store.setLink(activity.id, null)).toEqual(activity);
    expect(await readFile(path.join(root(), activity.originalFile))).toEqual(sortie);
    await expect(store.setLink(crypto.randomUUID(), null)).rejects.toThrow();
  });
});
