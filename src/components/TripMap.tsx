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
import { BASE_LAYERS, type MapView, OVERLAYS, type TripLayerId } from '@/lib/map-layers';
import { plannedStops } from '../../shared/itinerary';
import { formatStation } from '@/lib/stations';
import { type RankedStation, stationReviewsUrl } from '../../shared/charging-networks';
import type {
  FavoriteStation,
  Hike,
  ItineraryLeg,
  LatLng,
  Poi,
  Settings,
  Trip,
} from '../../shared/schema';
import { unplanned as unplannedOf } from '../../shared/trip';

/**
 * Le fond et les couches sont des sources React, modifiables sans tout recharger. Le blanc
 * sous la carte fait qu'atténuer le fond l'éclaircit, y compris en thème sombre.
 */
const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#ffffff' } }],
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

function points(
  items: { id: string; location: LatLng; favorite?: boolean }[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map(({ id, location, favorite }) => ({
      type: 'Feature',
      properties: { itemId: id, favorite: favorite ?? false },
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
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
  view,
  highlightedHikeId,
  cursor,
  onHikeHover,
  onAddPlaceAt,
  onOpenPlace,
  stations,
  favoriteStations,
  onToggleFavorite,
  onAddStation,
  pois,
  onAddPoi,
}: {
  trip: Trip;
  legs: ItineraryLeg[];
  focus: MapFocus | null;
  dayFilter: number | null;
  baseLayer: Settings['mapBaseLayer'];
  view: MapView;
  highlightedHikeId: string | null;
  cursor: LatLng | null;
  onHikeHover: (hikeId: string | null, position: LatLng) => void;
  onAddPlaceAt: (location: LatLng) => void;
  onOpenPlace: (placeId: string) => void;
  stations: RankedStation[];
  favoriteStations: FavoriteStation[];
  onToggleFavorite: (station: FavoriteStation) => void;
  onAddStation: (station: FavoriteStation) => void;
  pois: Poi[];
  onAddPoi: (poi: Poi) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [menuAt, setMenuAt] = useState<LatLng | null>(null);
  const [openStation, setOpenStation] = useState<FavoriteStation | null>(null);
  const [openPoi, setOpenPoi] = useState<Poi | null>(null);

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
            placeId: place.id,
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

  const shown = (id: TripLayerId) => ({
    visibility: view.hidden.includes(id) ? ('none' as const) : ('visible' as const),
  });

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
      mapStyle={EMPTY_STYLE}
      interactiveLayerIds={['hikes-hit', 'charging-stations', 'favorite-stations', 'poi-points']}
      cursor={highlightedHikeId ? 'crosshair' : 'grab'}
      onMouseMove={(event) => {
        const hit = event.features?.find((feature) => feature.layer.id === 'hikes-hit');
        const hikeId: unknown = hit?.properties?.hikeId;
        onHikeHover(typeof hikeId === 'string' ? hikeId : null, event.lngLat);
      }}
      onClick={(event) => {
        const itemIn = (layer: string): unknown =>
          event.features?.find((feature) => feature.layer.id === layer)?.properties?.itemId;
        const stationId = itemIn('favorite-stations') ?? itemIn('charging-stations');
        setOpenStation(
          [...favoriteStations, ...stations].find(({ id }) => id === stationId) ?? null,
        );
        setOpenPoi(pois.find(({ id }) => id === itemIn('poi-points')) ?? null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuAt({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      }}
    >
      <NavigationControl showCompass={false} />
      {(Object.keys(BASE_LAYERS) as Settings['mapBaseLayer'][]).map((id) => {
        const { tiles, maxzoom, attribution } = BASE_LAYERS[id];
        return (
          <Source
            key={id}
            type="raster"
            tiles={[tiles]}
            tileSize={256}
            maxzoom={maxzoom}
            attribution={attribution}
          >
            <Layer
              id={`base-${id}`}
              type="raster"
              layout={{ visibility: id === baseLayer ? 'visible' : 'none' }}
              paint={{ 'raster-opacity': view.baseOpacity }}
            />
          </Source>
        );
      })}
      {OVERLAYS.map(({ id, tiles, maxzoom, opacity }) => (
        <Source
          key={id}
          type="raster"
          tiles={[tiles]}
          tileSize={256}
          maxzoom={maxzoom}
          attribution="© IGN"
        >
          <Layer
            id={`overlay-${id}`}
            type="raster"
            layout={{ visibility: view.overlays.includes(id) ? 'visible' : 'none' }}
            paint={{ 'raster-opacity': opacity }}
          />
        </Source>
      ))}
      <Source type="geojson" data={driveLines(legs)}>
        <Layer
          id="drives"
          type="line"
          layout={shown('drives')}
          paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 }}
        />
      </Source>
      <Source type="geojson" data={hikeLines(loose, () => '#525252')}>
        <Layer
          id="hikes-unplanned"
          type="line"
          layout={shown('hikes')}
          paint={{ 'line-color': '#525252', 'line-width': 3, 'line-dasharray': [2, 1.5] }}
        />
      </Source>
      <Source type="geojson" data={hikeLines(backups, colorOf)}>
        <Layer
          id="hikes-backup"
          type="line"
          layout={shown('hikes')}
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
          layout={shown('hikes')}
          paint={{ 'line-color': '#ffffff', 'line-width': 7 }}
        />
        <Layer
          id="hikes"
          type="line"
          layout={shown('hikes')}
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
          layout={shown('hikes')}
          filter={['==', ['get', 'hikeId'], highlightedHikeId ?? '']}
          paint={{ 'line-color': '#f59e0b', 'line-width': 5 }}
        />
        <Layer
          id="hikes-hit"
          type="line"
          layout={shown('hikes')}
          paint={{ 'line-color': '#000000', 'line-opacity': 0, 'line-width': 16 }}
        />
      </Source>
      <Source type="geojson" data={points(pois)}>
        <Layer
          id="poi-points"
          type="circle"
          layout={shown('pois')}
          paint={{
            'circle-color': '#2563eb',
            'circle-radius': 4.5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          }}
        />
      </Source>
      <Source
        type="geojson"
        data={points(stations.filter(({ starred }) => !starred))}
      >
        <Layer
          id="charging-stations"
          type="circle"
          layout={shown('stations')}
          paint={{
            'circle-color': ['case', ['get', 'favorite'], '#ea580c', '#16a34a'],
            'circle-radius': ['case', ['get', 'favorite'], 6.5, 4.5],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          }}
        />
      </Source>
      <Source type="geojson" data={points(favoriteStations)}>
        <Layer
          id="favorite-stations"
          type="circle"
          layout={shown('stations')}
          paint={{
            'circle-color': '#eab308',
            'circle-radius': 8,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          }}
        />
      </Source>
      {!view.hidden.includes('stops') && stops.map((stop, index) => (
        <Marker
          key={stop.id}
          longitude={stop.location.lng}
          latitude={stop.location.lat}
          anchor="center"
          onClick={(event) => {
            event.originalEvent.stopPropagation();
            if (stop.placeId) onOpenPlace(stop.placeId);
          }}
        >
          <span
            title={`${index + 1}. ${stop.name}`}
            className="flex cursor-pointer items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-xs font-semibold text-neutral-900 shadow ring-1 ring-black/20"
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
      {openPoi && (
        <Popup
          longitude={openPoi.location.lng}
          latitude={openPoi.location.lat}
          closeOnClick={false}
          onClose={() => setOpenPoi(null)}
        >
          <div className="grid gap-1 text-xs text-neutral-900">
            <p className="font-semibold">{openPoi.name}</p>
            <Button
              size="sm"
              variant="outline"
              className="text-foreground"
              onClick={() => {
                setOpenPoi(null);
                onAddPoi(openPoi);
              }}
            >
              Ajouter au voyage
            </Button>
          </div>
        </Popup>
      )}
      {openStation && (
        <Popup
          longitude={openStation.location.lng}
          latitude={openStation.location.lat}
          closeOnClick={false}
          onClose={() => setOpenStation(null)}
        >
          <div className="grid gap-1 text-xs text-neutral-900">
            <p className="font-semibold">{openStation.name}</p>
            <p>{formatStation(openStation)}</p>
            <a
              href={stationReviewsUrl(openStation)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Avis Google Maps
            </a>
            <Button
              size="sm"
              variant="outline"
              className="text-foreground"
              onClick={() => {
                setOpenStation(null);
                onAddStation(openStation);
              }}
            >
              Ajouter au voyage
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-neutral-900"
              onClick={() => {
                setOpenStation(null);
                onToggleFavorite(openStation);
              }}
            >
              {favoriteStations.some(({ id }) => id === openStation.id)
                ? 'Retirer des favoris'
                : 'Ajouter aux favoris'}
            </Button>
          </div>
        </Popup>
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
