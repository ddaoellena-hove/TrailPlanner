import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMemo } from 'react';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import { BASE_LAYERS, mapViewOf } from '@/lib/map-layers';
import { useSettings } from '@/lib/hooks';
import type { LatLng } from '../../shared/schema';

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#ffffff' } }],
};
const FRANCE_VIEW = { longitude: 2.5, latitude: 46.6, zoom: 4.6 };
/** Trace enregistrée : distincte du vert des randos prévues. */
export const RECORDED_COLOR = '#b4532a';

/** Une trace : un tracé par segment, en [lng, lat]. */
export type MapTrack = { id: string; lines: number[][][] };

type Bounds = [[number, number], [number, number]];

function boundsOf(tracks: MapTrack[]): Bounds | null {
  const points = tracks.flatMap(({ lines }) => lines.flat());
  if (points.length === 0) return null;
  const lngs = points.map(([lng]) => lng!);
  const lats = points.map(([, lat]) => lat!);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/** Traces enregistrées sur le fond de carte choisi. Un clic ouvre la trace, si `onOpen`. */
export function TrackMap({
  tracks,
  cursor,
  onOpen,
}: {
  tracks: MapTrack[];
  cursor?: LatLng | null;
  onOpen?: (id: string) => void;
}) {
  const settings = useSettings();
  const { tiles, maxzoom, attribution } = BASE_LAYERS[settings.mapBaseLayer];
  const bounds = useMemo(() => boundsOf(tracks), [tracks]);
  const lines = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: tracks.map(({ id, lines: coordinates }) => ({
        type: 'Feature',
        properties: { trackId: id },
        geometry: { type: 'MultiLineString', coordinates },
      })),
    }),
    [tracks],
  );

  return (
    <Map
      // Une nouvelle emprise recadre la carte (aperçu d'un autre fichier, filtre de la liste).
      key={bounds?.flat().join(',') ?? 'empty'}
      initialViewState={
        bounds ? { bounds, fitBoundsOptions: { padding: 40, maxZoom: 15 } } : FRANCE_VIEW
      }
      mapStyle={EMPTY_STYLE}
      interactiveLayerIds={onOpen ? ['tracks-hit'] : []}
      cursor={onOpen ? 'pointer' : 'grab'}
      onClick={(event) => {
        const trackId: unknown = event.features?.[0]?.properties?.trackId;
        if (onOpen && typeof trackId === 'string') onOpen(trackId);
      }}
    >
      <NavigationControl showCompass={false} />
      <Source type="raster" tiles={[tiles]} tileSize={256} maxzoom={maxzoom} attribution={attribution}>
        <Layer
          id="tracks-base"
          type="raster"
          paint={{ 'raster-opacity': mapViewOf(settings).baseOpacity }}
        />
      </Source>
      <Source type="geojson" data={lines}>
        <Layer
          id="tracks-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#ffffff', 'line-width': 6 }}
        />
        <Layer
          id="tracks-lines"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': RECORDED_COLOR, 'line-width': 3.5 }}
        />
        <Layer
          id="tracks-hit"
          type="line"
          paint={{ 'line-color': RECORDED_COLOR, 'line-width': 14, 'line-opacity': 0 }}
        />
      </Source>
      {cursor && (
        <Marker longitude={cursor.lng} latitude={cursor.lat} anchor="center">
          <span className="block size-3.5 rounded-full border-2 border-white bg-foreground shadow" />
        </Marker>
      )}
    </Map>
  );
}
