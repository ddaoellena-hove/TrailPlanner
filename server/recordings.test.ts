import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { draftActivity } from './activity-store';

/** Valeurs affichées par AllTrails pour chaque sortie (`fixtures/README.md`). */
const RECORDINGS = [
  {
    file: 'sur-les-traces-de-voltaire.gpx',
    title: "Randonnée de l'après-midi à Sur les Traces de Voltaire",
    activityDate: '2026-11-14T12:37:58Z',
    distanceKm: 6.81,
    elevationGainM: 85,
    totalTimeMin: 85,
  },
];

describe.each(RECORDINGS)('sortie AllTrails réelle : $file', (expected) => {
  const bytes = readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'recordings', expected.file),
  );
  const draft = draftActivity(bytes, expected.file);

  it('garde titre, provenance et heure de départ du fichier', () => {
    expect(draft).toMatchObject({
      title: expected.title,
      source: 'alltrails',
      sourceId: null,
      activityDate: expected.activityDate,
    });
  });

  it('donne la distance à ±2 % de celle d’AllTrails', () => {
    const km = draft.distanceMeters / 1000;
    expect(Math.abs(km - expected.distanceKm) / expected.distanceKm).toBeLessThanOrEqual(0.02);
  });

  it('donne le D+ à ±10 % de celui d’AllTrails', () => {
    const gain = draft.elevationGainMeters!;
    expect(Math.abs(gain - expected.elevationGainM) / expected.elevationGainM).toBeLessThanOrEqual(
      0.1,
    );
  });

  it('donne le temps total à la minute près', () => {
    // AllTrails tronque à la minute : 1 h 25 couvre 85 min 0 s à 85 min 59 s.
    const minutes = draft.durationSeconds! / 60;
    expect(minutes).toBeGreaterThanOrEqual(expected.totalTimeMin - 1);
    expect(minutes).toBeLessThan(expected.totalTimeMin + 1);
  });
});
