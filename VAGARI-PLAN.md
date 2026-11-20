# Vagari — Plan de réalisation par phases

Source : `Downloads/Specs/gemini-code-*.md` (architecture D) et ses annexes SQL/TS.
Point de départ : TrailPlanner sur `main` (≈ 22 k lignes, Hono, stockage JSON dans `trips/`, routage ORS ou IGN, fonds IGN en ligne).

**Principe : valider les données avant de toucher l'application.** Le risque de Vagari n'est pas le code mais la qualité des boucles et des scores tirés d'OSM. La phase 0 est un test isolé avec un go / no-go ; tant qu'elle n'est pas concluante, TrailPlanner reste tel quel.

Effort total estimé : **16 à 24 semaines** pour une personne à plein temps (moins avec agents, sauf la phase 0 qui dépend de l'évaluation humaine).

---

## Décisions provisoires (à confirmer, voir § Questions)

| Sujet | Spec Vagari | Choix provisoire | Raison |
| --- | --- | --- | --- |
| Serveur | Fastify | **Garder Hono** | Réécriture sans gain fonctionnel, 1–2 semaines économisées |
| Structure | `apps/` + `packages/` | **Garder `src/` `server/` `shared/`**, ajouter `data-pipeline/` | Le monorepo n'apporte rien tant qu'il n'y a qu'une app |
| Région pilote | non précisée | **Haute-Normandie** (Seine-Maritime + Eure) | Fixtures réelles déjà là (Vallée du Crevon), connue de David pour juger |
| MNT | SRTM / RGE ALTI | **IGN RGE ALTI 5 m** (ouvert), repli Copernicus GLO-30 | Précision et cohérence avec les fonds IGN |
| Fonds de carte | PMTiles local | **IGN en ligne conservé**, PMTiles OSM ajouté pour le hors-ligne | Les fonds IGN restent les meilleurs en ligne |
| Export Obsidian | absent | **Conservé** tel quel (remplace Notion depuis le 20 nov. 2026) | Rien dans Vagari ne le remplace |
| Règles CLAUDE.md | — | **Toutes conservées** (pas de scraping AllTrails, GPX immuables, calculs purs dans `shared/`, une phase = une branche + une PR) | Compatibles avec la spec |

---

## Phase 0 — Test des données (2–3 semaines) · go / no-go

> **Verdict GO (20 novembre 2026) :** tous les benchmarks **B1 à B5 sont OK** — Rouen 207 ·
> Le Havre 31 · Évreux 160 boucles de 5–15 km ; **B2 = 100 % « J'irais » (60/60 avis)** ;
> D+ à −2 % (Voltaire) et −3 % (Crevon) ; construction 46 s / requête max 6 ms ; 0 violation B5
> sur 629 itinéraires (265 relations OSM + 364 boucles générées). Phase 0 validée → feu vert pour V1.

**But :** savoir si OSM + MNT donnent des suggestions de randos que David ferait vraiment.

Livrable : `data-pipeline/` autonome, sans toucher à l'application.

1. Extraction Geofabrik de la région → DuckDB Spatial (`01_ingest_osm.sql`) : sentiers, routes, surfaces, POI.
2. Table `places` (départs, points de vue, patrimoine, villages, eau) avec `dog_access`, `access_status`, attribution.
3. Grille H3 rés. 8 (extension DuckDB `h3`) : `scenic`, `isolation`, `heritage`, `roughness` — formules écrites et documentées, pas de boîte noire.
4. `reference_trails` en deux temps :
   - **a.** relations OSM `route=hiking` (GR, PR, boucles balisées) : simple et fiable ;
   - **b.** boucles générées depuis les départs (5–20 km), seulement si (a) ne couvre pas assez.
5. Distance, D+ (même lissage que `shared/gpx.ts`), durée Naismith/DIN, `paved_ratio`, moyennes de scores.
6. Page de revue : carte des 20 meilleures boucles pour 3 origines, notées par David (« j'irais » / « non, parce que… »).

**Benchmarks** (absents de la spec, définition proposée) :

| # | Mesure | Seuil de go |
| --- | --- | --- |
| B1 | Couverture : boucles de 5–15 km à moins de 45 min de voiture, par origine | ≥ 30 |
| B2 | Pertinence : part des 20 premières jugées « j'irais » par David | ≥ 60 % |
| B3 | Exactitude : distance et D+ comparés aux GPX AllTrails des fixtures | ± 5 % distance, ± 15 % D+ |
| B4 | Performance : construction du catalogue / requête de candidats | < 30 min / < 500 ms |
| B5 | Honnêteté : boucles dont l'accès chien ou le statut est inconnu signalées comme telles | 100 % |

**No-go** si B2 < 40 % après deux itérations sur les formules : on s'arrête là, ou on se limite aux relations OSM balisées.

---

## Phase 1 — Socle utilisateur et renommage (2–3 semaines)

- Stockage JSON (`trips/`) → **SQLite** (`better-sqlite3` + Kysely) : voyages, bibliothèque, sorties, réglages. Migration unique et testée, sauvegarde JSON conservée.
- Coffre GPX : originaux bruts + SHA-256 (déjà en partie fait dans la bibliothèque, question 33), jamais modifiés.
- Renommage **TrailPlanner → Vagari** : package, interface, logo, README, SPEC, CLAUDE.md. **Page Notion** : le titre « Carnet d'itinéraire — généré par TrailPlanner » sert à la retrouver ; il faut retrouver aussi l'ancien titre et le renommer au premier export, sinon un second carnet est créé.
- **Démo de fin :** toutes les fonctions actuelles marchent sur SQLite ; tests unitaires et e2e verts.

## Phase 2 — Routage local GraphHopper (1–2 semaines)

- GraphHopper sur la machine (Docker plus simple qu'une JVM nue), données OSM + MNT de la région.
- Profils : voiture, rando (relief et revêtement), vélo en option. **Isochrones** pour le budget temps.
- Derrière l'interface existante (`server/routing.ts`) : ORS puis IGN restent en repli, hors région notamment.
- **Démo :** isochrone de 45 min autour d'une origine ; trajets d'un voyage existant recalculés en local.

## Phase 3 — Moteur de découverte (2–3 semaines)

- `DiscoveryQuerySchema` et `SuggestionResult` dans `shared/schema.ts`.
- Pipeline **pur et testé** dans `shared/discovery/` : filtre (isochrone, contraintes dures : chien, D+, bitume) → score pondéré par l'intention → diversification MMR.
- Explication : facteurs positifs, compromis, incertitudes (`DOG_ACCESS_UNKNOWN`, etc.), provenance (snapshot, sources).
- Nouveauté : déduite de « Mes sorties » (déjà faites = pénalisées).
- Route `POST /api/discover` ; table `suggestion_feedback`.
- **Aucun LLM** dans ce chemin.

## Phase 4 — Escapades, Découvrir et Préparer (3–4 semaines)

- Assemblage : origine → approche → ancre (boucle) → étape bonus (< 15 min de détour) → retour, avec timeline porte-à-porte.
- Espace **Découvrir** : carte, filtres d'intention, « Surprends-moi ».
- Espace **Préparer** : fiche escapade, incertitudes, sauvegarde, variantes.
- Lien avec l'existant : une escapade enregistrée peut devenir une étape d'un voyage (voir question 4).
- Mise en page adaptative : panneaux latéraux sur ordinateur, panneaux bas sur mobile.

## Phase 5 — Journal (1 semaine)

- « Mes sorties » devient **Journal** : sorties reliées à une escapade comme aujourd'hui à une rando prévue (le tableau prévu / réalisé existe déjà).
- Note et commentaire par sortie, qui alimentent la nouveauté et le rythme.

## Phase 6 — Mode terrain hors-ligne (2–3 semaines)

- Fond OSM en **PMTiles** pour la région (Protomaps / Planetiler), servi en HTTP Range.
- **PWA** : service worker, pack d'escapade (extrait PMTiles + JSON) dans l'OPFS, export GPX en un clic.
- Espace **Go** : position, trace, profil, sans réseau.
- **Démo :** iPhone en mode avion, pack chargé, position suivie sur la boucle.

## Phase 7 — Adaptateur d'intention IA (quelques jours)

- L'assistant existant traduit une phrase (« 3 h, au calme, avec le chien ») en `DiscoveryQuery` validée par zod, et résume l'explication.
- Interdits : coordonnées, routes, durées, règles d'accès générées par le LLM (déjà le principe de `shared/assistant-ops.ts`).

---

## Jalons

| # | Jalon | Durée | Démo de fin |
| --- | --- | --- | --- |
| V0 | Test des données | 2–3 sem | B1–B5 mesurés, décision go / no-go |
| V1 | SQLite + renommage | 2–3 sem | Tout TrailPlanner marche sur SQLite, nommé Vagari |
| V2 | GraphHopper | 1–2 sem | Isochrone 45 min, trajets en local |
| V3 | Découverte | 2–3 sem | 10 suggestions expliquées pour une origine |
| V4 | Escapades + UI | 3–4 sem | Escapade assemblée, enregistrée, ajoutée à un voyage |
| V5 | Journal | 1 sem | Sortie liée à une escapade, prévu / réalisé |
| V6 | Hors-ligne | 2–3 sem | Escapade suivie en mode avion |
| V7 | Intention IA | < 1 sem | Phrase → requête → suggestions |

Chaque jalon : une branche, une PR, lint + typecheck + tests verts, README à jour. V2 et V3 peuvent avancer en parallèle une fois V0 validé.

---

## Questions à trancher par David

1. **Région pilote** : Haute-Normandie, ou une autre ?
2. **Hono ou Fastify** : garder Hono (provisoire) ?
3. **Monorepo** `apps/` + `packages/` maintenant, ou plus tard s'il y a une seconde app ?
4. **Voyages et escapades** : Vagari vise la sortie d'une journée ; TrailPlanner planifie des road trips de plusieurs jours. Les deux coexistent-ils (provisoire : oui, une escapade peut entrer dans un voyage) ?
5. **Tellus** (`tellus_specifications_…md`, données immobilières et territoriales normandes) : projet séparé, ou à fusionner ? Il partage SQLite + DuckDB.
6. **Hors France** : GraphHopper et OSM marchent partout, mais l'IGN (fonds, géocodage, MNT) non. La France suffit-elle ?
7. **Benchmarks** : les seuils B1–B5 proposés ci-dessus conviennent-ils ?
