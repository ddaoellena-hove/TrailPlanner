import { rm } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await rm('.e2e-trips', { recursive: true, force: true });
});

const MOCK_SUGGESTION = {
  trailId: 'osm-rel-99',
  osmRelationId: 99,
  sourceType: 'osm_relation',
  name: 'Boucle des Falaises',
  kind: 'loop',
  distanceMeters: 9200,
  elevationGainMeters: 185,
  elevationLossMeters: 185,
  estimatedDurationMin: 145,
  difficulty: 'moderate',
  pavedRatio: 0.08,
  surfaceUnknownRatio: 0.05,
  dogPolicy: 'leashed',
  inReserve: false,
  start: { lat: 49.51, lng: 1.18 },
  estimatedDriveMin: 24,
  geometry: {
    type: 'LineString',
    coordinates: [
      [1.18, 49.51],
      [1.2, 49.52],
      [1.19, 49.53],
      [1.18, 49.51],
    ],
  },
  scores: {
    total: 0.86,
    scenic: 0.88,
    isolation: 0.78,
    heritage: 0.62,
    novelty: 1,
    pavedPenalty: 0.03,
  },
  noveltyStatus: 'new',
  explanation: {
    positives: ['Paysage marqué (forêt, relief ou eau)', 'Très peu de bitume (8 %)'],
    tradeoffs: [],
    uncertainties: ['DOG_ACCESS_UNKNOWN'],
  },
  provenance: {
    snapshotId: 'normandie-e2e',
    regionName: 'Normandie',
    sources: ['© OpenStreetMap contributors (ODbL)', 'IGN RGE ALTI'],
    sourceType: 'osm_relation',
    osmRelationId: 99,
  },
};

const MOCK_BONUS_STOP = {
  placeId: 'osm:node:555',
  name: 'Château-Gaillard',
  category: 'heritage',
  location: { lat: 49.485, lng: 1.14 },
  detourMin: 4,
  detourKm: 2.2,
  distanceFromTrailKm: 3.1,
  attribution: '© OpenStreetMap contributors (ODbL)',
};

test('assembler une escapade, l’enregistrer et l’ajouter à un voyage', async ({ page }) => {
  // 1. Créer un voyage cible sur la page d'accueil.
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouveau voyage' }).click();
  const newTripDialog = page.getByRole('dialog');
  await newTripDialog.getByLabel('Nom').fill('Week-end Normandie');
  await newTripDialog.getByLabel('Début').fill('2026-11-28');
  await newTripDialog.getByLabel('Fin').fill('2026-11-29');
  await newTripDialog.getByRole('button', { name: 'Créer' }).click();
  await expect(page).toHaveURL(/\/voyages\/week-end-normandie$/);

  // 2. Intercepter la découverte catalogue (sans toucher à SQLite /escapades ni /trips).
  await page.route('**/api/discover', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalMatching: 1,
          isochroneSource: 'radius-fallback',
          snapshotId: 'normandie-e2e',
          suggestions: [MOCK_SUGGESTION],
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/discover/bonus-stops*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([MOCK_BONUS_STOP]),
    });
  });

  // 3. Ouvrir l'espace « Découvrir » et préparer l'escapade.
  await page.getByRole('link', { name: 'Découvrir' }).click();
  await expect(page).toHaveURL(/\/decouvrir$/);
  await expect(page.getByText('Boucle des Falaises')).toBeVisible();

  await page.getByRole('button', { name: /Préparer l.escapade/ }).click();
  await expect(page.getByText('Chronologie porte-à-porte')).toBeVisible();
  await expect(page.getByText('Château-Gaillard')).toBeVisible();

  // Sélectionner l'étape bonus (< 15 min) et personnaliser le titre.
  await page.getByRole('button', { name: /Château-Gaillard/ }).click();
  await expect(page.getByText('Étape bonus — Château-Gaillard')).toBeVisible();

  await page.getByLabel(/Titre de l.escapade/).fill('Escapade Falaises & Château');
  await page.getByRole('button', { name: /Enregistrer l.escapade/ }).click();
  await expect(page.getByRole('button', { name: /Mettre à jour l.escapade/ })).toBeVisible();

  // 4. Vérifier la persistance dans « Mes escapades » après rechargement.
  await page.reload();
  await page.getByRole('tab', { name: /Mes escapades/ }).click();
  await expect(page.getByText('Escapade Falaises & Château')).toBeVisible();
  await expect(page.getByText(/Château-Gaillard/)).toBeVisible();

  // 5. Ajouter l'escapade au voyage « Week-end Normandie ».
  await page.getByRole('button', { name: 'Ajouter à un voyage' }).click();
  const addDialog = page.getByRole('dialog');
  await expect(addDialog.getByText('Ajouter à un voyage')).toBeVisible();
  await addDialog.getByRole('button', { name: 'Ajouter au voyage' }).click();
  await expect(addDialog).toBeHidden();

  // 6. Vérifier que la boucle et l'étape bonus apparaissent dans le voyage.
  await page.goto('/voyages/week-end-normandie');
  await expect(page.getByText('Boucle des Falaises').first()).toBeVisible();
  await expect(page.getByText('Château-Gaillard').first()).toBeVisible();
});
