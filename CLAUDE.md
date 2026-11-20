# CLAUDE.md — Itinera

Outil local de planification de road trips rando à partir de GPX AllTrails.
**La spec fonctionnelle complète est dans `SPEC.md` : la lire avant toute tâche.**

## Commandes
- `npm run dev` : front (5175) + API (5174)
- `npm run test` : Vitest
- `npm run e2e` : Playwright
- `npm run lint` / `npm run typecheck`

## Structure
```
src/            front React (shadcn/ui dans src/components/ui)
server/         API Hono (seule couche qui touche disque, ORS et le vault Obsidian)
shared/         schémas zod + fonctions de calcul pures (stats GPX, DIN, dérivation des trajets, alertes)
fixtures/       GPX de référence + valeurs attendues
trips/          données utilisateur (gitignored)
```

## Règles
- TypeScript strict, pas de `any`. Schémas zod dans `shared/schema.ts` = source unique des types.
- Tous les calculs (stats, durées, trajets dérivés, alertes) sont des **fonctions pures dans `shared/`**, testées unitairement.
- Les clés API (ORS, assistant, Open Charge Map) ne quittent jamais le serveur. Le serveur écoute sur 127.0.0.1 uniquement.
- UI : shadcn/ui + Tailwind uniquement, icônes Lucide. Interface en français, formats FR.
- Jamais de scraping AllTrails ni d'appel à son API interne.
- Export Obsidian : ne jamais modifier le contenu d'une note projet existante dans `Projects/`, seulement le sous-fichier `Projects/<Projet>/🗺️ Carnet d'itinéraire — généré par Itinera.md` (voir SPEC §8) ; pour les sorties dans `Sport/`, préserver la section `## Ressenti` et ne jamais écraser une note tierce (Garmin/manuelle).
- Écritures disque atomiques ; ne jamais modifier un GPX original.
- Un jalon (SPEC §11) = une branche + une PR. Lint, typecheck et tests verts avant PR.
- En cas d'ambiguïté fonctionnelle : poser la question plutôt que supposer. Ajouter la question à SPEC §12.
