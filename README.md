# Trailplan

Planificateur local de road trips rando à partir de GPX AllTrails. La spec fonctionnelle est dans [SPEC.md](SPEC.md), les règles de développement dans [CLAUDE.md](CLAUDE.md).

## Démarrer

```bash
npm install
cp .env.example .env
npm run dev
```

Le front est sur http://127.0.0.1:5173, l'API sur le port 5174. L'app fonctionne sans clé ORS ni Notion ; sans clé ORS, le routage passe par la Géoplateforme IGN (France uniquement). Les voyages sont stockés dans `trips/` (ou `TRIPS_DIR`).

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | front + API |
| `npm run test` | tests unitaires et API (Vitest) |
| `npm run e2e` | parcours Playwright (ports 5183 et 5184, voyages dans `.e2e-trips/`) ; la première fois : `npx playwright install chromium` |
| `npm run lint` / `npm run typecheck` | contrôles statiques |

## Choix techniques

- **État front : TanStack Query.** Jusqu'ici tout l'état est côté serveur (fichiers sur disque), ce que Query gère directement : cache, invalidation, états de chargement. L'historique annuler/rétablir du planning (M2) pourra s'y ajouter avec un store local.
- **Protection de l'API :** en plus de l'écoute sur 127.0.0.1, le serveur refuse les requêtes dont `Host` ou `Origin` n'est pas local, car un site ouvert dans le navigateur peut viser cette adresse.

## Avancement

- [x] M0 — Socle : CRUD voyage sur disque, accueil (E1), création (E2)
- [ ] M1 — GPX & carte (reste : validation sur les 3 GPX de référence de `fixtures/`)
- [x] M2 — Planning
- [x] M3 — Routage (essai avec une vraie clé ORS à faire si l'option est gardée)
- [x] M4 — Logistique & alertes
- [ ] M5 — Export Notion (fait, testé avec un Notion simulé ; reste : essai réel avec `NOTION_TOKEN` et critère e2e d'US9 sur une page de test)
