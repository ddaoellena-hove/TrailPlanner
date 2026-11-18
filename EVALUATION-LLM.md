# Évaluation du LLM auditeur — résumé

Deux audits de PlanTrails (`AUDIT.MD`) vérifiés contre le code le 2026-11-04.
**Verdict : non fiable, ne pas lui confier de tâches de code autonomes.**

## Problèmes de fond

1. **N'ouvre pas les fichiers.** Il raisonne à partir des noms de fichiers et de CLAUDE.md, pas du code. Il l'admet lui-même (« Aucun code n'a été vérifié », « hypothétique », « contenu inconnu »).
2. **Présente des suppositions comme des faits.** Des affirmations fausses sont étiquetées « ✅ Confirmé ».
3. **Déduit qu'une chose est absente parce qu'il ne l'a pas vue.** Il conclut à l'absence de tests, de gestion d'erreurs ou de config stricte alors que tout existe.
4. **Répète ses erreurs d'un audit à l'autre.** Le gestionnaire d'erreurs global est déclaré manquant deux fois.
5. **Ses recommandations sont nuisibles.** Les appliquer aurait dupliqué de l'existant ou cassé une séparation voulue par la spec.

## Erreurs constatées

| Affirmation | Réalité |
|---|---|
| Pas de gestionnaire d'erreurs HTTP global (×2) | `app.onError` existe dans `server/app.ts:87` |
| Aucun test unitaire dans `shared/` | 9 fichiers de test dans `shared/`, 15 au total ; Vitest configuré dans `vite.config.ts` |
| `shared/itinerary.test.ts` vide (« Confirmé ») | 211 lignes, 17 tests |
| tsconfig dupliqués ou incohérents | Un seul `tsconfig.json`, commun à tout le projet |
| Activer TS strict dans `shared/` | `strict: true` déjà actif ; aucun `any` |
| Duplication entre `shared/gpx.ts` et `server/gpx.ts` (« Priorité 1 ») | `server/gpx.ts` importe les calculs de `shared/gpx`, séparation conforme à CLAUDE.md |
| `@dnd-kit/core` = dépendance backend | Librairie React de glisser-déposer, côté front |

## Seul point exploitable

Plusieurs modules de `shared/` n'ont pas de fichier de test dédié : `budget`, `charging`, `schedule`, `totals`, `sun`, etc. Il reste à vérifier s'ils sont couverts indirectement par d'autres tests.

## S'il est réutilisé malgré tout

- Exiger que chaque affirmation cite un fichier et une ligne qu'il a réellement lus.
- Lui donner uniquement des tâches petites et bien délimitées.
- N'accepter un changement qu'après `npm run lint && npm run typecheck && npm run test`, et après relecture du diff.
