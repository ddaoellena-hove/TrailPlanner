import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Home, Landmark } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import { BASE_LAYERS, mapViewOf } from '@/lib/map-layers';
import { useSettings } from '@/lib/hooks';
import type { BonusStop, LatLng, SuggestionResult } from '../../shared/schema';

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#ffffff' } }],
};
const NORMANDIE_VIEW = { longitude: 1.0993, latitude: 49.4431, zoom: 9.5 };
const FIT_OPTIONS = { padding: 48, maxZoom: 13.5 };
const TRAIL_COLOR = '#2f6b4b';
const ACTIVE_COLOR = '#b4532a';

type Bounds = [[number, number], [number, number]];

function boundsOf(
  origin: LatLng,
  suggestions: SuggestionResult[],
  activeTrailId: string | null,
  bonusStop: BonusStop | null,
): Bounds | null {
  const active = activeTrailId
    ? suggestions.find((s) => s.trailId === activeTrailId)
    : undefined;
  const targets = active ? [active] : suggestions;
  const points: [number, number][] = [[origin.lng, origin.lat]];
  for (const s of targets) {
    for (const coord of s.geometry.coordinates) {
      points.push(coord);
    }
  }
  if (bonusStop) points.push([bonusStop.location.lng, bonusStop.location.lat]);
  if (points.length < 2) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function DiscoverMap({
  origin,
  originName,
  suggestions,
  activeTrailId,
  bonusStop,
  pickOriginMode,
  onSelectTrail,
  onPickOrigin,
}: {
  origin: LatLng;
  originName: string;
  suggestions: SuggestionResult[];
  activeTrailId: string | null;
  bonusStop: BonusStop | null;
  pickOriginMode: boolean;
  onSelectTrail: (trailId: string) => void;
  onPickOrigin: (location: LatLng) => void;
}) {
  const settings = useSettings();
  const { tiles, maxzoom, attribution } = BASE_LAYERS[settings.mapBaseLayer];

  const bounds = useMemo(
    () => boundsOf(origin, suggestions, activeTrailId, bonusStop),
    [origin, suggestions, activeTrailId, bonusStop],
  );

  const inactiveFeatures = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: suggestions
        .filter((s) => s.trailId !== activeTrailId)
        .map((s) => ({
          type: 'Feature',
          properties: { trailId: s.trailId },
          geometry: s.geometry,
        })),
    }),
    [suggestions, activeTrailId],
  );

  const activeFeatures = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: suggestions
        .filter((s) => s.trailId === activeTrailId)
        .map((s) => ({
          type: 'Feature',
          properties: { trailId: s.trailId },
          geometry: s.geometry,
        })),
    }),
    [suggestions, activeTrailId],
  );

  const activeTrail = useMemo(
    () => suggestions.find((s) => s.trailId === activeTrailId) ?? null,
    [suggestions, activeTrailId],
  );

  const userMoved = useRef(false);
  const boundsKey = bounds?.flat().map((v) => v.toFixed(3)).join(',') ?? 'empty';
  useEffect(() => {
    userMoved.current = false;
  }, [boundsKey]);

  const fit = (map: MapLibreMap) => {
    if (bounds && !userMoved.current) map.fitBounds(bounds, { ...FIT_OPTIONS, duration: 0 });
  };

  return (
    <div className="relative h-full w-full">
      {pickOriginMode && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 rounded-md bg-background/95 px-3 py-1.5 text-xs font-medium shadow border">
          Cliquez sur la carte pour placer votre point de départ
        </div>
      )}
      <Map
        key={boundsKey}
        initialViewState={bounds ? { bounds, fitBoundsOptions: FIT_OPTIONS } : NORMANDIE_VIEW}
        onLoad={(event) => fit(event.target)}
        onResize={(event) => fit(event.target)}
        onMoveStart={(event) => {
          if (event.originalEvent) userMoved.current = true;
        }}
        mapStyle={EMPTY_STYLE}
        interactiveLayerIds={pickOriginMode ? [] : ['discover-hit', 'discover-active-hit']}
        cursor={pickOriginMode ? 'crosshair' : 'grab'}
        onClick={(event) => {
          if (pickOriginMode) {
            onPickOrigin({ lat: event.lngLat.lat, lng: event.lngLat.lng });
            return;
          }
          const trailId: unknown = event.features?.[0]?.properties?.trailId;
          if (typeof trailId === 'string') onSelectTrail(trailId);
        }}
      >
        <NavigationControl showCompass={false} />
        <Source
          type="raster"
          tiles={[tiles]}
          tileSize={256}
          maxzoom={maxzoom}
          attribution={attribution}
        >
          <Layer
            id="discover-base"
            type="raster"
            paint={{ 'raster-opacity': mapViewOf(settings).baseOpacity }}
          />
        </Source>

        <Source type="geojson" data={inactiveFeatures}>
          <Layer
            id="discover-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.85 }}
          />
          <Layer
            id="discover-lines"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': TRAIL_COLOR, 'line-width': 3, 'line-opacity': 0.85 }}
          />
          <Layer
            id="discover-hit"
            type="line"
            paint={{ 'line-color': TRAIL_COLOR, 'line-width': 16, 'line-opacity': 0 }}
          />
        </Source>

        <Source type="geojson" data={activeFeatures}>
          <Layer
            id="discover-active-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#ffffff', 'line-width': 7 }}
          />
          <Layer
            id="discover-active-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ACTIVE_COLOR, 'line-width': 4 }}
          />
          <Layer
            id="discover-active-hit"
            type="line"
            paint={{ 'line-color': ACTIVE_COLOR, 'line-width': 16, 'line-opacity': 0 }}
          />
        </Source>

        <Marker longitude={origin.lng} latitude={origin.lat} anchor="center">
          <div
            title={`Départ : ${originName}`}
            className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-md"
          >
            <Home className="size-3.5" aria-hidden />
          </div>
        </Marker>

        {activeTrail && (
          <Marker longitude={activeTrail.start.lng} latitude={activeTrail.start.lat} anchor="center">
            <span
              title={`Départ de la boucle : ${activeTrail.name}`}
              className="block size-3.5 rounded-full border-2 border-white bg-[#b4532a] shadow"
            />
          </Marker>
        )}

        {bonusStop && (
          <Marker longitude={bonusStop.location.lng} latitude={bonusStop.location.lat} anchor="center">
            <div
              title={`Étape bonus : ${bonusStop.name}`}
              className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-amber-600 text-white shadow-md"
            >
              <Landmark className="size-3.5" aria-hidden />
            </div>
          </Marker>
        )}
      </Map>
    </div>
  );
}
