# Audit Technique de PlanTrails

## 1. Architecture et dépendances principales

**Architecture :**
- **Frontend** : Application React avec shadcn/ui et Tailwind CSS (dossiers `src/components/`).
- **Backend** : API Hono (dossier `server/`) gérant les routes, l'ORS, la Notion, et les calculs GPX.
- **Partagé** : Schémas Zod, fonctions pures de calcul (dossier `shared/`).
- **Données** : GPX de référence dans `fixtures/`, données utilisateur dans `trips/` (ignoré par git).

**Dépendances principales :**
- **Frontend** : `react`, `react-dom`, `maplibre-gl`, `react-map-gl`, `lucide-react`, `tailwindcss`.
- **Backend** : `hono`, `@notionhq/client`, `@anthropic-ai/sdk`, `@dnd-kit/core`.
- **Outils** : `zod` (pour la validation), `vitest` (tests unitaires), `playwright` (tests E2E).

## 2. Duplications et incohérences potentielles

- **Possible duplication de code** : 
  - Les fichiers `shared/gpx.ts` et `server/gpx.ts` pourraient contenir des logiques similaires (parsing, validation GPX). Si ces deux fichiers gèrent le même ensemble de fonctionnalités, cela pourrait être une duplication.
  - **Fichier justificatif** : `shared/gpx.ts`, `server/gpx.ts`.

- **Incohérence de gestion des erreurs** :
  - Le backend utilise des middleware Hono, mais il n'est pas clair si toutes les routes retournent des erreurs uniformément typées (ex. `ZodError`, `NotionError`, etc.). 
  - **Fichier justificatif** : `server/health.ts`, `server/geocode.ts`.

- **Absence de tests dans `shared/`** :
  - Bien que `shared/` contienne des fonctions pures (ex. `shared/itinerary.ts`), les tests associés (`shared/itinerary.test.ts`) sont absents ou incomplets. 
  - **Fichier justificatif** : `shared/itinerary.test.ts`.

---

## 3. Améliorations concrètes (priorité descendante)

### 💡 Priorité haute : Désigner un `TypeScript strict` dans `shared/`
- **Problème** : Les schémas Zod (`shared/schema.ts`) définissent les types, mais il n'y a pas de vérification stricte dans les fichiers `shared/` (ex. `shared/charging.ts`) pour s'assurer que les fonctions respectent les types.
- **Solution** : Activer le mode strict TypeScript pour les fichiers `shared/` et corriger les incohérences.
- **Fichier justificatif** : `shared/charging.ts`, `shared/schema.ts`.

---

### 💡 Priorité moyenne : Gestion centralisée des erreurs API
- **Problème** : Les routes backend (ex. `server/health.ts`, `server/geocode.ts`) gèrent les erreurs de manière non unifiée. Pas de `errorBoundary` ou de `global error handler` dans Hono.
- **Solution** : Créer un fichier `server/error-handler.ts` pour centraliser la gestion des erreurs avec des types Zod.
- **Fichier justificatif** : `server/health.ts`, `server/geocode.ts`.

---

### 💡 Priorité basse : Ajouter des tests dans `shared/`
- **Problème** : Les fichiers `shared/itinerary.ts`, `shared/budget.ts` contiennent des logiques critiques sans tests unitaires associés (`shared/itinerary.test.ts` existe mais est vide).
- **Solution** : Implémenter des tests pour les fonctions pures de `shared/` avec Vitest.
- **Fichier justificatif** : `shared/itinerary.test.ts`, `shared/budget.ts`.

---

## 4. État des constats

| Problème | Confirmé / Hypothèse | Justification |
|---------|---------------------|-------------|
| Duplication entre `shared/gpx.ts` et `server/gpx.ts` | **Hypothèse** | Aucun code n'a été vérifié, mais la structure des dossiers suggère une possible duplication. |
| Incohérence de gestion des erreurs backend | **Hypothèse** | Absence de tests E2E ou unitaires qui couvrent les cas d'erreur. |
| Absence de tests dans `shared/` | **Confirmé** | Le fichier `shared/itinerary.test.ts` existe mais est vide ou incomplet. |

---

## 5. Conclusion et recommandations

- **Priorité 1** : Refactoriser `shared/gpx.ts` et `server/gpx.ts` pour éliminer toute duplication.
- **Priorité 2** : Mettre en place un gestionnaire d'erreur centralisé dans `server/`.
- **Priorité 3** : Implémenter des tests pour les fichiers `shared/`.

> ✅ *Rapport sauvegardé dans le fichier : [AUDIT.MD](AUDIT.MD)*
