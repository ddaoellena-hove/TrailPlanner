# data-pipeline — Phase 0 de Vagari (test des données)

Construit un catalogue DuckDB à partir d'OpenStreetMap et de l'altimétrie IGN, puis mesure
les benchmarks B1–B5 de `VAGARI-PLAN.md`. Indépendant de l'application : rien ici n'est
utilisé par `src/` ni `server/`.

## Commandes

```bash
# 1. Extrait OSM (108 Mo, ODbL), une fois
curl -L -o data-pipeline/data/haute-normandie-latest.osm.pbf \
  https://download.geofabrik.de/europe/france/haute-normandie-latest.osm.pbf

npm run catalog:build    # catalogue → data/catalog_v0.duckdb (≈ 9 min à froid, 5 s avec le cache d'altitudes)
npm run catalog:bench    # B1–B5 → data/benchmarks.json
npm run catalog:review   # page de revue B2 sur http://127.0.0.1:5176
```

`catalog:build -- --from-02` ou `--from-03` repart du catalogue existant pour itérer sur une étape.
Tout ce que produit le pipeline va dans `data/` (gitignoré).

## Étapes

| Fichier | Rôle |
| --- | --- |
| `01_ingest_osm.sql` | `.osm.pbf` → `ways`, `landcover` (forêt, eau, bâti, réserves ; multipolygones assemblés), `lines` (grandes routes, eau, côte), `places`, `trail_relations`, `trail_members` |
| `02_build_h3_grid.sql` + `.ts` | Cellules H3 rés. 8 : parts de forêt et de bâti (49 sondes), eau, côte, points de vue, distance aux grandes routes, relief (écart-type de 7 altitudes IGN), patrimoine → `h3_cells` via `cellScores` |
| `03_extract_loops.ts` | Relations `route=hiking/foot/walking` → tracé assemblé, distance, D+ et durée DIN (`computeHikeStats`), revêtement, chiens, réserves, incertitudes, score provisoire → `reference_trails` |
| `benchmarks/run.ts` | B1–B5 |
| `review/` | Page de revue : 20 meilleures boucles par origine, avis « J'irais / Non » → `data/ratings.json` |

Les formules (scores, revêtement, chiens, incertitudes, difficulté) sont des fonctions pures
dans `shared/catalog.ts`, testées dans `shared/catalog.test.ts`.

## Sources

- **OSM** : extrait Geofabrik Haute-Normandie, © contributeurs OpenStreetMap, ODbL.
- **Altitudes** : service d'altimétrie de la Géoplateforme IGN (RGE ALTI), sans clé, mis en cache
  dans `data/elevation-cache.json`. Les valeurs sous −500 m (bord de côte, hors couverture) valent « inconnu ».
- **Zones atteignables (B1)** : isochrone voiture de la Géoplateforme IGN, en cache dans `data/isochrones/`.
  Remplacé par GraphHopper en phase 2.

## Résultats du 18 novembre 2026

Catalogue : 265 itinéraires (176 boucles), 19 070 cellules H3, 5 470 lieux.

| # | Résultat | Seuil | Verdict |
| --- | --- | --- | --- |
| B1 | Rouen 85 · Le Havre 12 · Évreux 4 boucles de 5–15 km à ≤ 45 min | ≥ 30 par origine | **Échec** hors Rouen |
| B2 | — | ≥ 60 % « J'irais » | **En attente** des avis de David |
| B3 | Distance : 0 % d'écart sur les deux GPX. D+ : Crevon −7 %, Voltaire −16 % | ± 5 % / ± 15 % | **Échec de justesse** (Voltaire) |
| B4 | Construction 4 s (cache) / ≈ 9 min (à froid) ; requête ≤ 5 ms | < 30 min / < 500 ms | OK |
| B5 | 0 inconnue non signalée sur 265 | 100 % | OK |

**Ce que ça dit :**

1. **La couverture OSM est très inégale.** Le nord (Seine-Maritime) compte 151 boucles de 5–15 km,
   le sud (Eure) 4. Ce n'est pas un effet de bord : 94 % de l'isochrone d'Évreux est dans l'extrait.
   Les relations balisées ne suffisent pas ; il faut l'étape 4b (boucles générées depuis le réseau de
   chemins) pour l'Eure et Le Havre.
2. **Chiens : 100 % inconnu.** Aucun itinéraire ni tronçon n'a de tag `dog`. La contrainte
   « avec chien » ne pourra que signaler l'incertitude, jamais filtrer, sauf autre source.
3. **Revêtement : 33 % des itinéraires incomplets**, surtout 916 km de `highway=track` sans
   `surface` ni `tracktype`. Les traiter comme « non goudronné probable » serait un choix à valider.
4. **D+ sous-estimé en plaine** (−7 à −16 %) : le seuil d'hystérésis de 5 m, prévu pour les MNT,
   écrête les petites bosses normandes. Un seuil de 2–3 m est à tester.
5. **Bon signe** : la sortie AllTrails « Sur les traces de Voltaire » existe dans OSM et ressort à
   93 % de recouvrement.
6. **Départs** : seuls 35 itinéraires sur 265 ont un parking à moins de 500 m de leur point de départ.
