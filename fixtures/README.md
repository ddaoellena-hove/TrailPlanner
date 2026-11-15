# Fixtures

## Sorties enregistrées (`recordings/`)

Exports GPX réels d'AllTrails (activité enregistrée, pas l'itinéraire), copiés sans modification. Les valeurs « AllTrails » sont celles affichées par l'application pour la sortie.

| Fichier | Date | AllTrails : distance | AllTrails : D+ | AllTrails : temps total | AllTrails : temps en mouvement |
| --- | --- | --- | --- | --- | --- |
| `sur-les-traces-de-voltaire.gpx` | 14 novembre 2026 | 6,81 km | 85 m | 1 h 25 | 1 h 24 |

Tolérances vérifiées par `server/recordings.test.ts` : distance ±2 %, D+ ±10 %, temps total à la minute près. TrailPlanner ne calcule pas le temps en mouvement.

## Itinéraires (US1)

Encore à fournir : 3 GPX d'itinéraires AllTrails et leurs valeurs affichées (SPEC §12, question 2).
