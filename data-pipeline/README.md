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
| `03_extract_loops.ts` | Étape 4a (relations `route=hiking/foot/walking`) + étape 4b (boucles générées sur le graphe OSM via `shared/loop-generator.ts`, stratifiées par tuile H3 rés. 5) → distance, D+ (`CATALOG_HYSTERESIS_M = 2`), durée DIN, revêtement, chiens, réserves, incertitudes, score provisoire → `reference_trails` |
| `benchmarks/run.ts` | B1–B5 |
| `review/` | Page de revue : 20 meilleures boucles par origine, avis « J'irais / Non » → `data/ratings.json` |

Les formules (scores, revêtement, chiens, incertitudes, difficulté) sont des fonctions pures
dans `shared/catalog.ts` (`shared/catalog.test.ts`), et la génération de boucles sur graphe
dans `shared/loop-generator.ts` (`shared/loop-generator.test.ts`).

## Sources

- **OSM** : extrait Geofabrik Haute-Normandie, © contributeurs OpenStreetMap, ODbL.
- **Altitudes** : service d'altimétrie de la Géoplateforme IGN (RGE ALTI), sans clé, mis en cache
  dans `data/elevation-cache.json`. Les valeurs sous −500 m (bord de côte, hors couverture) valent « inconnu ».
- **Zones atteignables (B1)** : isochrone voiture de la Géoplateforme IGN, en cache dans `data/isochrones/`.
  Remplacé par GraphHopper en phase 2.

## Résultats du 20 novembre 2026 (avec étape 4b + seuil D+ 2 m)

Catalogue : 629 itinéraires (265 relations OSM + 364 boucles générées), 19 070 cellules H3, 5 470 lieux.

| # | Résultat | Seuil | Verdict |
| --- | --- | --- | --- |
| B1 | Rouen 207 · Le Havre 31 · Évreux 160 boucles de 5–15 km à ≤ 45 min | ≥ 30 par origine | **OK** |
| B2 | — | ≥ 60 % « J'irais » | **En attente** des avis de David |
| B3 | Distance : 0 % d'écart sur les deux GPX. D+ : Voltaire −2 % (83 vs 85 m), Crevon −3 % (164 vs 169 m) | ± 5 % / ± 15 % | **OK** |
| B4 | Construction 46 s (étape 03, 7 requêtes IGN) / ≈ 10 min (à froid complet) ; requête ≤ 15 ms | < 30 min / < 500 ms | **OK** |
| B5 | 0 inconnue non signalée sur 629 itinéraires | 100 % | **OK** |

**Ce que ça dit :**

1. **L'étape 4b débloque B1 partout**, y compris dans l'Eure (4 → 160) et autour du Havre (12 → 31),
   grâce à une stratification par tuile H3 rés. 5 (≈ 250 km²) qui évite que les grands massifs forestiers
   ne captent toutes les graines au détriment du Pays de Caux. Les boucles générées sont marquées
   explicitement (`source_type = 'generated_loop'`, badge « générée OSM » dans la page de revue).
2. **Seuil D+ à 2 m (`CATALOG_HYSTERESIS_M = 2`)** : cohérent avec les sorties enregistrées
   (`RECORDED_HYSTERESIS_M = 2`), ramène les deux fixtures dans ±3 % d'AllTrails.
3. **Chiens : 100 % inconnu.** Aucun itinéraire ni tronçon n'a de tag `dog`. La contrainte
   « avec chien » ne pourra que signaler l'incertitude, jamais filtrer, sauf autre source.
4. **Revêtement : 48 % des itinéraires incomplets**, surtout des `highway=track` sans `surface` ni
   `tracktype`. Les traiter comme « non goudronné probable » reste un choix à valider.
5. **Prochaine étape :** recueillir les avis B2 via `npm run catalog:review` (`http://127.0.0.1:5176`)
   pour statuer go / no-go.
