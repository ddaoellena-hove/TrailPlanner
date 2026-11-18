# AllTrails integration — Phase 1 audit

> 2026-11-14. Deliverable of Phase 1 of *TrailPlanner — AllTrails Integration Specs v1.0*.
> No code was changed. Baseline: 285 unit tests green, typecheck green.
> D1–D8 approved on 2026-11-14. Phase 2 (pipeline, no UI) implemented on `feat/activities-pipeline`.

## 1. Actual stack (verified)

| Spec assumption | Reality in the repo |
|---|---|
| "Existing storage" | JSON files on disk, no database. `trips/<slug>/trip.json` + `gpx/`, and a cross-trip library in `trips/.library/` (`library.json` + `gpx/`). Atomic writes via `writeAtomic` (`server/trip-store.ts`), serialized writes via a promise queue (`server/library-store.ts`). |
| "Mapping engine" | MapLibre GL through `react-map-gl/maplibre`, IGN/OSM base layers (`src/components/TripMap.tsx`, `LibraryMap.tsx`, `src/lib/map-layers.ts`). |
| "Data models" | zod schemas in `shared/schema.ts`, single source of types. |
| GPX parsing | `@tmcw/togeojson` + `@xmldom/xmldom` in `server/gpx.ts`; pure stats in `shared/gpx.ts`. |
| Backend | Hono on 127.0.0.1, sole layer touching disk. Global `onError` maps `GpxError` → 400. |
| UI | React 19, shadcn/ui, Tailwind, Lucide, TanStack Query, French UI. Pages: `/` (trips), `/voyages/:slug`, `/randos` (library). |
| Tests | Vitest (15 files), 1 Playwright journey (`e2e/trips.spec.ts`). |

Everything the pipeline needs is already present: **no new dependency is required.**

## 2. What already exists and overlaps the spec

### Planned routes = `LibraryHike` (`/randos`, "Mes randos")
Every GPX imported into a trip is also stored in the library, deduplicated by **SHA-256 of the file** (`gpxHash`). These are AllTrails *planned* routes: the GPX files on disk have no `<time>` elements.

### Completed activities already exist, in a minimal form: `Outing`
```ts
Outing = { id, date, durationMin?, tripSlug?, notes? }   // nested in LibraryHike.outings
```
Entered by hand in the hike sheet ("J'ai fait cette rando", `OutingsSection.tsx`). They drive the "done / never done" filter and the real-pace comparison (`shared/library.ts → paceComparison`, SPEC Q34). **An Outing has no GPS track, no source, no file, and cannot exist without a planned route.**

### Reusable pieces
| Need (integration spec) | Reuse |
|---|---|
| Distance | `cumulativeKm` (turf haversine) — `shared/gpx.ts` |
| Elevation gain with documented noise filter | `smoothAltitudes` (50 m moving average) + `elevationChange` (5 m hysteresis), already unit-tested — satisfies spec §5 "documented noise-filtering method" |
| Profile ≤ 500 pts | `computeHikeStats().profile` |
| Exact-duplicate fingerprint | `hashOf` (SHA-256) in `library-store.ts` |
| Atomic persistence, write queue | `writeAtomic`, `LibraryStore.exclusive` |
| Full track on demand | pattern of `GET /api/trips/:slug/gpx/:hikeId` (re-parses the original GPX, geometry not stored in JSON) |
| Map, profile chart, sheet, list | `LibraryMap`, `ProfileChart`, `LibraryHikeSheet`, `StatBadge`, `ImportDialog` |
| FR formatting | `shared/format.ts` |

## 3. Gaps and incompatibilities

1. **No "recorded activity" entity.** Required by the spec (provenance, track, original file, fingerprint, optional route link) — this is a schema addition and needs approval.
2. **Timestamps are discarded.** `parseGpx` keeps only `[lng, lat, ele]`; togeojson's `coordinateProperties.times` is ignored. Duration and activity date cannot be derived today.
3. **Segments are concatenated.** `parseGpx` flattens all `trk`/`trkseg` into one line, so a recording paused and resumed would count the straight-line gap as distance. Recorded tracks need segment-aware distance.
4. **No upload size limit** on any multipart route, and no explicit rejection of `<!DOCTYPE>`/`<!ENTITY>` before xmldom parses. Spec §8.6 requires both.
5. **No coordinate validation** (out-of-range lat/lon, NaN) — invalid points currently flow into turf.
6. **Recorded-track noise.** GPS jitter while standing still inflates distance; the 5 m hysteresis was calibrated on planned routes (whose elevations come from a DEM), not on barometric/GPS recordings. Values must be labeled "calculated".
7. **No sample of a recorded AllTrails export** in the repo (`fixtures/` is empty, SPEC Q2 still open). The metadata AllTrails puts in an activity GPX (name, time, type, any ID) cannot be verified — this blocks fixture-based tests of real files.
8. **Life OS target mismatch.** The integration spec (§9, §13) talks about Obsidian files and YAML; `SPEC.md` §8 and the existing code treat the Life OS as **Notion** (Projects database, Travel & Outdoors area). Not blocking for V1; must be settled before Phase 5.
9. **Branching.** CLAUDE.md requires one milestone = one branch + one PR. The current branch `rattrapage-m0-m5` has uncommitted changes (header, map, legend, logo…). Implementation should start on a new branch from a clean base.

## 4. Decisions needing approval

Recommendations are in **bold**; each is reversible until code lands.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Where recorded activities live | (a) add an optional track to `Outing`; (b) new `Activity` entity in its own store | **(b) `trips/.activities/activities.json` + `trips/.activities/gpx/<id>.gpx`**, same file-based mechanism as `.library/` (no new database). Keeps planned vs recorded separate (acceptance criterion) and existing `Outing` data untouched. |
| D2 | `linkedRouteId` target | library hike id, or trip hike id | **Library hike id** — trip hikes are copies; the library is the cross-trip catalog. |
| D3 | Relation with `Outing` | ignore / show both / migrate | **Show both, migrate nothing.** A linked activity counts as "done" in library filters and its elapsed duration feeds `paceComparison`. No existing outing is modified. |
| D4 | Proposed `Activity` schema | — | see below |
| D5 | Max file size | — | **10 MB** (a 6 h recording at 1 pt/s ≈ 3 MB). |
| D6 | Probable-duplicate rule | — | **Start times within 10 min AND distance within 5 % AND ≥ 80 % of sampled points within 50 m of the other track.** Never merge, only warn. |
| D7 | Where the UI goes | new page / tab in `/randos` | **New page `/activites` ("Mes sorties") in the header**, reusing `LibraryMap` and the sheet pattern; route sheets show linked activities. |
| D8 | Jitter filtering for distance | none / drop sub-threshold moves | **None in V1**: raw segment-aware haversine, labeled "calculée"; revisit once a real recording is available. |

### D4 — proposed `Activity` (additive, `shared/schema.ts`)
```ts
Activity = {
  id: uuid,
  title: string,
  source: 'alltrails',                 // enum, extensible
  sourceId: string | null,             // AllTrails GPX normally carries none
  activityDate: string | null,         // first <time>, original string preserved (ISO, with offset/Z)
  startedAt: string | null,            // ISO datetime, null without timestamps
  distanceMeters: number,              // calculated
  durationSeconds: number | null,      // ELAPSED (last − first timestamp), never "moving"
  elevationGainMeters: number | null,  // calculated, same smoothing as routes
  elevationLossMeters: number | null,
  metricsOrigin: { distance: 'calculated', duration: 'calculated' | null, elevation: 'calculated' | null },
  start: LatLng, end: LatLng,
  profile: HikeStats['profile'],        // ≤ 500 pts; full geometry = original GPX, parsed on demand
  originalFile: 'gpx/<id>.gpx',         // byte-for-byte copy, never modified
  originalFileName: string,
  fingerprint: string,                 // SHA-256 of the file
  linkedRouteId: uuid | null,          // LibraryHike.id
  importedAt: string,                  // ISO datetime
  notes?: string,
}
ActivityStore = { schemaVersion: 1, activities: Activity[] }
```
Units: metres, seconds, ISO 8601 — as the integration spec; existing route stats stay in km/min (no change to `HikeStats`).

## 5. Incremental plan (one branch + PR per phase, per CLAUDE.md)

**Phase 2 — GPX pipeline** (`feat/activities-pipeline`) — no UI
- `shared/activity-gpx.ts` (pure): validate points, segment-aware distance, elapsed duration, elevation via existing smoothing, start date, probable-duplicate scoring. Extend `server/gpx.ts` to return per-segment points with times (existing `parseGpx` output unchanged for routes).
- Hardening shared with route import: 10 MB limit (Hono `bodyLimit`, built in), reject DOCTYPE/ENTITY, reject invalid coordinates.
- `server/activity-store.ts`: write GPX to temp, then JSON, roll back the GPX if the JSON write fails; serialized queue.
- API: `POST /api/activities/preview` (parse only, returns metrics + profile + duplicate status), `POST /api/activities` (re-uploaded file + `confirmProbableDuplicate`), `GET /api/activities`, `GET /api/activities/:id/track`.
- Tests: synthetic recorded GPX fixtures (timestamps, 2 segments, no elevation, invalid XML, DOCTYPE, out-of-range coords, empty track, oversized), exact/probable duplicate, failed write leaves nothing.

**Phase 3 — History and map** (`feat/activities-ui`)
- `/activites` page: list (title, date, distance, D+, source badge "AllTrails"), import dialog with the six states of spec §7, preview map + metrics with "calculé" / "inconnu" labels, detail sheet with map and profile.
- E2E: import → preview → confirm → visible in history.

**Phase 4 — Links and deduplication UX** (`feat/activities-links`)
- Manual link/unlink to a library route; detail map shows planned (dashed) vs recorded (solid); route sheet lists its activities; "done" filter and pace comparison include linked activities (D3).
- Probable-duplicate dialog with explicit choice.

**Phase 5 — Life OS export contract** — only after §3.8 is settled: versioned JSON (`version: 1`), pure builder + tests, no write to Notion/Obsidian.

## 6. Needed from you
1. Approve or amend D1–D8.
2. One or two **recorded** AllTrails GPX exports (not the route export), with what AllTrails displays for them (distance, duration, D+), to build real fixtures.
3. Life OS target for Phase 5: Notion (as in `SPEC.md`) or Obsidian (as in the integration spec)?
4. Branch base: commit or stash the current changes on `rattrapage-m0-m5` first, and start Phase 2 from `main` or from this branch?

Open questions are also recorded in `SPEC.md` §12 (Q35–Q38).

## 7. Phase 2 — delivered (2026-11-14)

Implemented as approved, with these precisions (all documented in README → "Activités enregistrées"):
- **`source` gains a `gpx` value**, used when the GPX `creator` attribute does not say AllTrails: provenance is read, never assumed.
- **`activityDate`** is the first point's `<time>` string as written (offset and precision kept); `endedAt` the last. `<metadata><time>` is ignored (it can be the export date).
- **Duration is null** unless every point has a readable time and times never go backwards.
- **Probable duplicate** follows D6; when one side has no time, geometry and distance decide alone. Duration is not compared (not part of D6).
- The 10 MB limit and the DOCTYPE / coordinate checks also apply to route import in trips.
- Tests use synthetic recordings (`shared/recorded-gpx.fixture.ts`) until a real AllTrails recording is provided.

### First real recording (2026-11-14)
"Sur les Traces de Voltaire", AllTrails export, 1,697 points, one segment, times and elevations on every point, no ID.

| | TrailPlanner | AllTrails |
|---|---|---|
| Distance | 6.80 km | 6.81 km |
| Total time | 1 h 25 min 24 s | 1 h 25 |
| Elevation gain, 5 m threshold | 66 m | 85 m |
| Elevation gain, 2 m threshold | 87 m | 85 m |

Decision (David): recordings use a 2 m hysteresis (`RECORDED_HYSTERESIS_M`), routes keep 5 m. Validated on one gentle lowland hike only; to confirm on hillier recordings. Times are UTC: the UI must display them in local time (Phase 3).

### Life OS target (2026-11-15)
Decided by David: Notion is no longer used to document trails; Phase 5 targets the **Obsidian** Life OS. Still needed: the vault path and one existing (Garmin) activity note with its YAML front matter. The trip notebook export to Notion (SPEC §8) is unchanged pending SPEC Q39.

### Second real recording (2026-11-15)
"Vallée du Crevon" (Ry – Épinay – Saint-Denis-le-Thiboult), AllTrails export, 1,963 points, one segment. TrailPlanner 7.64 km / +162 m / 1 h 36 against AllTrails 7.65 km / 169 m / 1 h 36 (D+ −4 %). Elevation gain by threshold: 5 m → 157 m, 3 m → 166 m, 2 m → 162 m. Across both recordings, 2 m is the only threshold within ±5 % of AllTrails; kept. Added to `fixtures/recordings/` at David's request.

## 8. Phase 4 — delivered (2026-11-17, branch `feat/activities-route-links`)

As approved in D2/D3:
- **Manual link** from a recorded activity to a library route (`PUT /api/activities/:id/link`, `linkedRouteId`), and unlink. Only `linkedRouteId` changes; metrics, track and original file stay untouched. An unknown route is refused.
- **Suggestions, never automatic links** (spec §3.3): routes whose trace overlaps the activity's by ≥ 70 % in both directions (`suggestRoutes`, same geometry test as duplicate detection), shown with a "Lier" button.
- **Planned vs recorded kept distinct**: detail sheet shows a Planned / Recorded table (planned duration is the DIN estimate, recorded is elapsed) and the map draws the planned route dashed (green) under the recorded track (solid, brown).
- **D3**: a linked activity counts as "done" in "Mes randos" (filter and "Faite N fois") and its elapsed duration feeds the pace comparison. Manual outings unchanged, nothing migrated.
- The route sheet lists its linked recordings, each opening `/sorties?sortie=<id>`.
- Fix found while checking: a map created in an opening panel was framed for the wrong size; it now re-frames on load and resize until the user moves it.
- Note: a planned route and its recording can show different D+ for the same ground, because routes use the 5 m threshold (DEM elevations) and recordings 2 m (GPS elevations).
