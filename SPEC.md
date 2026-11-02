# SPEC — TrailPlanner : planificateur local de road trip rando

> Version 1.0 — 2 novembre 2026 — Auteur : David Dao-Ellena
> Destinataire : Claude Code. Ce document est la source de vérité fonctionnelle. En cas de doute, demander plutôt que supposer.

---

## 1. Vision

Outil **local, mono-utilisateur** pour planifier un **road trip de plusieurs jours combinant voiture et randonnées**, à partir de tracés exportés d'AllTrails.

Chaque jour du voyage est une séquence d'étapes (randos, lieux) partant de la nuit précédente et finissant à la nuit suivante. Les **trajets voiture sont calculés automatiquement** entre les étapes. L'outil affiche la charge de chaque journée et la compare aux seuils fixés par l'utilisateur, puis **exporte le carnet de voyage dans le Life OS Notion**.

### Problème résolu
Aujourd'hui, l'utilisateur prépare ses voyages à la main dans Notion : un tableau jour par jour où le D+ reste « à vérifier », les temps de route sont « à recalculer », et les traversées posent la question de la récupération du véhicule. L'outil fournit ces chiffres de façon fiable et rend visible ce qui ne tient pas.

### Principes
- **Local-first** : les données vivent sur disque, en fichiers lisibles. Aucun compte. Seule exception volontaire : l'assistant, optionnel, envoie le contenu du voyage à l'API Anthropic quand on lui écrit.
- **Calculé, pas saisi** : distance, D+, durées, trajets sont dérivés des GPX et du routage.
- **Pas de seuils imposés** : l'utilisateur définit ses propres seuils. Aucune alerte de charge tant qu'ils ne sont pas définis.
- **Notion = sortie**, pas source : l'outil écrit dans Notion, il ne lit pas le contenu Notion en V1.

---

## 2. Périmètre

### V1 (ce document)
1. Import GPX + URL AllTrails
2. Carte + profil d'altitude
3. Planning jour par jour (glisser-déposer)
4. Trajets voiture automatiques (OpenRouteService)
5. Logistique en saisie manuelle (hébergements, recharge, ravitos, POI)
6. Réglages : rythme de marche et seuils d'alerte
7. Export vers Notion

### V2 (hors V1, ne pas implémenter, mais ne pas bloquer)
- Export GPX par jour / fusionné ; roadbook PDF

### Hors périmètre
- Planification automatique de la recharge VE selon l'autonomie (les bornes sur le trajet sont en V1, au choix manuel, voir question 23).
- Récupération automatique des tracés depuis AllTrails (scraping, API interne) : fragile et contraire aux CGU.
- Multi-utilisateur, authentification, déploiement en ligne, app mobile.
- Synchronisation bidirectionnelle avec Notion.

---

## 3. Stack technique

| Couche | Choix | Notes |
| --- | --- | --- |
| Langage | TypeScript strict partout | `strict: true`, pas de `any` |
| Front | Vite + React 19 | |
| UI | **shadcn/ui** + Tailwind CSS | Composants copiés dans `src/components/ui`. Thème clair/sombre. |
| Carte | MapLibre GL via `react-map-gl/maplibre` | |
| Fond de carte | Plan IGN v2 (Géoplateforme, WMTS, sans clé) ; repli OSM | Sélecteur de fond. Vérifier l'URL WMTS actuelle de data.geopf.fr. |
| Profil altimétrique | Recharts (via les charts shadcn) | |
| Glisser-déposer | dnd-kit | |
| Parsing GPX | `@tmcw/togeojson` | |
| Géo-calculs | `@turf/turf` | |
| Validation | zod (schémas partagés front/back) | |
| État front | Zustand ou TanStack Query (au choix, justifier) | |
| Backend | Node + Hono | Sert l'API locale, détient les clés, écrit les fichiers. |
| Notion | `@notionhq/client` (officiel) | Appels **uniquement côté serveur** : l'API Notion refuse les appels navigateur. |
| Routage | OpenRouteService Directions API, profil `driving-car` | Clé gratuite dans `.env`. |
| Bornes de recharge | Base nationale IRVE (data.gouv.fr, API tabulaire) ; Open Charge Map pour Electra | IRVE sans clé, France uniquement, mise à jour quotidienne. Open Charge Map optionnel, avec `OPENCHARGEMAP_API_KEY`. |
| Tests | Vitest (unitaires) + Playwright (1 parcours e2e) | |
| Lancement | `npm run dev` lance front + back (concurrently) | Ports par défaut : web 5173, api 5174. |

### Variables d'environnement (`.env`, avec `.env.example` commité)
```
ORS_API_KEY=
NOTION_TOKEN=                      # intégration interne Notion
NOTION_PROJECTS_DATA_SOURCE_ID=b8fc4785-1529-4e26-9e28-1871a2ae5555
NOTION_PROJECTS_DATABASE_ID=61b367773a7f4db392571f129e2079c3
NOTION_AREA_TRAVEL_PAGE_ID=404330d7113f819fb07cf43b679ec10d
TRIPS_DIR=./trips
```
L'app doit démarrer et rester utilisable sans `ORS_API_KEY` ni `NOTION_TOKEN` : les fonctions concernées sont désactivées avec un message explicite.

---

## 4. Modèle de données

Tous les schémas sont définis en zod dans `shared/schema.ts` et partagés front/back.

### Stockage sur disque
```
trips/
  <trip-slug>/
    trip.json           # le voyage complet (sauf géométries lourdes)
    gpx/<hikeId>.gpx    # fichier GPX original, jamais modifié
    cache/routes.json   # cache des trajets ORS
settings.json           # réglages globaux
```
`trip.json` doit rester lisible et diffable (indentation 2 espaces, clés stables). Écriture atomique (fichier temporaire + rename). Champ `schemaVersion` pour les migrations futures.

### Entités

```ts
type LatLng = { lat: number; lng: number };

type Trip = {
  schemaVersion: 1;
  id: string;                 // uuid
  slug: string;
  name: string;               // ex. "Dévoluy & Champsaur"
  startDate: string;          // ISO date
  endDate: string;            // ISO date ; nb de jours = dérivé
  origin: Place;              // départ (ex. Lyon)
  destination: Place;         // retour (par défaut = origin)
  travelers: { withDog: boolean };   // active les contrôles "chiens"
  hikes: Hike[];              // bibliothèque du voyage
  places: Place[];            // hébergements, recharge, ravitos, POI
  days: Day[];                // générés à partir des dates
  notion?: { projectPageId?: string; itineraryPageId?: string; lastExportAt?: string };
  createdAt: string; updatedAt: string;
};

type Hike = {
  id: string;
  name: string;
  alltrailsUrl?: string;
  gpxFile: string;            // chemin relatif
  kind: 'loop' | 'out-and-back' | 'point-to-point';  // déduit, modifiable
  stats: HikeStats;           // calculées à l'import, recalculables
  start: LatLng; end: LatLng;
  dogPolicy: 'allowed' | 'leash' | 'forbidden' | 'unknown';  // défaut 'unknown'
  notes?: string;
  tags?: string[];            // ex. "hiver", "panoramique"
};

type HikeStats = {
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  maxAltitudeM: number;
  minAltitudeM: number;
  estimatedDurationMin: number;  // selon Settings.pace, recalculé si les réglages changent
  profile: { distKm: number; altM: number; lat: number; lng: number }[]; // échantillonné, ≤ 500 points
};

type PlaceType = 'lodging' | 'charging' | 'food' | 'parking' | 'poi';

type Place = {
  id: string;
  type: PlaceType;
  name: string;
  location: LatLng;
  url?: string;
  price?: number;             // € ; nuit pour lodging
  bookingStatus?: 'idea' | 'to-book' | 'booked' | 'cancelled';  // lodging seulement
  dogPolicy?: 'allowed' | 'forbidden' | 'unknown';
  notes?: string;
};

type Day = {
  date: string;               // ISO date
  index: number;              // J1, J2…
  title?: string;             // ex. "Dévoluy — Col du Festre"
  stops: Stop[];              // étapes ordonnées
  nightPlaceId?: string;      // hébergement de fin de journée (absent le dernier jour → destination)
  backupHikeIds: string[];    // replis météo : affichés, non comptés dans les totaux
  notes?: string;
};

type Stop =
  | { id: string; kind: 'hike'; hikeId: string; startTime?: string }  // "HH:mm"
  | { id: string; kind: 'place'; placeId: string; durationMin?: number }; // ex. pause recharge 45 min

type DriveLeg = {               // DÉRIVÉ, jamais saisi, non persisté dans trip.json (cache seulement)
  from: LatLng; to: LatLng;
  distanceKm: number; durationMin: number;
  geometry: GeoJSON.LineString;
  source: 'ors' | 'straight-line-fallback';
};

type Settings = {
  pace: {                     // méthode DIN 33466, valeurs modifiables
    flatKmh: number;          // défaut 4
    ascentMPerH: number;      // défaut 300
    descentMPerH: number;     // défaut 500
    breakFactor: number;      // multiplicateur pauses, défaut 1.0
  };
  dayStartTime: string;       // ex. "08:30", utilisé pour l'heure de fin estimée
  thresholds: {               // TOUS optionnels, vides par défaut : pas d'alerte tant que non définis
    maxHikingHoursPerDay?: number;
    maxElevationGainPerDay?: number;
    maxDrivingHoursPerDay?: number;
    maxTotalActiveHoursPerDay?: number;  // marche + route
    latestEndTime?: string;   // "HH:mm"
  };
  mapBaseLayer: 'ign-plan' | 'osm';
};
```

### Règles de dérivation des trajets
Les trajets voiture d'un jour sont **toujours dérivés**, jamais placés à la main :
1. Point de départ du jour = hébergement de la nuit précédente ; J1 = `trip.origin`.
2. Pour chaque étape dans l'ordre : trajet de la position courante vers le **départ** de l'étape.
3. Après une rando, la position courante = **arrivée** de la rando (`hike.end`). Pour une `point-to-point`, c'est l'arrivée, pas le parking de départ (voir alerte A5).
4. Dernier trajet : position courante → `nightPlaceId` ; dernier jour → `trip.destination`.
5. Trajets < 300 m à vol d'oiseau : ignorés (on considère qu'on marche).

---

## 5. Calculs

### 5.1 Statistiques GPX
- Distance : somme haversine des points de la trace (turf).
- **D+/D− avec lissage** : les GPX bruts surestiment le dénivelé. Appliquer un lissage (moyenne glissante sur la distance, puis seuil d'hystérésis de 5 m). Le seuil est une constante du module, couverte par un test.
- Profil : rééchantillonné à ≤ 500 points pour l'affichage.
- Type de rando : `loop` si départ et arrivée sont à moins de 150 m ; `out-and-back` si la trace revient sur elle-même (heuristique simple, modifiable à la main) ; sinon `point-to-point`.
- Si le GPX n'a pas d'altitude : stats d'altitude à `null`, avertissement affiché. Pas de MNT en V1.

### 5.2 Durée de marche (DIN 33466)
```
tH = distanceKm / flatKmh
tV = elevationGainM / ascentMPerH + elevationLossM / descentMPerH
durée = (max(tH, tV) + min(tH, tV) / 2) × breakFactor
```
Recalculée pour toutes les randos dès qu'un réglage `pace` change.

### 5.3 Totaux par jour
`hikingKm`, `elevationGainM`, `hikingMin`, `drivingKm`, `drivingMin`, `placesMin` (pauses), `activeMin = hikingMin + drivingMin + placesMin`, `estimatedEndTime = dayStartTime + activeMin`.

### 5.4 Alertes
| Code | Condition | Niveau |
| --- | --- | --- |
| A1 | Un total du jour dépasse un seuil défini | warning |
| A2 | Jour sans nuit définie (hors dernier jour) | info |
| A3 | Rando ou hébergement `dogPolicy = forbidden` alors que `withDog` | error |
| A4 | `dogPolicy = unknown` alors que `withDog` | warning (« à confirmer ») |
| A5 | Rando `point-to-point` : le véhicule reste au départ | warning, avec action « Convertir en aller-retour » (double la distance ; D+ et D− valent chacun D+ + D− de la traversée ; `out-and-back`) ou « Ajouter un trajet de récupération » (insère un stop `parking` au départ de la rando) |
| A6 | Rando placée dans la bibliothèque mais dans aucun jour | info |
| A7 | Trajet calculé en repli ligne droite (ORS indisponible) | warning |
| A8 | Hébergement `to-book` ou `idea` | info |
| A9 | Rando finie après le coucher du soleil, à son point de départ | warning |
| A10 | Voiture électrique : batterie sous la réserve de 15 % à l'arrivée d'un trajet (warning), ou vide avant l'arrivée (error). Une alerte par recharge manquante | warning / error |

Les alertes sont affichées sur la carte du jour (badge) et dans un panneau récapitulatif du voyage.

---

## 6. Routage (OpenRouteService)

- Endpoint Directions, profil `driving-car`, géométrie GeoJSON.
- Appel **par le serveur uniquement** (`POST /api/route` avec `{from, to}`).
- **Cache** clé = coordonnées arrondies à 4 décimales (`lat,lng→lat,lng`), stocké dans `trips/<slug>/cache/routes.json`. Pas d'expiration en V1, mais un bouton « Recalculer les trajets ».
- Debounce : recalcul seulement des segments modifiés, pas de tout le voyage.
- Erreur ou absence de clé : repli ligne droite × 1,3 à 70 km/h, `source: 'straight-line-fallback'`, alerte A7.
- Respecter le quota gratuit : limiter à 1 requête concurrente, retry exponentiel sur 429.

---

## 7. Écrans et interactions

Layout principal : **3 zones**, redimensionnables.

```
┌──────────────┬────────────────────────────┬──────────────────┐
│ Bibliothèque │            Carte           │  Planning jours  │
│ (randos,     │                            │  J1 ▸ stops      │
│  lieux)      │                            │  J2 ▸ stops      │
│              ├────────────────────────────┤  …               │
│              │  Profil altimétrique       │  Totaux, alertes │
└──────────────┴────────────────────────────┴──────────────────┘
```

### E1 — Liste des voyages (accueil)
- Cartes de voyage : nom, dates, nb de jours, km et D+ totaux, statut export Notion.
- Actions : créer, ouvrir, dupliquer, supprimer (avec confirmation, déplace dans `trips/.trash`).

### E2 — Création de voyage (dialog)
Nom, dates début/fin, lieu de départ (recherche d'adresse via ORS Geocoding ou clic carte), retour = départ par défaut, case « avec chien ».

### E3 — Vue voyage (layout principal)
> Implémentation actuelle (demande de David) : deux colonnes, planning et champs du voyage à gauche, carte fixe à droite avec un bouton « Actualiser ». Ce bouton est le « Recalculer les trajets » du §6. Le layout à 3 zones ci-dessus reste à arbitrer (question 17).

**Bibliothèque (gauche)**
- Zone de dépôt GPX (multi-fichiers). Après dépôt : dialog de confirmation avec nom pré-rempli (depuis le GPX), champ URL AllTrails, type de rando, politique chiens.
- Liste des randos : nom, distance, D+, durée estimée, badge « non planifiée », icône chien.
- Onglet Lieux : liste par type, bouton « + Lieu » (formulaire ou clic droit sur la carte « Ajouter un lieu ici »).
- Chaque élément est glissable vers un jour.

**Carte (centre)**
- Tracés colorés par jour (palette catégorielle accessible) ; randos non planifiées en gris pointillé ; replis en pointillé de la couleur du jour.
- Trajets voiture en trait fin distinct des randos.
- Marqueurs par type de lieu (icônes Lucide).
- Filtre : tout le voyage / un jour. Sélectionner un jour cadre la carte sur ce jour.
- Survol d'une rando → mise en avant + profil affiché ; survol du profil → point mobile sur la carte (synchronisation bidirectionnelle).

**Profil (bas du centre)**
- Profil de la rando sélectionnée, ou profil enchaîné des randos du jour sélectionné.
- Axe X km, axe Y altitude ; tooltip avec km, altitude, pente locale.

**Planning (droite)**
- Accordéon de jours. En-tête : J#, date, titre éditable, totaux compacts (km, D+, h marche, h route), badges d'alerte.
- Contenu : timeline verticale : 🛏️ départ → 🚗 trajet (dérivé, non déplaçable) → 🥾 rando → 🚗 → 📍 lieu → … → 🛏️ nuit.
- Glisser-déposer pour réordonner les étapes dans un jour et entre jours.
- Sélecteur « Nuit » (hébergements du voyage) et zone « Replis » repliable.
- Barre de charge par jour : barres horizontales marche / route vs seuil (si défini).

**Panneau Alertes** : liste filtrable des alertes du voyage ; clic → focus sur l'élément.

### E4 — Fiche rando (sheet latéral)
Stats complètes, profil, URL AllTrails (lien externe), type, politique chiens, notes, tags, bouton « Remplacer le GPX » (conserve id et planning), « Supprimer ».

### E5 — Réglages (dialog)
Rythme (4 champs DIN avec aperçu sur une rando exemple : « boucle 10 km, +800 m / −800 m → ≈ 5 h 30 » avec les valeurs par défaut), heure de départ type, seuils (tous vides par défaut, avec explication « aucune alerte tant que non défini »), fond de carte, état des clés (ORS, Notion : OK / manquante / invalide).

### E6 — Export Notion (dialog)
Voir §8.

### Exigences transverses UI
- shadcn/ui exclusivement pour les primitives ; pas d'autre librairie de composants.
- Raccourcis : `Ctrl/Cmd+S` sauvegarde forcée, `Ctrl/Cmd+Z` annuler (au moins 20 niveaux sur le planning).
- Sauvegarde automatique (debounce 1 s) + indicateur « Enregistré ».
- Français partout, formats FR (1 234,5 km ; 3 h 20).
- Utilisable dès 1280 px de large. Le mobile n'est pas une cible.

---

## 8. Export Notion

### Cible : structure existante du Life OS
- Les voyages sont des **pages de la base `Projects`** (data source `b8fc4785-…`), reliées à l'Area **Travel & Outdoors** via la relation `Area`.
- Propriétés du schéma `Projects` utilisées :
  - `Project` (title) ← `trip.name`
  - `Area` (relation) ← `NOTION_AREA_TRAVEL_PAGE_ID`
  - `Status` (select : Backlog / Active / On hold / Done / Archived) ← `Backlog` à la création, jamais modifié ensuite par l'outil
  - `Start date` (date, plage) ← `startDate` → `endDate`
  - `Outcome` (text) ← résumé généré : « N jours / N−1 nuits, X km, Y m D+, départ Z »
  - `Priority`, `Deadline`, `Tasks`, `Resources`, `Reviews` : **jamais touchés**

### Règle de non-écrasement (critique)
Les pages projet contiennent du contenu écrit à la main (objectif, réglementation, checklist…). **L'outil ne modifie jamais le contenu d'une page projet existante.** Il écrit exclusivement dans une **sous-page dédiée** qu'il possède :
`🗺️ Carnet d'itinéraire — généré par TrailPlanner`
À chaque export, le contenu de cette sous-page est entièrement remplacé.

### Flux
1. Dialog : « Créer un nouveau projet » ou « Lier à un projet existant » (recherche dans `Projects` filtrée sur Area = Travel & Outdoors).
2. Si création : crée la page projet (propriétés ci-dessus, icône 🏔️) + la sous-page.
3. Si lien : met à jour seulement `Start date` (avec confirmation) et crée ou remplace la sous-page.
4. Stocke `projectPageId` et `itineraryPageId` dans `trip.notion`. Les exports suivants réutilisent ces IDs sans redemander.
5. Aperçu Markdown du contenu avant envoi.

### Contenu de la sous-page (reprend le format déjà utilisé dans le Life OS)
1. Callout récap : dates, nb jours/nuits, km, D+, heures de marche et de route totales, date d'export.
2. **Tableau jour par jour** : `Jour | Secteur et marche | Distance / dénivelé | Route | Nuit | Statut`
   - Statut = alertes du jour résumées (« Chien à confirmer », « Hébergement à réserver », « OK »).
3. Une section `## J1 — titre` par jour : timeline (trajets avec durée, randos avec stats et lien AllTrails), nuit (lien, statut de réservation), replis.
4. `## Hébergements` : tableau nom / nuits / prix / statut / chiens / lien.
5. `## Points à vérifier` : to-do Notion générés à partir des alertes warning/error.
6. Pied : « Généré automatiquement par TrailPlanner — ne pas éditer cette page, elle est remplacée à chaque export. »

### Technique
- `@notionhq/client` avec la version d'API qui supporte les data sources (parent = `data_source_id`). Vérifier la version courante dans la doc Notion.
- L'intégration doit être partagée avec la base `Projects` : afficher un message d'aide clair en cas d'erreur 404/403.
- Respecter la limite de blocs par requête (découper par lots de 100) et le rate limit (retry sur 429).

---

## 9. API locale (Hono)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/trips` | liste (résumés) |
| POST | `/api/trips` | créer |
| GET | `/api/trips/:slug` | voyage complet |
| PUT | `/api/trips/:slug` | sauvegarder (validation zod, écriture atomique) |
| DELETE | `/api/trips/:slug` | déplacer en corbeille |
| POST | `/api/trips/:slug/gpx` | upload multipart → parse → renvoie `Hike` prérempli |
| GET | `/api/trips/:slug/gpx/:hikeId` | GeoJSON de la trace |
| POST | `/api/route` | trajet ORS (avec cache) |
| GET | `/api/geocode?q=` | géocodage ORS |
| GET | `/api/trips/:slug/charging?minKw=` | bornes le long des trajets et autour des étapes |
| POST | `/api/trips/:slug/assistant` | tour de conversation de l'assistant, en NDJSON |
| GET | `/api/trips/:slug/weather` | météo par jour (Open-Meteo, 16 jours) |
| GET | `/api/trips/:slug/poi` | eau, refuges, campings, parkings autour des randos (Overpass) |
| POST | `/api/map-link` | position d'un lien Google Maps (lien lu tel quel, lien court suivi par redirection, jamais de lecture de page) |
| GET/PUT | `/api/settings` | réglages |
| GET | `/api/health` | état des clés ORS / Notion |
| POST | `/api/trips/:slug/notion/preview` | Markdown de l'export |
| POST | `/api/trips/:slug/notion/export` | export |
| GET | `/api/notion/projects?q=` | recherche projets Travel & Outdoors |

Le serveur écoute **uniquement sur 127.0.0.1**.

---

## 10. User stories et critères d'acceptation

**US1 — Importer des randos.** En tant qu'utilisateur, je dépose un ou plusieurs GPX exportés d'AllTrails pour les ajouter à mon voyage.
- [ ] Dépôt multi-fichiers ; un fichier invalide n'empêche pas les autres et affiche une erreur nommée.
- [ ] Distance à ±2 % de celle affichée par AllTrails sur les 3 GPX de `fixtures/`.
- [ ] D+ à ±10 % de celui affiché par AllTrails sur les mêmes fixtures (valeurs de référence dans `fixtures/README.md`).
- [ ] Le GPX original est copié tel quel dans `gpx/`.

**US2 — Voir mes randos.** Je vois toutes les randos sur la carte et le profil de celle que je survole.
- [ ] Synchronisation survol profil ↔ carte < 50 ms perçus.
- [ ] Fond IGN par défaut, bascule OSM.

**US3 — Planifier les jours.** Je glisse des randos et des lieux dans les jours et je vois les totaux se mettre à jour.
- [ ] Jours générés automatiquement depuis les dates ; changer les dates ajoute ou retire des jours (les étapes des jours retirés retournent dans la bibliothèque, après confirmation).
- [ ] Réordonner les étapes recalcule les trajets concernés seulement.
- [ ] Annuler/rétablir fonctionne sur le planning.

**US4 — Connaître les temps de route.** Je vois automatiquement le temps de route entre chaque étape.
- [ ] Trajets dérivés selon les règles §4.
- [ ] Un 2e affichage du même trajet ne refait pas d'appel ORS (cache).
- [ ] Sans clé ORS : repli + alerte A7, l'app reste utilisable.

**US5 — Gérer la logistique.** J'ajoute des hébergements, bornes de recharge et autres lieux, et j'assigne une nuit à chaque jour.
- [ ] Ajout par formulaire ou clic droit carte.
- [ ] Statut de réservation visible dans le planning.

**US6 — Voyager avec mon chien.** Quand le voyage est marqué « avec chien », je suis alerté de toute rando ou hébergement interdit ou non confirmé.
- [ ] Alertes A3/A4 conformes.

**US7 — Repérer les traversées.** Je suis averti quand une rando ne revient pas à la voiture et je peux corriger en un clic.
- [ ] Alerte A5 et ses deux actions.

**US8 — Régler mon rythme et mes seuils.**
- [ ] Modifier le rythme recalcule toutes les durées.
- [ ] Aucune alerte de seuil tant qu'aucun seuil n'est défini.

**US9 — Exporter vers Notion.**
- [ ] Création d'un projet dans `Projects` relié à Travel & Outdoors, avec la sous-page carnet.
- [ ] Lien à un projet existant sans modifier son contenu (test e2e sur une page de test).
- [ ] Ré-export : la sous-page est remplacée, pas dupliquée.

---

## 11. Jalons (une PR par jalon)

| # | Jalon | Contenu | Démo de fin |
| --- | --- | --- | --- |
| M0 | Socle | Repo, Vite+React+shadcn+Tailwind, Hono, zod partagé, `npm run dev`, CRUD voyage sur disque, E1/E2 | Créer un voyage, le retrouver après redémarrage |
| M1 | GPX & carte | Import GPX, stats (lissage D+), carte IGN, bibliothèque, fiche rando, profil synchronisé | 3 GPX importés, stats conformes aux fixtures |
| M2 | Planning | Jours, stops, dnd-kit, totaux, DIN, réglages, annuler/rétablir | Un voyage de 5 jours planifié avec totaux |
| M3 | Routage | ORS, cache, géocodage, trajets dérivés, repli | Temps de route affichés entre toutes les étapes |
| M4 | Logistique & alertes | Lieux, nuits, politique chiens, A1–A8, panneau alertes | Toutes les alertes déclenchables sur un voyage de test |
| M5 | Export Notion | Preview, création, lien, sous-page, ré-export | Voyage exporté dans le Life OS |

Chaque jalon : tests unitaires des calculs touchés, lint et typecheck verts, README mis à jour.

---

## 12. Questions ouvertes (à valider avec David, ne pas trancher seul)
1. ~~Nom définitif de l'outil.~~ Tranché par David : TrailPlanner.
2. Fournir 3 GPX AllTrails de référence + leurs valeurs affichées (distance, D+) pour `fixtures/`.
3. Faut-il aussi relier les randos à la base `Resources` du Life OS ? (Supposé : non en V1.)

Relevées pendant M0, avec le choix provisoire appliqué en attendant la réponse :

4. Départ retiré de E2 à la demande de David : `origin` et `destination` deviennent optionnels. Ils se saisissent désormais dans la page du voyage (question 29).
5. E1 demande « dupliquer » mais §9 ne liste aucune route. (Provisoire : `POST /api/trips/:slug/duplicate` ajoutée ; la copie reprend GPX et cache mais pas le lien Notion, pour ne pas écraser le carnet de l'original.)
6. `HikeStats` type les altitudes en `number` alors que §5.1 les veut à `null` sans altitude. (Provisoire : champs d'altitude et de dénivelé `nullable`, `profile[].altM` compris.)
7. `Place.type` n'a pas de valeur pour `origin` / `destination`. Sans objet tant que le départ n'est pas saisi.
8. `settings.json` : le schéma de stockage du §4 le place au même niveau que `trips/`, donc à la racine du projet. Faut-il le ranger plutôt dans `trips/`, déjà gitignoré ? (Provisoire : `settings.json` à la racine, gitignoré, chemin modifiable par `SETTINGS_FILE`.)
9. ~~Récupérer le bouton « Get directions » d'AllTrails ?~~ Tranché par David : pas de scraping, le lien d'itinéraire est généré depuis le premier point du GPX.
10. Une étape peut-elle exister avec un lien AllTrails mais sans GPX encore ? `Hike.gpxFile` est obligatoire. (Provisoire : GPX obligatoire.)
11. §5.1 teste `loop` avant `out-and-back`, mais un aller-retour revient au départ et serait toujours classé `loop`. (Provisoire : le test de retour sur la trace passe en premier.)
12. Géocodage : §3 et §9 prévoient ORS, qui demande une clé. David veut une autocomplétion sans clé à gérer. (Provisoire : `GET /api/geocode` passe par la Géoplateforme IGN, sans clé mais limitée à la France. Pour un voyage à l'étranger, il faudrait un autre service.)
13. Étape de séjour et séjour d'une rando (`Stop.stayPlaceId`) : ajoutés à la demande de David, ils recoupent `Day.nightPlaceId`. (Provisoire : la nuit d'un jour est le sélecteur « Nuit » s'il est rempli, sinon le dernier séjour du jour ; A2 suit cette règle.)
14. Itinéraire global : §9 prévoit `POST /api/route` `{from, to}`, sans slug alors que le cache est par voyage. (Provisoire : `POST /api/trips/:slug/itinerary` calcule tous les trajets du voyage, un à la fois.)
15. Routage : §6 prévoit ORS, avec clé. (Provisoire : ORS si `ORS_API_KEY` existe, sinon calcul d'itinéraire de la Géoplateforme IGN, sans clé mais limité à la France ; repli ligne droite si le service échoue.)
16. ~~Compter un trajet jusqu'à un départ différent du séjour précédent ?~~ Tranché par David : non, l'itinéraire repart de ce lieu (`Stop.departurePlaceId`, par défaut le séjour de l'étape précédente).
17. Layout E3 : les 3 zones du §7 (bibliothèque, carte, planning) sont-elles encore la cible, ou les 2 colonnes actuelles les remplacent-elles ? (Provisoire : 2 colonnes.)
18. Sauvegarde : §7 demande un debounce de 1 s. (Provisoire : chaque action enregistre tout de suite, les champs texte quand on les quitte, ce qui rend le debounce inutile.)
19. ~~État « invalide » des clés en E5.~~ Fait : vérifié une fois par démarrage du serveur ; pour ORS, cela consomme une requête du quota.
20. ~~D+ d'une traversée convertie en aller-retour ?~~ Tranché par David : D+ et D− valent chacun D+ + D− de la traversée, reporté au §5.4.
21. A3/A4 : portent sur les randos planifiées (replis compris) et les hébergements utilisés. Faut-il aussi alerter sur ce qui est seulement en bibliothèque ? (Provisoire : non, A6 et A8 le signalent déjà.)
22. Couleur du trajet : demande de David, comprise comme le trajet voiture allant d'une rando à un hébergement (violet sur la carte, repère violet dans les listes). À confirmer.

Mesure US2 (2 novembre 2026, sur un voyage réel) : survol du profil → point sur la carte en 12 ms en médiane, 27 ms au maximum sur 40 mesures.
23. Voiture électrique (`travelers.electricVehicle`) : ajoutée à la demande de David. Les bornes viennent de la base nationale IRVE, dans un couloir d'environ 5 km autour des trajets et des étapes, filtrées par puissance. Tranché par David : pas de planification selon l'autonomie, les bornes se choisissent à la main et s'insèrent dans le planning avec leur pause.
24. Météo : donnée au départ de la première rando du jour, à son altitude maximale (scénario le plus froid). Aucune alerte n'en découle, faute de seuils. Faut-il en définir ? (Provisoire : non.)
25. Budget : péages et recharge se saisissent à la main, faute de source fiable sans clé. Un refuge ou camping ajouté depuis OpenStreetMap devient un lieu de type `lodging`, un point d'eau un `poi`.
26. Assistant de voyage : Claude Opus 5.5 via `ANTHROPIC_API_KEY`, côté serveur. Il ne peut que simuler et proposer des opérations limitées (`shared/assistant-ops.ts`) ; rien ne s'applique sans clic, et tout s'annule. Les conversations vivent en mémoire et disparaissent au redémarrage. Faut-il les conserver ? (Provisoire : non.)
27. Second fournisseur pour l'assistant : OpenAI, via `OPENAI_API_KEY` et `OPENAI_MODEL`, sans modèle par défaut. Choix dans les Réglages quand deux sont configurés ; changer de fournisseur repart d'une conversation vide. Le coût n'est pas calculé pour OpenAI, faute de tarif fiable par modèle.
28. Couches de carte : fond (Plan IGN, photos aériennes, OpenStreetMap) atténuable, couches IGN superposables (relief, pentes, courbes, eau, routes, traces hivernales) et éléments du voyage masquables. Réglages globaux, communs à tous les voyages. Faut-il des réglages par voyage ? (Provisoire : non.)
29. Départ et arrivée : champs du voyage (`origin`, `destination`), avec « Arrivée identique au départ » coché par défaut. Le départ s'affiche au J1 et n'est pas une étape de séjour. Un `departurePlaceId` sur la première étape reste possible et prime sur `origin`.
30. Réseaux de recharge favoris : IONITY, Izivia, Mobilize, Sowatt, Le Plein et Electra, tirés de la liste Google Maps de David. Electra, absent de la base IRVE, vient d'Open Charge Map (`OPENCHARGEMAP_API_KEY`). Plug Inn n'est ni dans IRVE ni dans Open Charge Map : ses bornes s'ajoutent par lien Google Maps. « Le Plein » ne correspond dans la base qu'à « Le Plein Tarnais » : à confirmer.
31. Bornes favorites : étoile par borne, ou ajout par lien Google Maps (pour Plug Inn et Electra), conservées dans `settings.json`, donc communes à tous les voyages et affichées partout sur la carte en voiture électrique. Elles passent devant les réseaux favoris.
32. Autonomie : le voyage porte `vehicle` (batterie, niveau au départ, consommation), et l'hébergement `chargesOvernight`. Hypothèses : consommation fixe, 22 kWh/100 km par défaut, sans dénivelé ni froid ; retour à 80 % à chaque borne du planning quelle que soit la pause ; réserve de 15 %. Faut-il tenir compte de la pause et de la puissance ? (Provisoire : non.)
33. Bibliothèque de randos : `trips/.library/` (`library.json`, `gpx/`), routes `/api/library…`. Un voyage reçoit une copie de la fiche et du GPX, reliée par l'empreinte SHA-256 du fichier, plutôt qu'une référence : il reste autonome, et supprimer une rando de la bibliothèque ne le casse pas. Les modifications ne se propagent donc pas entre voyage et bibliothèque. Faut-il proposer une synchronisation ? (Provisoire : non.)
34. Rythme réel : la comparaison porte sur toutes les sorties chronométrées, sans distinguer dénivelé, saison ou chien, et ajuste seulement `breakFactor`, à partir de 3 sorties et sur clic. Faut-il affiner vitesse et dénivelé séparément ? (Provisoire : non.)
