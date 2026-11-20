import { describe, expect, it } from 'vitest';
import {
  activityBundleExportFileName,
  activityExportFileName,
  buildActivityExport,
  buildActivityExportBundle,
} from './lifeos-export';
import {
  ActivityExportBundleSchema,
  ActivityExportSchema,
  LIFE_OS_EXPORT_VERSION,
  type Activity,
  type LibraryHike,
} from './schema';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const EXPORTED_AT = '2026-11-20T21:00:00.000Z';

function sampleActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: "Randonnée de l'après-midi à Sur les Traces de Voltaire",
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
    profile: [
      { distKm: 0, altM: 120, lat: 49.47, lng: 1.29 },
      { distKm: 6.8, altM: 121, lat: 49.47, lng: 1.29 },
    ],
    originalFileName: 'sur-les-traces-de-voltaire.gpx',
    originalFile: 'gpx/11111111-1111-4111-8111-111111111111.gpx',
    fingerprint: HASH_A,
    linkedRouteId: null,
    importedAt: '2026-11-14T16:00:00.000Z',
    ...overrides,
  };
}

function sampleRoute(overrides: Partial<LibraryHike> = {}): LibraryHike {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Sur les Traces de Voltaire',
    alltrailsUrl: 'https://www.alltrails.com/trail/france/seine-maritime/voltaire',
    gpxFile: 'gpx/22222222-2222-4222-8222-222222222222.gpx',
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
    dogPolicy: 'leash',
    tags: ['normandie', 'forêt'],
    rating: 4,
    gpxHash: HASH_B,
    outings: [],
    createdAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildActivityExport', () => {
  it('produit un contrat JSON v1 conforme pour Obsidian sans rando liée', () => {
    const activity = sampleActivity({ notes: 'Terrain gras après la pluie' });
    const exported = buildActivityExport(activity, null, { exportedAt: EXPORTED_AT });

    expect(ActivityExportSchema.parse(exported)).toEqual(exported);
    expect(exported).toEqual({
      version: LIFE_OS_EXPORT_VERSION,
      kind: 'activity',
      target: 'obsidian',
      exportedAt: EXPORTED_AT,
      activity: {
        id: activity.id,
        title: activity.title,
        source: 'alltrails',
        sourceId: null,
        activityDate: '2026-11-14T12:37:00Z',
        endedAt: '2026-11-14T14:02:24Z',
        localDate: '2026-11-14',
        localStartTime: '13:37',
        localEndTime: '15:02',
        timeZone: 'Europe/Paris',
        metrics: {
          distanceMeters: 6800,
          durationSeconds: 5124,
          elevationGainMeters: 87,
          elevationLossMeters: 86,
          pointCount: 1697,
          segmentCount: 1,
          origin: { distance: 'calculated', duration: 'calculated', elevation: 'calculated' },
        },
        start: { lat: 49.47, lng: 1.29 },
        end: { lat: 49.47, lng: 1.29 },
        provenance: {
          originalFileName: 'sur-les-traces-de-voltaire.gpx',
          originalFile: 'gpx/11111111-1111-4111-8111-111111111111.gpx',
          fingerprint: HASH_A,
          importedAt: '2026-11-14T16:00:00.000Z',
        },
        notes: 'Terrain gras après la pluie',
      },
      plannedRoute: null,
    });
  });

  it('bascule la date locale en Europe/Paris quand une heure UTC passe minuit', () => {
    const activity = sampleActivity({
      activityDate: '2026-07-15T22:30:00Z',
      endedAt: '2026-07-15T23:45:00Z',
    });
    const exported = buildActivityExport(activity, null, { exportedAt: EXPORTED_AT });

    expect(exported.activity.activityDate).toBe('2026-07-15T22:30:00Z');
    expect(exported.activity.localDate).toBe('2026-07-16');
    expect(exported.activity.localStartTime).toBe('00:30');
    expect(exported.activity.localEndTime).toBe('01:45');
  });

  it('conserve null pour toutes les valeurs inconnues sans jamais les inventer', () => {
    const activity = sampleActivity({
      source: 'gpx',
      activityDate: null,
      endedAt: null,
      durationSeconds: null,
      elevationGainMeters: null,
      elevationLossMeters: null,
      metricsOrigin: { distance: 'calculated', duration: null, elevation: null },
      notes: '   ',
    });
    const exported = buildActivityExport(activity, null, { exportedAt: EXPORTED_AT });

    expect(ActivityExportSchema.parse(exported)).toEqual(exported);
    expect(exported.activity.activityDate).toBeNull();
    expect(exported.activity.endedAt).toBeNull();
    expect(exported.activity.localDate).toBeNull();
    expect(exported.activity.localStartTime).toBeNull();
    expect(exported.activity.localEndTime).toBeNull();
    expect(exported.activity.metrics.durationSeconds).toBeNull();
    expect(exported.activity.metrics.elevationGainMeters).toBeNull();
    expect(exported.activity.metrics.elevationLossMeters).toBeNull();
    expect(exported.activity.metrics.origin).toEqual({
      distance: 'calculated',
      duration: null,
      elevation: null,
    });
    expect(exported.activity.notes).toBeNull();
  });

  it('inclut la rando prévue séparément quand son identifiant correspond au lien manuel', () => {
    const route = sampleRoute();
    const activity = sampleActivity({ linkedRouteId: route.id });
    const exported = buildActivityExport(activity, route, { exportedAt: EXPORTED_AT });

    expect(ActivityExportSchema.parse(exported)).toEqual(exported);
    expect(exported.plannedRoute).toEqual({
      id: route.id,
      name: 'Sur les Traces de Voltaire',
      kind: 'loop',
      alltrailsUrl: 'https://www.alltrails.com/trail/france/seine-maritime/voltaire',
      dogPolicy: 'leash',
      tags: ['normandie', 'forêt'],
      rating: 4,
      gpxHash: HASH_B,
      plannedMetrics: {
        distanceMeters: 6810,
        elevationGainMeters: 85,
        elevationLossMeters: 85,
        estimatedDurationSeconds: 6720,
      },
    });
    // Les mesures de la sortie enregistrée ne sont jamais remplacées par celles de la rando prévue.
    expect(exported.activity.metrics.distanceMeters).toBe(6800);
    expect(exported.activity.metrics.durationSeconds).toBe(5124);
  });

  it('ignore une rando prévue dont l’identifiant ne correspond pas au lien', () => {
    const route = sampleRoute();
    const unlinked = buildActivityExport(sampleActivity({ linkedRouteId: null }), route, {
      exportedAt: EXPORTED_AT,
    });
    const mismatched = buildActivityExport(
      sampleActivity({ linkedRouteId: '33333333-3333-4333-8333-333333333333' }),
      route,
      { exportedAt: EXPORTED_AT },
    );
    expect(unlinked.plannedRoute).toBeNull();
    expect(mismatched.plannedRoute).toBeNull();
  });

  it('ne partage aucune référence mutable avec les objets en entrée', () => {
    const route = sampleRoute();
    const activity = sampleActivity({ linkedRouteId: route.id });
    const exported = buildActivityExport(activity, route, { exportedAt: EXPORTED_AT });

    exported.plannedRoute!.tags.push('hiver');
    exported.activity.metrics.origin.distance = 'source';
    expect(route.tags).toEqual(['normandie', 'forêt']);
    expect(activity.metricsOrigin.distance).toBe('calculated');
  });
});

describe('buildActivityExportBundle', () => {
  it('trie de la plus récente à la plus ancienne et tolère un lien vers une rando supprimée', () => {
    const route = sampleRoute();
    const older = sampleActivity({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Sortie ancienne',
      activityDate: '2026-11-10T08:00:00Z',
      linkedRouteId: route.id,
    });
    const newer = sampleActivity({
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Sortie récente',
      activityDate: '2026-11-15T09:00:00Z',
      linkedRouteId: '55555555-5555-4555-8555-555555555555', // rando absente de la bibliothèque
    });
    const undated = sampleActivity({
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Sortie sans date',
      activityDate: null,
      endedAt: null,
      durationSeconds: null,
    });

    const bundle = buildActivityExportBundle([older, undated, newer], [route], {
      exportedAt: EXPORTED_AT,
    });

    expect(ActivityExportBundleSchema.parse(bundle)).toEqual(bundle);
    expect(bundle.version).toBe(1);
    expect(bundle.kind).toBe('activity-export-bundle');
    expect(bundle.target).toBe('obsidian');
    expect(bundle.count).toBe(3);
    expect(bundle.items.map(({ activity }) => activity.title)).toEqual([
      'Sortie récente',
      'Sortie ancienne',
      'Sortie sans date',
    ]);
    expect(bundle.items[0]!.plannedRoute).toBeNull();
    expect(bundle.items[1]!.plannedRoute?.id).toBe(route.id);
    expect(bundle.items[2]!.plannedRoute).toBeNull();
  });

  it('produit un lot vide valide quand aucune sortie n’est enregistrée', () => {
    const bundle = buildActivityExportBundle([], [], { exportedAt: EXPORTED_AT });
    expect(ActivityExportBundleSchema.parse(bundle)).toEqual(bundle);
    expect(bundle.count).toBe(0);
    expect(bundle.items).toEqual([]);
  });
});

describe('noms de fichiers d’export', () => {
  it('produit des noms lisibles et sans accents', () => {
    expect(activityExportFileName(sampleActivity())).toBe(
      '2026-11-14-randonnee-de-l-apres-midi-a-sur-les-traces-de-voltaire.lifeos.json',
    );
    expect(
      activityExportFileName(sampleActivity({ title: 'Vallée du Crevon', activityDate: null })),
    ).toBe('sortie-vallee-du-crevon.lifeos.json');
    expect(activityExportFileName(sampleActivity({ title: '🏔️', activityDate: null }))).toBe(
      'sortie-11111111.lifeos.json',
    );
    expect(activityBundleExportFileName(EXPORTED_AT)).toBe('itinera-sorties-2026-11-20.lifeos.json');
  });
});
