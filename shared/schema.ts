import { z } from 'zod';

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:mm');
const IsoDateSchema = z.iso.date();
const IsoDateTimeSchema = z.iso.datetime();

/** Un slug sert de nom de dossier : ce motif interdit toute sortie de TRIPS_DIR. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug invalide');

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const PlaceTypeSchema = z.enum(['lodging', 'charging', 'food', 'parking', 'poi']);
export type PlaceType = z.infer<typeof PlaceTypeSchema>;

export const PlaceSchema = z.object({
  id: z.uuid(),
  type: PlaceTypeSchema,
  name: z.string().min(1),
  location: LatLngSchema,
  url: z.httpUrl().optional(),
  price: z.number().nonnegative().optional(),
  bookingStatus: z.enum(['idea', 'to-book', 'booked', 'cancelled']).optional(),
  dogPolicy: z.enum(['allowed', 'forbidden', 'unknown']).optional(),
  chargesOvernight: z.boolean().optional(),
  notes: z.string().optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const HikeStatsSchema = z.object({
  distanceKm: z.number().nonnegative(),
  // null quand le GPX n'a pas d'altitude (SPEC §5.1).
  elevationGainM: z.number().nonnegative().nullable(),
  elevationLossM: z.number().nonnegative().nullable(),
  maxAltitudeM: z.number().nullable(),
  minAltitudeM: z.number().nullable(),
  estimatedDurationMin: z.number().nonnegative(),
  profile: z
    .array(
      z.object({
        distKm: z.number().nonnegative(),
        altM: z.number().nullable(),
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .max(500),
});
export type HikeStats = z.infer<typeof HikeStatsSchema>;

export const HikeSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  // httpUrl : ce lien est rendu en href, un schéma javascript: serait exécutable.
  alltrailsUrl: z.httpUrl().optional(),
  gpxFile: z.string().min(1),
  kind: z.enum(['loop', 'out-and-back', 'point-to-point']),
  stats: HikeStatsSchema,
  start: LatLngSchema,
  end: LatLngSchema,
  dogPolicy: z.enum(['allowed', 'leash', 'forbidden', 'unknown']),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type Hike = z.infer<typeof HikeSchema>;

export const OutingSchema = z.object({
  id: z.uuid(),
  date: IsoDateSchema,
  durationMin: z.number().positive().optional(),
  tripSlug: SlugSchema.optional(),
  notes: z.string().optional(),
});
export type Outing = z.infer<typeof OutingSchema>;

export const NewOutingSchema = OutingSchema.omit({ id: true });
export type NewOuting = z.infer<typeof NewOutingSchema>;

/** Rando commune aux voyages. L'empreinte du GPX la relie aux copies dans les voyages. */
export const LibraryHikeSchema = HikeSchema.extend({
  gpxHash: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  outings: z.array(OutingSchema),
  createdAt: IsoDateTimeSchema,
});
export type LibraryHike = z.infer<typeof LibraryHikeSchema>;

export const LibrarySchema = z.object({
  schemaVersion: z.literal(1),
  hikes: z.array(LibraryHikeSchema),
});
export type Library = z.infer<typeof LibrarySchema>;

/** Corps de PUT /api/library/:id : remplace ces champs, un champ absent est vidé. */
export const LibraryHikeFieldsSchema = LibraryHikeSchema.pick({
  name: true,
  alltrailsUrl: true,
  dogPolicy: true,
  notes: true,
  tags: true,
  rating: true,
});
export type LibraryHikeFields = z.infer<typeof LibraryHikeFieldsSchema>;

export const LibraryLinksSchema = z.record(z.string(), z.string());
export type LibraryLinks = z.infer<typeof LibraryLinksSchema>;

/** `calculated` : déduit de la trace par TrailPlanner ; `source` : lu tel quel dans le fichier. */
export const MetricOriginSchema = z.enum(['calculated', 'source']);
export type MetricOrigin = z.infer<typeof MetricOriginSchema>;

/** `gpx` : fichier dont l'attribut `creator` n'indique pas AllTrails, sans autre provenance sûre. */
export const ActivitySourceSchema = z.enum(['alltrails', 'gpx']);
export type ActivitySource = z.infer<typeof ActivitySourceSchema>;

/**
 * Sortie enregistrée (trace GPS horodatée), distincte d'une rando prévue de la bibliothèque.
 * Unités : mètres, secondes. Une valeur inconnue vaut null, jamais une estimation.
 */
export const ActivityDraftSchema = z.object({
  title: z.string().min(1),
  source: ActivitySourceSchema,
  /** Identifiant chez la source ; les GPX AllTrails n'en portent pas. */
  sourceId: z.string().nullable(),
  /** Première heure de la trace, telle qu'écrite dans le fichier (précision et fuseau gardés). */
  activityDate: z.string().nullable(),
  /** Dernière heure de la trace, telle qu'écrite dans le fichier. */
  endedAt: z.string().nullable(),
  distanceMeters: z.number().nonnegative(),
  /** Durée écoulée entre la première et la dernière heure, pauses comprises. */
  durationSeconds: z.number().nonnegative().nullable(),
  elevationGainMeters: z.number().nonnegative().nullable(),
  elevationLossMeters: z.number().nonnegative().nullable(),
  metricsOrigin: z.object({
    distance: MetricOriginSchema,
    duration: MetricOriginSchema.nullable(),
    elevation: MetricOriginSchema.nullable(),
  }),
  pointCount: z.number().int().positive(),
  segmentCount: z.number().int().positive(),
  start: LatLngSchema,
  end: LatLngSchema,
  /** Profil échantillonné pour l'affichage ; la trace complète reste le GPX original. */
  profile: HikeStatsSchema.shape.profile,
  originalFileName: z.string(),
  /** SHA-256 du fichier original. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ActivityDraft = z.infer<typeof ActivityDraftSchema>;

export const ActivitySchema = ActivityDraftSchema.extend({
  id: z.uuid(),
  /** Chemin relatif dans `.activities/`, copie octet pour octet, jamais modifiée. */
  originalFile: z.string().min(1),
  /** Rando prévue de la bibliothèque (`LibraryHike.id`), liée à la main. */
  linkedRouteId: z.uuid().nullable(),
  importedAt: IsoDateTimeSchema,
  notes: z.string().optional(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const ActivityStoreSchema = z.object({
  schemaVersion: z.literal(1),
  activities: z.array(ActivitySchema),
});
export type ActivityStoreFile = z.infer<typeof ActivityStoreSchema>;

export const DuplicateCheckSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('exact'), activityId: z.uuid() }),
  z.object({ status: z.literal('probable'), activityId: z.uuid() }),
]);
export type DuplicateCheck = z.infer<typeof DuplicateCheckSchema>;

export const ActivityPreviewSchema = z.object({
  draft: ActivityDraftSchema,
  duplicate: DuplicateCheckSchema,
});
export type ActivityPreview = z.infer<typeof ActivityPreviewSchema>;

/**
 * Fichier du dossier surveillé déjà traité, repéré par son SHA-256 : `imported` et
 * `duplicate` sont définitifs, `pending` attend un choix, `failed` est retenté.
 */
export const SyncFileSchema = z.object({
  fileName: z.string().min(1),
  status: z.enum(['imported', 'duplicate', 'pending', 'ignored', 'failed']),
  /** Sortie créée (`imported`), ou sortie déjà présente (`duplicate`, `pending`). */
  activityId: z.uuid().optional(),
  error: z.string().optional(),
  at: IsoDateTimeSchema,
});
export type SyncFile = z.infer<typeof SyncFileSchema>;

export const SyncReportSchema = z.object({
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  folder: z.string(),
  imported: z.array(z.string()),
  duplicates: z.array(z.string()),
  pending: z.array(z.string()),
  failed: z.array(z.object({ fileName: z.string(), error: z.string() })),
  /** Fichiers déjà traités lors d'un passage précédent. */
  alreadyHandled: z.number().int().nonnegative(),
});
export type SyncReport = z.infer<typeof SyncReportSchema>;

export const SyncLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  files: z.record(z.string().regex(/^[0-9a-f]{64}$/), SyncFileSchema),
  lastRun: SyncReportSchema.optional(),
});
export type SyncLedger = z.infer<typeof SyncLedgerSchema>;

export const SyncStatusSchema = z.object({
  folder: z.string().nullable(),
  running: z.boolean(),
  lastRun: SyncReportSchema.nullable(),
  pending: z.array(SyncFileSchema.extend({ hash: z.string() })),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const StopSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.uuid(),
    kind: z.literal('hike'),
    hikeId: z.uuid(),
    startTime: TimeSchema.optional(),
    departurePlaceId: z.uuid().optional(),
    stayPlaceId: z.uuid().optional(),
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal('place'),
    placeId: z.uuid(),
    durationMin: z.number().nonnegative().optional(),
    departurePlaceId: z.uuid().optional(),
  }),
]);
export type Stop = z.infer<typeof StopSchema>;

/** Départ et séjour d'une étape, tels que saisis. Sans départ : le séjour précédent. */
export type PlaceInput = Pick<Place, 'name' | 'location' | 'url'>;
export type StopPlaces = { departure: PlaceInput | null; stay: PlaceInput | null };

export const DaySchema = z.object({
  date: IsoDateSchema,
  index: z.number().int().positive(),
  title: z.string().optional(),
  stops: z.array(StopSchema),
  nightPlaceId: z.uuid().optional(),
  backupHikeIds: z.array(z.uuid()),
  notes: z.string().optional(),
});
export type Day = z.infer<typeof DaySchema>;

export const ExpenseSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1),
  amount: z.number().nonnegative(),
  category: z.enum(['lodging', 'energy', 'toll', 'food', 'activity', 'other']),
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const ChecklistItemSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const VehicleSchema = z.object({
  batteryKwh: z.number().positive(),
  startPercent: z.number().min(0).max(100),
  consumptionKwhPer100km: z.number().positive(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

const endsAfterStart = (dates: { startDate: string; endDate: string }) =>
  dates.endDate >= dates.startDate;
const endsAfterStartError = {
  message: 'La date de fin doit être postérieure ou égale à la date de début',
  path: ['endDate'],
};

export const TripSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    slug: SlugSchema,
    name: z.string().min(1),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    origin: PlaceSchema.optional(),
    destination: PlaceSchema.optional(),
    travelers: z.object({ withDog: z.boolean(), electricVehicle: z.boolean().optional() }),
    vehicle: VehicleSchema.optional(),
    hikes: z.array(HikeSchema),
    places: z.array(PlaceSchema),
    days: z.array(DaySchema),
    expenses: z.array(ExpenseSchema).optional(),
    checklist: z.array(ChecklistItemSchema).optional(),
    notion: z
      .object({
        projectPageId: z.string().optional(),
        itineraryPageId: z.string().optional(),
        lastExportAt: IsoDateTimeSchema.optional(),
      })
      .optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .refine(endsAfterStart, endsAfterStartError);
export type Trip = z.infer<typeof TripSchema>;

/** Corps de POST /api/trips. */
export const NewTripSchema = z
  .object({
    name: z.string().trim().min(1, 'Nom du voyage requis'),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    withDog: z.boolean(),
    electricVehicle: z.boolean().optional(),
  })
  .refine(endsAfterStart, endsAfterStartError);
export type NewTrip = z.infer<typeof NewTripSchema>;

export const TripSummarySchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  dayCount: z.number().int().positive(),
  totalKm: z.number().nonnegative(),
  totalElevationGainM: z.number().nonnegative(),
  lastNotionExportAt: IsoDateTimeSchema.nullable(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;

export const DriveLegSchema = z.object({
  from: LatLngSchema,
  to: LatLngSchema,
  distanceKm: z.number().nonnegative(),
  durationMin: z.number().nonnegative(),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.array(z.number())),
  }),
  source: z.enum(['ors', 'ign', 'straight-line-fallback']),
});
export type DriveLeg = z.infer<typeof DriveLegSchema>;

export const ItineraryLegSchema = DriveLegSchema.extend({
  fromName: z.string(),
  toName: z.string(),
  dayIndex: z.number().int().positive(),
  stopId: z.string().nullable(),
  phase: z.enum(['enter', 'stay', 'end']),
  trailToStay: z.boolean(),
});
export type ItineraryLeg = z.infer<typeof ItineraryLegSchema>;

export const ItinerarySchema = z.object({ legs: z.array(ItineraryLegSchema) });
export type Itinerary = z.infer<typeof ItinerarySchema>;

export const GeocodeResultSchema = z.object({ label: z.string(), location: LatLngSchema });
export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

export const MapLinkResultSchema = z.object({
  name: z.string(),
  location: LatLngSchema,
  url: z.string(),
  approximate: z.boolean(),
});
export type MapLinkResult = z.infer<typeof MapLinkResultSchema>;

export const AssistantProviderIdSchema = z.enum(['anthropic', 'openai']);
export type AssistantProviderId = z.infer<typeof AssistantProviderIdSchema>;

export const ChargingStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  operator: z.string(),
  network: z.string().nullable().optional(),
  location: LatLngSchema,
  maxPowerKw: z.number().nonnegative(),
  points: z.number().int().nonnegative(),
  connectors: z.array(z.string()),
  hours: z.string().nullable(),
});
export type ChargingStation = z.infer<typeof ChargingStationSchema>;

/** Borne gardée d'un voyage à l'autre : issue de la base nationale, ou d'un lien Google Maps. */
export const FavoriteStationSchema = ChargingStationSchema.extend({ url: z.string().optional() });
export type FavoriteStation = z.infer<typeof FavoriteStationSchema>;

export const SettingsSchema = z.object({
  pace: z.object({
    flatKmh: z.number().positive(),
    ascentMPerH: z.number().positive(),
    descentMPerH: z.number().positive(),
    breakFactor: z.number().positive(),
  }),
  dayStartTime: TimeSchema,
  thresholds: z.object({
    maxHikingHoursPerDay: z.number().positive().optional(),
    maxElevationGainPerDay: z.number().positive().optional(),
    maxDrivingHoursPerDay: z.number().positive().optional(),
    maxTotalActiveHoursPerDay: z.number().positive().optional(),
    latestEndTime: TimeSchema.optional(),
  }),
  mapBaseLayer: z.enum(['ign-plan', 'ortho', 'osm']),
  mapBaseOpacity: z.number().min(0).max(1).optional(),
  mapOverlays: z.array(z.string()).optional(),
  mapHiddenLayers: z.array(z.string()).optional(),
  /** Coût par conversation au-delà duquel l'assistant prévient, en dollars. */
  assistantBudgetUsd: z.number().positive().optional(),
  assistantProvider: z.enum(['anthropic', 'openai']).optional(),
  favoriteNetworks: z.array(z.string()).optional(),
  favoriteNetworksOnly: z.boolean().optional(),
  favoriteStations: z.array(FavoriteStationSchema).optional(),
  /** Dossier où déposer les exports GPX d'AllTrails, importés par la synchronisation. */
  activityImportFolder: z.string().min(1).optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** `incomplete` : des zones n'ont pas répondu, la liste peut être partielle. */
export const ChargingSearchSchema = z.object({
  stations: z.array(ChargingStationSchema),
  incomplete: z.boolean(),
});
export type ChargingSearch = z.infer<typeof ChargingSearchSchema>;

export const DayWeatherSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('forecast'),
    tempMinC: z.number(),
    tempMaxC: z.number(),
    precipitationMm: z.number(),
    windKmh: z.number(),
    code: z.number(),
  }),
  z.object({ status: z.literal('later'), availableFrom: IsoDateSchema }),
  z.object({ status: z.literal('unavailable') }),
]);
export type DayWeather = z.infer<typeof DayWeatherSchema>;

export const PoiSchema = z.object({
  id: z.string(),
  kind: z.enum(['water', 'hut', 'camping', 'parking']),
  name: z.string(),
  location: LatLngSchema,
});
export type Poi = z.infer<typeof PoiSchema>;

export const NotionExportRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create') }),
  z.object({
    mode: z.literal('link'),
    projectPageId: z.string().min(1),
    updateStartDate: z.boolean(),
  }),
]);
export type NotionExportRequest = z.infer<typeof NotionExportRequestSchema>;

export const NotionProjectSchema = z.object({ id: z.string(), title: z.string() });
export type NotionProject = z.infer<typeof NotionProjectSchema>;

export const NotionPreviewSchema = z.object({ markdown: z.string(), outcome: z.string() });
export type NotionPreview = z.infer<typeof NotionPreviewSchema>;

export const DEFAULT_SETTINGS: Settings = {
  pace: { flatKmh: 4, ascentMPerH: 300, descentMPerH: 500, breakFactor: 1 },
  dayStartTime: '08:30',
  thresholds: {},
  mapBaseLayer: 'ign-plan',
};

export const HealthSchema = z.object({
  ors: z.enum(['configured', 'missing', 'invalid']),
  notion: z.enum(['configured', 'missing', 'invalid']),
  assistant: z.enum(['configured', 'missing']),
  assistantProviders: z.array(AssistantProviderIdSchema),
});
export type Health = z.infer<typeof HealthSchema>;
