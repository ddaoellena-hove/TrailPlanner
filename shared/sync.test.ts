import { describe, expect, it } from 'vitest';
import type { SyncReport } from './schema';
import { isAbsoluteFolder, summarizeSyncReport } from './sync';

const report = (changes: Partial<SyncReport> = {}): SyncReport => ({
  startedAt: '2026-11-15T21:44:00.000Z',
  finishedAt: '2026-11-15T21:44:01.000Z',
  folder: '/exports',
  imported: [],
  duplicates: [],
  pending: [],
  failed: [],
  alreadyHandled: 0,
  ...changes,
});

describe('summarizeSyncReport', () => {
  it('résume chaque catégorie, au singulier ou au pluriel', () => {
    expect(
      summarizeSyncReport(
        report({
          imported: ['a.gpx', 'b.gpx'],
          duplicates: ['c.gpx'],
          pending: ['d.gpx'],
          failed: [{ fileName: 'e.gpx', error: 'illisible' }],
        }),
      ),
    ).toBe('2 sorties importées, 1 doublon, 1 en attente, 1 échec');
    expect(summarizeSyncReport(report({ imported: ['a.gpx'] }))).toBe('1 sortie importée');
  });

  it('distingue un dossier vide d’un dossier déjà traité', () => {
    expect(summarizeSyncReport(report())).toBe('Aucun fichier GPX dans le dossier');
    expect(summarizeSyncReport(report({ alreadyHandled: 3 }))).toBe('Aucun nouveau fichier');
  });
});

describe('isAbsoluteFolder', () => {
  it('accepte un chemin absolu macOS, Linux ou Windows', () => {
    expect(isAbsoluteFolder('/Users/david/Downloads/AllTrails')).toBe(true);
    expect(isAbsoluteFolder('C:\\Users\\david\\AllTrails')).toBe(true);
    expect(isAbsoluteFolder('Downloads/AllTrails')).toBe(false);
    expect(isAbsoluteFolder('~/Downloads')).toBe(false);
  });
});
