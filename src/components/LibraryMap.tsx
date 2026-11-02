import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMemo } from 'react';
import Map, { Layer, NavigationControl, Source } from 'react-map-gl/maplibre';
import { BASE_LAYERS, mapViewOf } from '@/lib/map-layers';
import { useSettings } from '@/lib/hooks';
import type { LibraryHike } from '../../shared/schema';

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#ffffff' } }],
};
const FRANCE_VIEW = { longitude: 2.5, latitude: 46.6, zoom: 4.6 };
const HIKE_COLOR = '#2f6b4b';

type Bounds = [[number, number], [number, number]];

function boundsOf(hikes: LibraryHike[]): Bounds | null {
  const points = hikes.flatMap(({ stats }) => stats.profile);
  if (points.length === 0) return null;
  const lngs = points.map(({ lng }) => lng);
  const lats = points.map(({ lat }) => lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/** Tracés de la bibliothèque. Un clic ouvre la fiche de la rando. */
export function LibraryMap({
  hikes,
  onOpen,
}: {
  hikes: LibraryHike[];
  onOpen: (hikeId: string) => void;
}) {
  const settings = useSettings();
  const { tiles, maxzoom, attribution } = BASE_LAYERS[settings.mapBaseLayer];
  const bounds = useMemo(() => boundsOf(hikes), [hikes]);
  const lines = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: hikes.map(({ id, stats }) => ({
        type: 'Feature',
        properties: { hikeId: id },
        geometry: {
          type: 'LineString',
          coordinates: stats.profile.map(({ lng, lat }) => [lng, lat]),
        },
      })),
    }),
    [hikes],
  );

  return (
    <Map
      initialViewState={
        bounds ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 13 } } : FRANCE_VIEW
      }
      mapStyle={EMPTY_STYLE}
      interactiveLayerIds={['library-hit']}
      cursor="pointer"
      onClick={(event) => {
        const hikeId: unknown = event.features?.[0]?.properties?.hikeId;
        if (typeof hikeId === 'string') onOpen(hikeId);
      }}
    >
      <NavigationControl showCompass={false} />
      <Source type="raster" tiles={[tiles]} tileSize={256} maxzoom={maxzoom} attribution={attribution}>
        <Layer
          id="library-base"
          type="raster"
          paint={{ 'raster-opacity': mapViewOf(settings).baseOpacity }}
        />
      </Source>
      <Source type="geojson" data={lines}>
        <Layer
          id="library-lines"
          type="line"
          paint={{ 'line-color': HIKE_COLOR, 'line-width': 3 }}
        />
        <Layer
          id="library-hit"
          type="line"
          paint={{ 'line-color': HIKE_COLOR, 'line-width': 14, 'line-opacity': 0 }}
        />
      </Source>
    </Map>
  );
}
