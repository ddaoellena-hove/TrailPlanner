import { describe, expect, it } from 'vitest';
import {
  formatActivityDate,
  formatMeters,
  formatSeconds,
  formatShortDate,
  formatTimeOfDay,
} from './format';

describe('formats des sorties enregistrées', () => {
  it('affiche une heure UTC du GPX à l’heure de Paris', () => {
    expect(formatTimeOfDay('2026-11-14T12:37:58Z')).toBe('13:37');
    // Heure d'été : UTC+2.
    expect(formatTimeOfDay('2026-07-01T06:00:00Z')).toBe('08:00');
  });

  it('prend la date locale, pas la date UTC', () => {
    expect(formatActivityDate('2026-07-01T23:30:00Z')).toBe('jeudi 2 juillet 2026');
    expect(formatShortDate('2026-11-14T12:37:58Z')).toBe('14 nov. 2026');
  });

  it('respecte le fuseau écrit dans le fichier', () => {
    expect(formatTimeOfDay('2026-11-14T13:37:00+01:00')).toBe('13:37');
  });

  it('formate distance et durée en français', () => {
    expect(formatMeters(6801)).toBe('6,8 km');
    expect(formatSeconds(5124)).toBe('1 h 25');
    expect(formatSeconds(45 * 60)).toBe('45 min');
  });
});
