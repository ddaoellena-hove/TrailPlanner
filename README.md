# TrailPlanner

Outil local et mono-utilisateur pour préparer un road trip de plusieurs jours mêlant voiture et randonnées, à partir de GPX AllTrails. Il calcule la charge de chaque journée, signale ce qui ne tient pas et exporte un carnet dans le Life OS Notion.

- [SPEC.md](SPEC.md) : spec fonctionnelle, source de vérité. Son §12 liste les décisions prises et les questions ouvertes.
- [CLAUDE.md](CLAUDE.md) : règles de développement.

## Démarrer

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

Le front est sur http://127.0.0.1:5173 et l'API sur le port 5174. L'app fonctionne sans aucune clé : seul l'export Notion est alors désactivé.

| Variable | Rôle |
| --- | --- |
| `NOTION_TOKEN` | intégration interne Notion, à partager avec la base `Projects` |
| `NOTION_PROJECTS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATABASE_ID`, `NOTION_AREA_TRAVEL_PAGE_ID` | cibles du Life OS, préremplies dans `.env.example` |
| `ORS_API_KEY` | optionnelle : remplace l'IGN pour le routage |
| `ANTHROPIC_API_KEY` | optionnelle : active l'assistant avec Claude, payant à l'usage |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | optionnelles : active l'assistant avec ChatGPT ; les deux sont nécessaires |
| `TRIPS_DIR` | dossier des voyages, `./trips` par défaut |
| `SETTINGS_FILE` | fichier des réglages, `./settings.json` par défaut |

`.env`, `trips/` et `settings.json` sont ignorés par Git.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | front + API |
| `npm run test` | tests unitaires et API (Vitest) |
| `npm run e2e` | parcours Playwright, sur les ports 5183 et 5184 ; la première fois : `npx playwright install chromium` |
| `npm run lint` / `npm run typecheck` | contrôles statiques |
| `npm run build` | build du front |

L'e2e écrit dans `.e2e-trips/` et neutralise `NOTION_TOKEN`, `ORS_API_KEY`, `ANTHROPIC_API_KEY` et `OPENAI_API_KEY` : il peut tourner à côté de `npm run dev` et ne touche jamais aux vrais services à clé. Il passe en revanche par l'IGN pour les trajets, donc il demande du réseau.

## Fonctionnalités

- **Voyages :** création, duplication, corbeille dans `trips/.trash`. Nom, dates, chien, voiture électrique, départ et arrivée se modifient directement dans la page.
- **Randos :** import de plusieurs GPX, fiche complète, remplacement du tracé sans perdre le planning. Le GPX original n'est jamais modifié.
- **Planning :** étapes glissées dans un jour ou entre jours, trajets calculés dans la timeline, nuits, replis, notes, totaux et charge par jour. Annuler/rétablir sur 50 niveaux, `Ctrl/Cmd+S`.
- **Étapes :** avec trail, ou de séjour avec autocomplétion d'adresse. Chacune a un départ, par défaut le séjour précédent, et un séjour avec lien.
- **Carte :** fond Plan IGN, photos aériennes ou OpenStreetMap, atténuable, couches de terrain à superposer (relief, pentes, courbes, eau, routes, traces hivernales), éléments du voyage masquables, tracés colorés par jour, filtre par jour, trajet du trail à l'hôtel en violet, profil altimétrique synchronisé, ajout d'un lieu au clic droit.
- **Lieux :** séjour, recharge, ravitaillement, parking, point d'intérêt. Ajout par adresse, par clic sur la carte ou par lien Google Maps.
- **Voiture électrique :** bornes le long des trajets et autour des étapes, insérées dans le planning avec leur pause.
- **Lumière et météo :** lever et coucher du soleil, heure de départ par rando, prévisions à 16 jours.
- **Points utiles :** eau, refuges, campings et parkings autour des randos.
- **Préparation :** budget par poste et checklist adaptée au voyage.
- **Alertes A1 à A9 :** panneau filtrable, badges par jour, correction en un clic des traversées, politique chiens modifiable en lot.
- **Assistant IA (optionnel) :** discussion sur le voyage, qui simule et propose des changements avec leur effet avant/après. Rien ne s'applique sans clic.
- **Export Notion :** projet créé ou lié, sous-page carnet remplacée à chaque export, aperçu avant envoi.

## Structure

```
src/        front React : pages/, components/ (ui/ = shadcn), lib/ (api, hooks, libellés)
server/     API Hono, seule couche qui touche le disque et les services externes
shared/     schémas zod et fonctions de calcul pures, testées unitairement
e2e/        parcours Playwright
fixtures/   GPX de référence, vide tant que la validation d'US1 n'est pas faite
trips/      données utilisateur
```

| Sujet | Fichiers |
| --- | --- |
| Modèle de données | `shared/schema.ts` |
| Stockage | `server/trip-store.ts`, `server/settings-store.ts` |
| Routes | `server/app.ts` |
| Trajets | `shared/itinerary.ts`, `server/routing.ts` |
| Horaires et soleil | `shared/schedule.ts`, `shared/sun.ts`, `shared/totals.ts` |
| Alertes | `shared/alerts.ts` |
| Carnet et export | `shared/carnet.ts`, `server/notion.ts` |
| Vue voyage | `src/pages/TripPage.tsx` |
| Assistant | `shared/assistant-ops.ts`, `shared/plan-impact.ts`, `server/assistant.ts`, et par fournisseur `server/assistant-anthropic.ts`, `server/assistant-openai.ts` |

Chaque voyage vit dans `trips/<slug>/` : `trip.json` lisible et diffable, `gpx/` pour les fichiers originaux, `cache/` pour les trajets et les points utiles. Les champs ajoutés après M0 sont optionnels, les anciens voyages restent lisibles sans migration.

## Services externes

| Service | Usage | Clé | Limite |
| --- | --- | --- | --- |
| Géoplateforme IGN | fond de carte, géocodage, routage | non | France uniquement |
| OpenRouteService | routage, si `ORS_API_KEY` existe | oui | jamais essayé avec une vraie clé |
| Base nationale IRVE (data.gouv.fr) | bornes de recharge | non | France, données déclarées par les opérateurs, pas de disponibilité en temps réel |
| Open-Meteo | météo | non | 16 jours |
| Overpass (OpenStreetMap) | points utiles | non | serveurs publics souvent saturés |
| Notion | export | oui | écrit uniquement côté serveur |
| API Anthropic ou OpenAI | assistant | oui | payante, reçoit le contenu du voyage à chaque message |

Si le routage échoue, le trajet est estimé en ligne droite (× 1,3 à 70 km/h) et signalé par l'alerte A7.

## Décisions à connaître

- **Pas de scraping AllTrails**, confirmé deux fois. Le lien d'itinéraire vient du premier point du GPX, et la politique chiens se saisit à la main.
- **Lien Google Maps :** la position se lit dans l'adresse, et un lien court est suivi par sa redirection, uniquement vers des domaines Google. Aucune page n'est lue.
- **Départ d'une étape :** s'il diffère du séjour précédent, l'itinéraire repart de ce lieu, sans trajet compté pour le rejoindre.
- **Nuit d'un jour :** le sélecteur s'il est rempli, sinon le dernier séjour du jour.
- **Aller-retour converti :** D+ et D− valent chacun D+ + D− de la traversée.
- **Recharge :** les bornes se choisissent à la main, sans calcul selon l'autonomie.
- **Sauvegarde :** immédiate, ou à la sortie du champ pour le texte, à la place du délai d'une seconde de la SPEC.
- **Notion :** le contenu d'une page projet n'est jamais modifié. Seule une sous-page du titre exact du carnet est vidée, et le lien Notion ne passe pas par les sauvegardes du front, pour survivre à un « annuler ».
- **État front : TanStack Query.** L'état vit côté serveur ; la mise à jour est optimiste et les sauvegardes sont sérialisées.
- **Assistant :** il n'a aucun outil d'écriture. Il simule et propose des opérations limitées, revalidées à l'application et annulables. Les données du voyage lui sont présentées comme des informations, jamais comme des consignes.
- **Protection de l'API :** en plus de l'écoute sur 127.0.0.1, le serveur refuse les requêtes dont `Host` ou `Origin` n'est pas local, car un site ouvert dans le navigateur peut viser cette adresse.

## Pièges

- **Identifiant IRVE :** data.gouv.fr remplace le fichier national. Il faut partir de la fiche du jeu de données et ne jamais écrire l'identifiant du fichier en dur (`server/charging.ts`).
- **Services simulés :** les tests ne voient pas les changements réels d'un service. Après une modification, vérifier sur de vraies données, avec une copie de `trips/` et `TRIPS_DIR` sur une autre instance.
- **MapLibre :** il doit rester exclu du pré-bundling Vite (`vite.config.ts`), sinon son worker ne se charge pas.
- **Simulations de routes dans l'e2e :** cibler `**/api/trips/*/…`. Un motif trop large intercepte les modules source du même nom, comme `shared/charging.ts`, et donne une page blanche.
- **`next-themes` :** affiche en dev une erreur console « Encountered a script tag… », sans effet sur l'app.

## Avancement

- [x] M0 — Socle
- [ ] M1 — GPX & carte (reste : validation sur 3 GPX de référence dans `fixtures/`)
- [x] M2 — Planning
- [x] M3 — Routage
- [x] M4 — Logistique & alertes
- [ ] M5 — Export Notion (testé avec un Notion simulé ; reste à confirmer le critère d'US9 sur une page de test)

**Ajouts hors jalons :** mode électrique, bornes, liens Google Maps, soleil et horaires, météo, points utiles, budget, checklist, assistant IA.

**Reste à vérifier :** les points utiles sur de vraies données Overpass, les liens courts Google Maps réels, ORS avec une vraie clé, l'assistant avec une vraie clé, pour chaque fournisseur.

**Git :** pas encore de dépôt distant. Le travail est sur la branche locale `rattrapage-m0-m5`, ce qui déroge à la règle « une PR par jalon » de CLAUDE.md.
