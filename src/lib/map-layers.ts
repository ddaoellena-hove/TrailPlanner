import type { Settings } from '../../shared/schema';

function wmts(layer: string, style: string, format: 'png' | 'jpeg'): string {
  return (
    `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}` +
    `&STYLE=${style}&TILEMATRIXSET=PM&FORMAT=image/${format}` +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
  );
}

type Raster = { tiles: string; maxzoom: number; attribution: string };

export const BASE_LAYERS: Record<Settings['mapBaseLayer'], Raster & { label: string }> = {
  'ign-plan': {
    label: 'Plan IGN',
    tiles: wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'normal', 'png'),
    maxzoom: 19,
    attribution: '© IGN',
  },
  ortho: {
    label: 'Photos aériennes',
    tiles: wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'normal', 'jpeg'),
    maxzoom: 19,
    attribution: '© IGN',
  },
  osm: {
    label: 'OpenStreetMap',
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxzoom: 19,
    attribution: '© contributeurs OpenStreetMap',
  },
};

/** Couches IGN transparentes, de la plus basse à la plus haute. */
export const OVERLAYS = [
  {
    id: 'relief',
    label: 'Relief ombré',
    tiles: wmts('ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'estompage_grayscale', 'png'),
    maxzoom: 15,
    opacity: 0.55,
  },
  {
    id: 'slopes',
    label: 'Pentes',
    tiles: wmts('GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN', 'normal', 'png'),
    maxzoom: 17,
    opacity: 0.6,
  },
  {
    id: 'contours',
    label: 'Courbes de niveau',
    tiles: wmts('ELEVATION.CONTOUR.LINE', 'normal', 'png'),
    maxzoom: 18,
    opacity: 0.8,
  },
  {
    id: 'water',
    label: 'Cours d’eau et lacs',
    tiles: wmts('HYDROGRAPHY.HYDROGRAPHY', 'normal', 'png'),
    maxzoom: 18,
    opacity: 1,
  },
  {
    id: 'roads',
    label: 'Routes',
    tiles: wmts('TRANSPORTNETWORKS.ROADS', 'normal', 'png'),
    maxzoom: 18,
    opacity: 1,
  },
  {
    id: 'winter-trails',
    label: 'Traces de randonnée hivernale',
    tiles: wmts('TRACES.RANDO.HIVERNALE', 'normal', 'png'),
    maxzoom: 16,
    opacity: 1,
  },
] as const;

/** Éléments du voyage qu'on peut masquer pour alléger la carte. */
export const TRIP_LAYERS = [
  { id: 'hikes', label: 'Tracés des randos' },
  { id: 'drives', label: 'Trajets en voiture' },
  { id: 'stops', label: 'Repères des étapes' },
  { id: 'stations', label: 'Bornes de recharge' },
  { id: 'pois', label: 'Points utiles' },
] as const;

export type TripLayerId = (typeof TRIP_LAYERS)[number]['id'];

export type MapView = {
  baseOpacity: number;
  overlays: string[];
  hidden: string[];
};

export function mapViewOf(settings: Settings): MapView {
  return {
    baseOpacity: settings.mapBaseOpacity ?? 1,
    overlays: settings.mapOverlays ?? [],
    hidden: settings.mapHiddenLayers ?? [],
  };
}
