import { Footprints } from 'lucide-react';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  Layer,
  type MapRef,
  Marker,
  NavigationControl,
  Popup,
  Source,
} from 'react-map-gl/maplibre';
import { PlaceIcon } from '@/components/PlaceIcon';
import { Button } from '@/components/ui/button';
import { dayColor, DRIVE_COLOR, TRAIL_TO_STAY_COLOR } from '@/lib/labels';
import { plannedStops } from '../../shared/itinerary';
import type { Hike, ItineraryLeg, LatLng, Settings, Trip } from '../../shared/schema';
import { unplanned as unplannedOf } from '../../shared/trip';

const IGN_TILES =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

function rasterStyle(tiles: string, attribution: string, maxzoom: number): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

const MAP_STYLES: Record<Settings['mapBaseLayer'], StyleSpecification> = {
  'ign-plan': rasterStyle(IGN_TILES, '© IGN', 19),
  osm: rasterStyle(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    '© contributeurs OpenStreetMap',
    19,
  ),
};

const FRANCE_VIEW = { longitude: 2.5, latitude: 46.6, zoom: 4.6 };
const FIT_OPTIONS = { padding: 56, maxZoom: 13 };

type Bounds = [[number, number], [number, number]];

function trace(hike: Hike): number[][] {
  return hike.stats.profile.map(({ lng, lat }) => [lng, lat]);
}

function hikeLines(hikes: Hike[], colorOf: (hike: Hike) => string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: hikes.map((hike) => ({
      type: 'Feature',
      properties: { hikeId: hike.id, color: colorOf(hike) },
      geometry: { type: 'LineString', coordinates: trace(hike) },
    })),
  };
}

function driveLines(legs: ItineraryLeg[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: legs.map((leg) => ({
      type: 'Feature',
      properties: { color: leg.trailToStay ? TRAIL_TO_STAY_COLOR : DRIVE_COLOR },
      geometry: { type: 'LineString', coordinates: leg.geometry.coordinates },
    })),
  };
}

function boundsOf(positions: number[][]): Bounds | undefined {
  if (positions.length === 0) return undefined;
  const longitudes = positions.map((position) => position[0]!);
  const latitudes = positions.map((position) => position[1]!);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

/** Une nouvelle `request` s'applique même sur la même rando. `fit` recadre sur ses randos. */
export type MapFocus = { hikeIds: string[]; fit: boolean; request: number };

export function TripMap({
  trip,
  legs,
  focus,
  dayFilter,
  baseLayer,
  highlightedHikeId,
  cursor,
  onHikeHover,
  onAddPlaceAt,
}: {
  trip: Trip;
  legs: ItineraryLeg[];
  focus: MapFocus | null;
  dayFilter: number | null;
  baseLayer: Settings['mapBaseLayer'];
  highlightedHikeId: string | null;
  cursor: LatLng | null;
  onHikeHover: (hikeId: string | null, position: LatLng) => void;
  onAddPlaceAt: (location: LatLng) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [menuAt, setMenuAt] = useState<LatLng | null>(null);

  const { planned, backups, loose, stops, colorOf, bounds } = useMemo(() => {
    const days = trip.days.filter((day) => !dayFilter || day.index === dayFilter);
    const dayOf = new globalThis.Map<string, number>();
    for (const day of trip.days) {
      for (const id of day.backupHikeIds) if (!dayOf.has(id)) dayOf.set(id, day.index);
    }
    for (const day of [...trip.days].reverse()) {
      for (const stop of day.stops) if (stop.kind === 'hike') dayOf.set(stop.hikeId, day.index);
    }
    const plannedIds = new Set(
      days.flatMap((day) => day.stops.flatMap((s) => (s.kind === 'hike' ? [s.hikeId] : []))),
    );
    const backupIds = new Set(days.flatMap((day) => day.backupHikeIds));
    const library = unplannedOf(trip);

    const planned = trip.hikes.filter(({ id }) => plannedIds.has(id));
    const backups = trip.hikes.filter(({ id }) => backupIds.has(id) && !plannedIds.has(id));
    const loose = dayFilter ? [] : library.hikes;
    const stops = [
      ...plannedStops(trip).filter((stop) => !dayFilter || stop.dayIndex === dayFilter),
      ...(dayFilter
        ? []
        : library.places.map((place) => ({
            id: place.id,
            kind: place.type,
            name: place.name,
            location: place.location,
            dayIndex: 0,
          }))),
    ];
    const bounds = boundsOf([
      ...legs.flatMap((leg) => leg.geometry.coordinates),
      ...[...planned, ...backups, ...loose].flatMap(trace),
      ...stops.map(({ location }) => [location.lng, location.lat]),
    ]);
    const colorOf = (hike: Hike) => dayColor(dayOf.get(hike.id) ?? 1);
    return { planned, backups, loose, stops, colorOf, bounds };
  }, [trip, legs, dayFilter]);

  // Réordonner garde le même cadrage : la carte ne bouge que si l'emprise change.
  const boundsKey = JSON.stringify(bounds);
  useEffect(() => {
    if (boundsKey) mapRef.current?.fitBounds(JSON.parse(boundsKey) as Bounds, FIT_OPTIONS);
  }, [boundsKey]);

  useEffect(() => {
    if (!focus?.fit) return;
    const hikes = trip.hikes.filter(({ id }) => focus.hikeIds.includes(id));
    const target = boundsOf(hikes.flatMap(trace));
    if (target) mapRef.current?.fitBounds(target, { padding: 72, maxZoom: 15 });
    // Seule une nouvelle demande recadre, pas une modification du voyage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return (
    <Map
      ref={mapRef}
      initialViewState={bounds ? { bounds, fitBoundsOptions: FIT_OPTIONS } : FRANCE_VIEW}
      mapStyle={MAP_STYLES[baseLayer]}
      interactiveLayerIds={['hikes-hit']}
      cursor={highlightedHikeId ? 'crosshair' : 'grab'}
      onMouseMove={(event) => {
        const hikeId: unknown = event.features?.[0]?.properties?.hikeId;
        onHikeHover(typeof hikeId === 'string' ? hikeId : null, event.lngLat);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuAt({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      }}
    >
      <NavigationControl showCompass={false} />
      <Source type="geojson" data={driveLines(legs)}>
        <Layer
          id="drives"
          type="line"
          paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 }}
        />
      </Source>
      <Source type="geojson" data={hikeLines(loose, () => '#525252')}>
        <Layer
          id="hikes-unplanned"
          type="line"
          paint={{ 'line-color': '#525252', 'line-width': 3, 'line-dasharray': [2, 1.5] }}
        />
      </Source>
      <Source type="geojson" data={hikeLines(backups, colorOf)}>
        <Layer
          id="hikes-backup"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-dasharray': [2, 1.5],
          }}
        />
      </Source>
      <Source type="geojson" data={hikeLines(planned, colorOf)}>
        <Layer
          id="hikes-casing"
          type="line"
          paint={{ 'line-color': '#ffffff', 'line-width': 7 }}
        />
        <Layer
          id="hikes"
          type="line"
          paint={{ 'line-color': ['get', 'color'], 'line-width': 4 }}
        />
      </Source>
      <Source
        type="geojson"
        data={hikeLines([...planned, ...backups, ...loose], () => '#000000')}
      >
        <Layer
          id="hikes-highlight"
          type="line"
          filter={['==', ['get', 'hikeId'], highlightedHikeId ?? '']}
          paint={{ 'line-color': '#f59e0b', 'line-width': 5 }}
        />
        <Layer
          id="hikes-hit"
          type="line"
          paint={{ 'line-color': '#000000', 'line-opacity': 0, 'line-width': 16 }}
        />
      </Source>
      {stops.map((stop, index) => (
        <Marker
          key={stop.id}
          longitude={stop.location.lng}
          latitude={stop.location.lat}
          anchor="center"
        >
          <span
            title={`${index + 1}. ${stop.name}`}
            className="flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-xs font-semibold text-neutral-900 shadow ring-1 ring-black/20"
          >
            {stop.kind === 'hike' ? (
              <Footprints className="size-3" aria-hidden />
            ) : (
              <PlaceIcon type={stop.kind} className="size-3" />
            )}
            {index + 1}
          </span>
        </Marker>
      ))}
      {cursor && (
        <Marker longitude={cursor.lng} latitude={cursor.lat} anchor="center">
          <span className="block size-3.5 rounded-full border-2 border-white bg-amber-500 shadow" />
        </Marker>
      )}
      {menuAt && (
        <Popup
          longitude={menuAt.lng}
          latitude={menuAt.lat}
          closeButton={false}
          onClose={() => setMenuAt(null)}
        >
          <Button
            size="sm"
            variant="outline"
            className="text-foreground"
            onClick={() => {
              setMenuAt(null);
              onAddPlaceAt(menuAt);
            }}
          >
            Ajouter un lieu ici
          </Button>
        </Popup>
      )}
    </Map>
  );
}
