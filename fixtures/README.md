# Fixtures

## Sorties enregistrées (`recordings/`)

Exports GPX réels d'AllTrails (activité enregistrée, pas l'itinéraire), copiés sans modification. Les valeurs « AllTrails » sont celles affichées par l'application pour la sortie.

| Fichier | Date | AllTrails : distance | AllTrails : D+ | AllTrails : temps total | AllTrails : temps en mouvement |
| --- | --- | --- | --- | --- | --- |
| `sur-les-traces-de-voltaire.gpx` | 14 novembre 2026 | 6,81 km | 85 m | 1 h 25 | 1 h 24 |
| `vallee-du-crevon.gpx` | 15 novembre 2026 | 7,65 km | 169 m | 1 h 36 | 1 h 36 |

Tolérances vérifiées par `server/recordings.test.ts` : distance ±2 %, D+ ±10 %, temps total à la minute près. Itinera ne calcule pas le temps en mouvement.

Valeurs calculées par Itinera (seuil de dénivelé de 2 m des sorties enregistrées) : Voltaire 6,80 km, +87 m, 1 h 25 ; Vallée du Crevon 7,64 km, +162 m, 1 h 36. Deux sorties de plaine en Normandie : une sortie de montagne reste à ajouter.

## Itinéraires (US1)

Encore à fournir : 3 GPX d'itinéraires AllTrails et leurs valeurs affichées (SPEC §12, question 2).
