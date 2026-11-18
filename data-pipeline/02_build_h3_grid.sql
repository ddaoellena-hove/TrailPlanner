-- Phase 0 — Caractéristiques des cellules H3 (résolution {{res}}).
-- Les scores eux-mêmes sont calculés en TypeScript (`shared/catalog.ts`, cellScores)
-- pour que la formule soit testée et unique.

-- Cellules couvertes : celles que touche au moins une voie (≈ toute la terre ferme).
CREATE OR REPLACE TABLE cells AS
SELECT DISTINCT h3_latlng_to_cell(ST_Y(pt), ST_X(pt), {{res}}) AS h3_index
FROM (SELECT unnest(ST_Dump(ST_Points(geom))).geom AS pt FROM ways WHERE tags['highway'] IS NOT NULL);

CREATE OR REPLACE TABLE cell_geom AS
SELECT h3_index,
  h3_cell_to_lat(h3_index) AS center_lat,
  h3_cell_to_lng(h3_index) AS center_lon,
  ST_GeomFromText(h3_cell_to_boundary_wkt(h3_index)) AS geom
FROM cells;

-- Parts de forêt et de bâti : 49 sous-cellules (résolution {{res}} + 2) testées une à une.
CREATE OR REPLACE TEMP TABLE probes AS
SELECT h3_index, ST_Point(h3_cell_to_lng(child), h3_cell_to_lat(child)) AS pt
FROM (SELECT h3_index, unnest(h3_cell_to_children(h3_index, {{res}} + 2)) AS child FROM cells);

CREATE OR REPLACE TEMP TABLE probe_hits AS
SELECT DISTINCT p.h3_index, p.pt, l.class
FROM probes p JOIN landcover l ON ST_Contains(l.geom, p.pt)
WHERE l.class IN ('forest', 'built', 'water');

CREATE OR REPLACE TEMP TABLE shares AS
SELECT c.h3_index,
  count(*) FILTER (WHERE h.class = 'forest') / 49.0 AS forest_share,
  count(*) FILTER (WHERE h.class = 'built') / 49.0 AS built_share,
  count(*) FILTER (WHERE h.class = 'water') > 0 AS water_area
FROM cells c LEFT JOIN probe_hits h USING (h3_index)
GROUP BY c.h3_index;

-- Lignes qui traversent chaque cellule.
CREATE OR REPLACE TEMP TABLE cell_lines AS
SELECT DISTINCT g.h3_index, l.class
FROM cell_geom g JOIN lines l ON ST_Intersects(g.geom, l.geom);

-- Distance en anneaux à la grande route la plus proche (plafonnée à 5).
CREATE OR REPLACE TEMP TABLE road_rings AS
SELECT n AS h3_index, min(h3_grid_distance(n, r)) AS rings
FROM (
  SELECT h3_index AS r, unnest(h3_grid_disk(h3_index, 4)) AS n
  FROM cell_lines WHERE class = 'major_road'
)
GROUP BY n;

CREATE OR REPLACE TABLE cell_features AS
SELECT g.h3_index, g.center_lat, g.center_lon,
  s.forest_share,
  s.built_share,
  s.water_area OR EXISTS (SELECT 1 FROM cell_lines cl WHERE cl.h3_index = g.h3_index AND cl.class = 'water') AS has_water,
  EXISTS (SELECT 1 FROM cell_lines cl WHERE cl.h3_index = g.h3_index AND cl.class = 'coast') AS has_coast,
  (SELECT count(*) FROM places p WHERE p.h3_index = g.h3_index AND p.category = 'viewpoint') AS viewpoints,
  coalesce(rr.rings, 5) AS rings_to_major_road,
  h3_grid_disk(g.h3_index, 1) AS neighbors
FROM cell_geom g
JOIN shares s USING (h3_index)
LEFT JOIN road_rings rr USING (h3_index);
