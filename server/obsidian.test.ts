import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARNET_LEGACY_TITLES, CARNET_TITLE, buildCarnet, carnetOutcome } from '../shared/carnet';
import { buildActivityExportEntry } from '../shared/lifeos-export';
import { parseFrontMatter } from '../shared/obsidian';
import type { Activity, Trip } from '../shared/schema';
import {
  ObsidianExportError,
  checkObsidianVault,
  exportActivityToObsidian,
  exportTripToObsidian,
  listObsidianProjects,
} from './obsidian';

const trip: Trip = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'parc-des-ecrins',
  name: 'Parc des Écrins',
  startDate: '2026-12-10',
  endDate: '2026-12-12',
  travelers: { withDog: true },
  hikes: [],
  places: [],
  days: [
    { date: '2026-12-10', index: 1, stops: [], backupHikeIds: [] },
    { date: '2026-12-11', index: 2, stops: [], backupHikeIds: [] },
    { date: '2026-12-12', index: 3, stops: [], backupHikeIds: [] },
  ],
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
};

const activity: Activity = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Sur les Traces de Voltaire',
  source: 'alltrails',
  sourceId: null,
  activityDate: '2026-11-14T12:37:00Z',
  endedAt: '2026-11-14T14:02:24Z',
  distanceMeters: 6800,
  durationSeconds: 5124,
  elevationGainMeters: 87,
  elevationLossMeters: 86,
  metricsOrigin: { distance: 'calculated', duration: 'calculated', elevation: 'calculated' },
  pointCount: 1697,
  segmentCount: 1,
  start: { lat: 49.47, lng: 1.29 },
  end: { lat: 49.47, lng: 1.29 },
  profile: [{ distKm: 0, altM: 120, lat: 49.47, lng: 1.29 }],
  originalFileName: 'voltaire.gpx',
  originalFile: 'gpx/22222222-2222-4222-8222-222222222222.gpx',
  fingerprint: 'a'.repeat(64),
  linkedRouteId: null,
  importedAt: '2026-11-14T16:00:00.000Z',
};

describe('export Obsidian', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(path.join(tmpdir(), 'itinera-vault-'));
  });

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('vérifie l’état du vault', async () => {
    expect(await checkObsidianVault(undefined)).toBe('missing');
    expect(await checkObsidianVault('relatif')).toBe('invalid');
    expect(await checkObsidianVault(path.join(vault, 'absent'))).toBe('invalid');
    expect(await checkObsidianVault(vault)).toBe('configured');
  });

  it('liste les projets de Projects/ avec Travel & Outdoors en tête', async () => {
    const projectsDir = path.join(vault, 'Projects');
    await mkdir(path.join(projectsDir, 'Parc des écrins'), { recursive: true });
    await writeFile(
      path.join(projectsDir, 'Zèbre.md'),
      '---\nStatus: Active\nArea: "[[Areas/Travel & Outdoors|Travel & Outdoors]]"\n---\n',
    );
    await writeFile(
      path.join(projectsDir, 'Athlétique.md'),
      '---\nStatus: Active\nArea: "[[Areas/Personal Growth|Personal Growth]]"\n---\n',
    );

    const all = await listObsidianProjects(vault);
    expect(all.map((p) => p.name)).toEqual(['Zèbre', 'Athlétique', 'Parc des écrins']);
    expect(all[0]).toMatchObject({ area: 'Travel & Outdoors', status: 'Active' });

    const filtered = await listObsidianProjects(vault, 'ecrins');
    expect(filtered.map((p) => p.name)).toEqual(['Parc des écrins']);
  });

  it('crée un nouveau projet et son carnet, et refuse d’écraser un projet existant en mode create', async () => {
    const blocks = buildCarnet(trip, [], [], new Date('2026-11-20T12:00:00Z'));
    const outcome = carnetOutcome(trip);

    const exported = await exportTripToObsidian(
      vault,
      trip,
      { mode: 'create' },
      blocks,
      outcome,
      new Date('2026-11-20T12:00:00Z'),
    );
    expect(exported.projectName).toBe('Parc des Écrins');
    expect(exported.carnetPath).toBe(`Projects/Parc des Écrins/${CARNET_TITLE}.md`);

    const projectContent = await readFile(path.join(vault, 'Projects', 'Parc des Écrins.md'), 'utf8');
    expect(parseFrontMatter(projectContent).Area).toBe('[[Areas/Travel & Outdoors|Travel & Outdoors]]');
    const carnetContent = await readFile(path.join(vault, exported.carnetPath), 'utf8');
    expect(carnetContent).toContain(`# ${CARNET_TITLE}`);

    await expect(
      exportTripToObsidian(vault, trip, { mode: 'create' }, blocks, outcome),
    ).rejects.toThrow(ObsidianExportError);
  });

  it('lie à un projet existant sans jamais le modifier et reprend un ancien carnet Trailplan', async () => {
    const projectNote = path.join(vault, 'Projects', 'Road trip Kiwi.md');
    const legacyDir = path.join(vault, 'Projects', 'Road trip Kiwi');
    await mkdir(legacyDir, { recursive: true });
    const manualContent = '---\ntitle: Road trip Kiwi\n---\n\nMes notes personnelles précieuses.\n';
    await writeFile(projectNote, manualContent);
    await writeFile(path.join(legacyDir, `${CARNET_LEGACY_TITLES[0]}.md`), 'ancien carnet');

    const blocks = buildCarnet(trip, [], [], new Date('2026-11-20T12:00:00Z'));
    const linked = await exportTripToObsidian(
      vault,
      trip,
      { mode: 'link', projectName: 'Road trip Kiwi' },
      blocks,
      carnetOutcome(trip),
      new Date('2026-11-20T12:00:00Z'),
    );

    // La note projet manuelle est strictement intacte.
    expect(await readFile(projectNote, 'utf8')).toBe(manualContent);
    // L'ancien carnet Trailplan a été remplacé par celui d'Itinera sans doublon.
    expect(await readdir(legacyDir)).toEqual([`${CARNET_TITLE}.md`]);
    expect(linked.carnetPath).toBe(`Projects/Road trip Kiwi/${CARNET_TITLE}.md`);

    // Un ré-export sur le voyage lié remplace uniquement le carnet.
    await exportTripToObsidian(
      vault,
      { ...trip, obsidian: linked },
      { mode: 'create' },
      blocks,
      carnetOutcome(trip),
    );
    expect(await readFile(projectNote, 'utf8')).toBe(manualContent);
    expect(await readdir(legacyDir)).toEqual([`${CARNET_TITLE}.md`]);
  });

  it('exporte une sortie dans Sport/, lie un projet, préserve Ressenti et n’écrase aucune note Garmin', async () => {
    await mkdir(path.join(vault, 'Projects'), { recursive: true });
    await writeFile(path.join(vault, 'Projects', 'Road trip Kiwi.md'), '---\ntitle: Road trip Kiwi\n---\n');
    await mkdir(path.join(vault, 'Sport'), { recursive: true });

    // Une note tiers (ex. Garmin) occupe déjà le nom préféré : on ne doit jamais l'écraser.
    const preferredName = '2026-11-14 — Randonnée 6,8 km — Sur les Traces de Voltaire.md';
    const garminContent = '---\nSource: Garmin\n---\nNote Garmin intacte\n';
    await writeFile(path.join(vault, 'Sport', preferredName), garminContent);

    const entry = buildActivityExportEntry(activity, null);
    const first = await exportActivityToObsidian(
      vault,
      activity,
      entry,
      'Road trip Kiwi',
      new Date('2026-11-20T12:00:00Z'),
    );

    expect(await readFile(path.join(vault, 'Sport', preferredName), 'utf8')).toBe(garminContent);
    expect(first.notePath).toBe(
      'Sport/2026-11-14 — Randonnée 6,8 km — Sur les Traces de Voltaire (2).md',
    );
    expect(first.projectName).toBe('Road trip Kiwi');

    // L'utilisateur écrit son ressenti dans Obsidian, puis ré-exporte sans projet.
    const noteDiskPath = path.join(vault, first.notePath);
    const created = await readFile(noteDiskPath, 'utf8');
    await writeFile(noteDiskPath, `${created}Jambes lourdes mais belle lumière.\n`);

    const updated = await exportActivityToObsidian(
      vault,
      { ...activity, obsidian: first },
      entry,
      null,
      new Date('2026-11-21T12:00:00Z'),
    );
    expect(updated.notePath).toBe(first.notePath);
    const afterReexport = await readFile(noteDiskPath, 'utf8');
    expect(afterReexport).toContain('Jambes lourdes mais belle lumière.');
    expect(parseFrontMatter(afterReexport).Project).toBeUndefined();
    expect(parseFrontMatter(afterReexport).Created).toBe('2026-11-21');
  });

  it('refuse un projet inconnu lors d’un export de sortie', async () => {
    const entry = buildActivityExportEntry(activity, null);
    await expect(
      exportActivityToObsidian(vault, activity, entry, 'Inexistant'),
    ).rejects.toThrow(ObsidianExportError);
  });
});
