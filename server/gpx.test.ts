import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/schema';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';
import { GpxError, parseGpx, parseRecordedGpx } from './gpx';

const doctype = `<?xml version="1.0"?>
<!DOCTYPE gpx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>
<gpx version="1.1"><trk><name>&b;</name><trkseg>
<trkpt lat="45" lon="6"/><trkpt lat="45.001" lon="6"/></trkseg></trk></gpx>`;

describe('parseRecordedGpx', () => {
  it('garde segments, altitudes, heures et nom des métadonnées', () => {
    const xml = recordedGpx([northboundPoints(3), northboundPoints(2, { lat: 46 })]);
    const parsed = parseRecordedGpx(xml);
    expect(parsed.name).toBe('Sortie au col');
    expect(parsed.creator).toBe('AllTrails.com');
    expect(parsed.segments.map((points) => points.length)).toEqual([3, 2]);
    expect(parsed.segments[0]![1]).toEqual({
      lat: 45.001,
      lng: 6,
      altM: 1010,
      time: '2026-07-01T06:01:00Z',
    });
  });

  it('rend inconnue une heure illisible sans rejeter le point', () => {
    const xml = recordedGpx([[{ lat: 45, lng: 6, time: 'hier' }, { lat: 45.001, lng: 6 }]]);
    expect(parseRecordedGpx(xml).segments[0]![0]!.time).toBeNull();
  });

  it.each([
    ['un XML invalide', '<gpx><trk>', "Ce fichier n'est pas un GPX lisible"],
    ['un fichier vide', '', "Ce fichier n'est pas un GPX lisible"],
    ['un autre XML', '<kml><Document/></kml>', "Ce fichier n'est pas un GPX lisible"],
    ['une DTD', doctype, 'Ce GPX contient une déclaration DOCTYPE, refusée par sécurité'],
    [
      'un itinéraire sans trace',
      '<gpx version="1.1"><rte><rtept lat="45" lon="6"/><rtept lat="45.1" lon="6"/></rte></gpx>',
      'Ce GPX ne contient aucune trace enregistrée',
    ],
    [
      'un seul point',
      recordedGpx([[{ lat: 45, lng: 6 }]]),
      'Ce GPX ne contient aucune trace enregistrée',
    ],
    [
      'une latitude hors bornes',
      recordedGpx([[{ lat: 95, lng: 6 }, { lat: 45, lng: 6 }]]),
      'Ce GPX contient des coordonnées invalides',
    ],
    [
      'une longitude absente',
      '<gpx version="1.1"><trk><trkseg><trkpt lat="45"/><trkpt lat="45" lon="6"/></trkseg></trk></gpx>',
      'Ce GPX contient des coordonnées invalides',
    ],
  ])('refuse %s', (_, xml, message) => {
    expect(() => parseRecordedGpx(xml)).toThrow(new GpxError(message));
  });
});

describe('parseGpx (randos)', () => {
  it('refuse aussi une DTD et des coordonnées invalides', () => {
    expect(() => parseGpx(doctype, DEFAULT_SETTINGS.pace)).toThrow(GpxError);
    const invalid = recordedGpx([[{ lat: 45, lng: 200 }, { lat: 45, lng: 6 }]]);
    expect(() => parseGpx(invalid, DEFAULT_SETTINGS.pace)).toThrow(
      'Ce GPX contient des coordonnées invalides',
    );
  });
});
