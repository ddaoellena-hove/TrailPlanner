import { describe, expect, it } from 'vitest';
import { CARNET_TITLE, buildCarnet, carnetOutcome } from './carnet';
import { buildActivityExportEntry } from './lifeos-export';
import {
  activitySportFileName,
  extractAreaName,
  mergeActivitySportNote,
  parseFrontMatter,
  renderActivitySportNote,
  renderTripCarnetNote,
  renderTripProjectNote,
  sanitizeObsidianName,
} from './obsidian';
import type { Activity, LibraryHike, Trip } from './schema';

const HASH = 'a'.repeat(64);

const sampleTrip: Trip = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'devoluy-champsaur',
  name: 'Dévoluy & Champsaur',
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

const sampleActivity: Activity = {
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
  fingerprint: HASH,
  linkedRouteId: '33333333-3333-4333-8333-333333333333',
  importedAt: '2026-11-14T16:00:00.000Z',
};

const sampleRoute: LibraryHike = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Boucle de Voltaire',
  alltrailsUrl: 'https://www.alltrails.com/trail/france/voltaire',
  gpxFile: 'gpx/33333333-3333-4333-8333-333333333333.gpx',
  kind: 'loop',
  stats: {
    distanceKm: 6.81,
    elevationGainM: 85,
    elevationLossM: 85,
    maxAltitudeM: 160,
    minAltitudeM: 80,
    estimatedDurationMin: 112,
    profile: [{ distKm: 0, altM: 120, lat: 49.47, lng: 1.29 }],
  },
  start: { lat: 49.47, lng: 1.29 },
  end: { lat: 49.47, lng: 1.29 },
  dogPolicy: 'allowed',
  gpxHash: 'b'.repeat(64),
  outings: [],
  createdAt: '2026-11-10T10:00:00.000Z',
};

describe('helpers Obsidian', () => {
  it('nettoie les noms de fichiers Obsidian dangereux ou invalides', () => {
    expect(sanitizeObsidianName('../Écrins: 2026 / [Hiver]')).toBe('Écrins 2026 Hiver');
    expect(sanitizeObsidianName('...')).toBe('');
  });

  it('lit un front matter YAML simple et extrait le domaine', () => {
    const md = [
      '---',
      'title: "Préparer le road trip"',
      'Status: Active',
      'Area: "[[Areas/Travel & Outdoors|Travel & Outdoors]]"',
      '---',
      '# Contenu',
    ].join('\n');
    const fm = parseFrontMatter(md);
    expect(fm).toEqual({
      title: 'Préparer le road trip',
      Status: 'Active',
      Area: '[[Areas/Travel & Outdoors|Travel & Outdoors]]',
    });
    expect(extractAreaName(fm.Area)).toBe('Travel & Outdoors');
    expect(extractAreaName('[[Areas/Kiwi]]')).toBe('Kiwi');
    expect(extractAreaName(undefined)).toBeNull();
  });
});

describe('rendu projet et carnet Obsidian', () => {
  it('génère une note Projet conforme à Bases/Projects.base et un carnet dédié', () => {
    const outcome = carnetOutcome(sampleTrip);
    const projectMd = renderTripProjectNote(sampleTrip, outcome, 'Dévoluy & Champsaur', '2026-11-20');
    const fm = parseFrontMatter(projectMd);
    expect(fm.title).toBe('Dévoluy & Champsaur');
    expect(fm.Status).toBe('Backlog');
    expect(fm.Area).toBe('[[Areas/Travel & Outdoors|Travel & Outdoors]]');
    expect(fm['Start date']).toBe('2026-12-10');
    expect(projectMd).toContain(`[[Projects/Dévoluy & Champsaur/${CARNET_TITLE}|🗺️ Carnet d’itinéraire]]`);
    expect(projectMd).toContain('![[Bases/Tasks.base#Tâches liées]]');

    const blocks = buildCarnet(sampleTrip, [], [], new Date('2026-11-20T12:00:00Z'));
    const carnetMd = renderTripCarnetNote(sampleTrip, blocks, '2026-11-20');
    expect(parseFrontMatter(carnetMd)).toEqual({
      title: CARNET_TITLE,
      itinera_trip_slug: 'devoluy-champsaur',
      Exported: '2026-11-20',
    });
    expect(carnetMd).toContain(`# ${CARNET_TITLE}`);
    expect(carnetMd).toContain('J1 — jeudi 10 décembre');
  });
});

describe('rendu séance Sport Obsidian', () => {
  it('produit une note conforme à Bases/Sport.base avec projet lié et rando prévue séparée', () => {
    const entry = buildActivityExportEntry(sampleActivity, sampleRoute);
    expect(activitySportFileName(entry)).toBe(
      '2026-11-14 — Randonnée 6,8 km — Sur les Traces de Voltaire.md',
    );

    const md = renderActivitySportNote(entry, {
      createdDate: '2026-11-20',
      projectName: 'Préparer le road trip de décembre avec Kiwi',
    });
    const fm = parseFrontMatter(md);
    expect(fm).toEqual({
      title: '2026-11-14 — Randonnée 6,8 km — Sur les Traces de Voltaire',
      Date: '2026-11-14',
      Heure: '13:37',
      Type: 'Randonnée',
      Durée: '85',
      Distance: '6.8',
      Dénivelé: '87',
      Project: '[[Projects/Préparer le road trip de décembre avec Kiwi|Préparer le road trip de décembre avec Kiwi]]',
      Source: 'AllTrails',
      icon: '🥾',
      Created: '2026-11-20',
      itinera_id: sampleActivity.id,
      itinera_fingerprint: HASH,
    });
    expect(md).toContain('13:37 → 15:02 (Europe/Paris)');
    expect(md).toContain('[Boucle de Voltaire](https://www.alltrails.com/trail/france/voltaire)');
    expect(md).toContain('## Ressenti');
  });

  it('omet les propriétés inconnues sans les inventer', () => {
    const bare = buildActivityExportEntry(
      {
        ...sampleActivity,
        source: 'gpx',
        activityDate: null,
        endedAt: null,
        durationSeconds: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        linkedRouteId: null,
        metricsOrigin: { distance: 'calculated', duration: null, elevation: null },
      },
      null,
    );
    const md = renderActivitySportNote(bare, { createdDate: '2026-11-20' });
    const fm = parseFrontMatter(md);
    expect(fm.Date).toBeUndefined();
    expect(fm.Heure).toBeUndefined();
    expect(fm.Durée).toBeUndefined();
    expect(fm.Dénivelé).toBeUndefined();
    expect(fm.Project).toBeUndefined();
    expect(fm.Source).toBe('GPX');
    expect(md).toContain('**Durée écoulée :** Inconnue');
    expect(md).toContain('**Dénivelé :** Inconnu');
  });

  it('préserve la section Ressenti écrite à la main lors d’un ré-export', () => {
    const entry = buildActivityExportEntry(sampleActivity, null);
    const fresh = renderActivitySportNote(entry, {
      createdDate: '2026-11-20',
      projectName: 'Road trip',
    });
    const edited = `${renderActivitySportNote(entry, { createdDate: '2026-11-15' })}Super sortie avec Kiwi, boueux dans le vallon.\n\n## Photos\n- ![[voltaire.jpg]]\n`;
    const merged = mergeActivitySportNote(edited, fresh);
    expect(parseFrontMatter(merged).Project).toBe('[[Projects/Road trip|Road trip]]');
    expect(merged).toContain('Super sortie avec Kiwi, boueux dans le vallon.');
    expect(merged).toContain('## Photos\n- ![[voltaire.jpg]]');
  });
});
