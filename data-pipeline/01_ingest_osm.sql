-- Phase 0 — Extraction OSM (.osm.pbf) vers les tables du catalogue.
-- Paramètre : {{pbf}} chemin de l'extrait Geofabrik.
-- Les tables `osm_*` sont intermédiaires ; `places`, `landcover`, `lines`,
-- `trail_relations` et `trail_members` servent aux étapes suivantes.

-- Aire à réglementation propre (réserve naturelle, réserve biologique, cœur de parc).
-- Les parcs naturels régionaux (classe 5), Natura 2000 et sites UNESCO n'en sont pas.
CREATE OR REPLACE TEMP MACRO is_reserve(t) AS
  t['leisure'] = 'nature_reserve'
  OR (t['boundary'] = 'protected_area' AND t['protect_class'] IN ('1', '1a', '1b', '2', '3', '4'));

CREATE OR REPLACE TEMP TABLE raw AS
SELECT kind, id, tags, refs, lat, lon, ref_roles, ref_types FROM ST_ReadOSM('{{pbf}}');

-- Relations utiles : itinéraires pédestres, multipolygones de forêt, d'eau, de bâti et aires protégées.
CREATE OR REPLACE TEMP TABLE osm_relations AS
SELECT id, tags, refs, ref_roles, ref_types,
  CASE
    WHEN tags['route'] IN ('hiking', 'foot', 'walking') THEN 'trail'
    WHEN is_reserve(tags) THEN 'reserve'
    WHEN tags['landuse'] = 'forest' OR tags['natural'] = 'wood' THEN 'forest'
    WHEN tags['natural'] = 'water' OR tags['landuse'] = 'reservoir' THEN 'water'
    WHEN tags['landuse'] IN ('residential', 'industrial', 'commercial', 'retail') THEN 'built'
  END AS class
FROM raw
WHERE kind = 'relation'
  AND (tags['route'] IN ('hiking', 'foot', 'walking')
    OR (tags['type'] IN ('multipolygon', 'boundary') AND (
      is_reserve(tags)
      OR tags['landuse'] IN ('forest', 'residential', 'industrial', 'commercial', 'retail', 'reservoir')
      OR tags['natural'] IN ('wood', 'water'))));

CREATE OR REPLACE TEMP TABLE osm_members AS
SELECT rel_id, class, way_id, coalesce(role, '') AS role, seq FROM (
  SELECT id AS rel_id, class,
    unnest(refs) AS way_id, unnest(ref_roles) AS role, unnest(ref_types) AS type,
    generate_subscripts(refs, 1) AS seq
  FROM osm_relations
) WHERE type = 'way';

-- Chemins utiles : voirie, couverture du sol, eau, côte, falaises, lieux en surface, membres des relations.
CREATE OR REPLACE TEMP TABLE osm_ways AS
SELECT id, tags, refs FROM raw
WHERE kind = 'way' AND (
  tags['highway'] IS NOT NULL
  OR tags['landuse'] IN ('forest', 'residential', 'industrial', 'commercial', 'retail', 'reservoir')
  OR tags['natural'] IN ('wood', 'water', 'coastline', 'cliff', 'beach')
  OR tags['waterway'] IN ('river', 'stream', 'canal')
  OR is_reserve(tags)
  OR tags['historic'] IS NOT NULL OR tags['tourism'] = 'viewpoint'
  OR id IN (SELECT way_id FROM osm_members)
);

CREATE OR REPLACE TEMP TABLE osm_nodes AS
SELECT id, lat, lon FROM raw WHERE kind = 'node';

-- Géométrie des chemins, dans l'ordre des nœuds.
CREATE OR REPLACE TABLE way_geom AS
WITH pts AS (
  SELECT w.id, unnest(w.refs) AS node_id, generate_subscripts(w.refs, 1) AS i FROM osm_ways w
)
SELECT p.id, ST_MakeLine(list(ST_Point(n.lon, n.lat) ORDER BY p.i)) AS geom
FROM pts p JOIN osm_nodes n ON n.id = p.node_id
GROUP BY p.id
HAVING count(*) >= 2;

CREATE OR REPLACE TABLE ways AS
SELECT w.id, w.tags, g.geom, ST_Length_Spheroid(g.geom) / 1000 AS length_km
FROM osm_ways w JOIN way_geom g USING (id);

-- Couverture du sol : chemins fermés, puis multipolygones (anneaux extérieurs, trous ignorés).
CREATE OR REPLACE TABLE landcover AS
WITH closed_ways AS (
  SELECT
    CASE
      WHEN is_reserve(tags) THEN 'reserve'
      WHEN tags['landuse'] = 'forest' OR tags['natural'] = 'wood' THEN 'forest'
      WHEN tags['natural'] = 'water' OR tags['landuse'] = 'reservoir' THEN 'water'
      WHEN tags['landuse'] IN ('residential', 'industrial', 'commercial', 'retail') THEN 'built'
    END AS class,
    tags['name'] AS name,
    ST_MakePolygon(geom) AS geom
  FROM ways
  WHERE ST_IsClosed(geom) AND ST_NPoints(geom) >= 4
),
rel_rings AS (
  SELECT r.class, r.tags['name'] AS name, unnest(ST_Dump(ST_LineMerge(ST_Collect(list(w.geom))))).geom AS ring
  FROM osm_relations r
  JOIN osm_members m ON m.rel_id = r.id AND m.role IN ('outer', '')
  JOIN ways w ON w.id = m.way_id
  WHERE r.class <> 'trail'
  GROUP BY r.id, r.class, r.tags['name']
)
SELECT class, name, geom FROM closed_ways WHERE class IS NOT NULL
UNION ALL
SELECT class, name, ST_MakePolygon(ring) FROM rel_rings
WHERE ST_IsClosed(ring) AND ST_NPoints(ring) >= 4;

-- Lignes qualifiantes : grandes routes, eau courante, côte et falaises.
CREATE OR REPLACE TABLE lines AS
SELECT
  CASE
    WHEN tags['highway'] IN ('motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link') THEN 'major_road'
    WHEN tags['waterway'] IS NOT NULL THEN 'water'
    WHEN tags['natural'] IN ('coastline', 'cliff', 'beach') THEN 'coast'
  END AS class,
  geom
FROM ways
WHERE tags['highway'] IN ('motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link')
   OR tags['waterway'] IS NOT NULL
   OR tags['natural'] IN ('coastline', 'cliff', 'beach');

-- Itinéraires pédestres et leurs tronçons (dans l'ordre de la relation).
CREATE OR REPLACE TABLE trail_relations AS
SELECT id, tags FROM osm_relations WHERE class = 'trail';

CREATE OR REPLACE TABLE trail_members AS
SELECT m.rel_id, m.seq, w.id AS way_id, w.tags, w.geom, w.length_km
FROM osm_members m JOIN ways w ON w.id = m.way_id
WHERE m.class = 'trail' AND m.role NOT IN ('platform', 'stop', 'guidepost', 'information');

-- Lieux : points de vue, sommets, eau, patrimoine, villages, départs.
CREATE OR REPLACE TABLE places AS
WITH candidates AS (
  SELECT 'osm:node:' || id AS external_id, tags, lat, lon FROM raw
  WHERE kind = 'node' AND tags IS NOT NULL AND cardinality(tags) > 0
  UNION ALL
  SELECT 'osm:way:' || id, tags, ST_Y(ST_Centroid(geom)), ST_X(ST_Centroid(geom)) FROM ways
  WHERE tags['historic'] IS NOT NULL OR tags['tourism'] = 'viewpoint'
),
classified AS (
  SELECT *,
    CASE
      WHEN tags['tourism'] = 'viewpoint' THEN 'viewpoint'
      WHEN tags['natural'] = 'peak' THEN 'peak'
      WHEN tags['natural'] IN ('waterfall', 'spring') OR tags['waterway'] = 'waterfall' THEN 'water'
      WHEN tags['historic'] IN ('castle', 'ruins', 'monument', 'archaeological_site', 'manor', 'abbey',
                                'church', 'chapel', 'fort', 'mill', 'city_gate', 'tower')
        OR (tags['heritage'] IS NOT NULL AND tags['wikidata'] IS NOT NULL) THEN 'heritage'
      WHEN tags['place'] IN ('village', 'hamlet', 'town') THEN 'village'
      WHEN tags['highway'] = 'trailhead' THEN 'trailhead'
      WHEN tags['amenity'] = 'parking' AND coalesce(tags['access'], 'yes') IN ('yes', 'public', 'customers') THEN 'parking'
    END AS category
  FROM candidates
)
SELECT
  external_id AS place_id,
  external_id,
  tags['name'] AS name,
  category,
  lat, lon,
  ST_Point(lon, lat) AS geom,
  h3_latlng_to_cell(lat, lon, {{h3_resolution}}) AS h3_index,
  tags['dog'] AS dog_tag,
  tags['access'] AS access_tag,
  tags['wikidata'] AS wikidata,
  tags['wikipedia'] AS wikipedia,
  tags['heritage'] AS heritage,
  '© OpenStreetMap contributors (ODbL)' AS source_attribution,
  to_json(tags) AS raw_tags
FROM classified
WHERE category IS NOT NULL;

DROP TABLE way_geom;
