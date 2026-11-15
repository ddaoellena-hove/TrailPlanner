import { readFile, rm } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const RECORDING = 'fixtures/recordings/sur-les-traces-de-voltaire.gpx';
const TITLE = "Randonnée de l'après-midi à Sur les Traces de Voltaire";

test.beforeAll(async () => {
  await rm('.e2e-trips/.activities', { recursive: true, force: true });
});

test('importer une sortie AllTrails, la retrouver et refuser les doublons', async ({ page }) => {
  const recording = await readFile(RECORDING);
  const file = (name: string, buffer: Buffer) => ({
    name,
    mimeType: 'application/gpx+xml',
    buffer,
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Mes sorties' }).click();
  await expect(page).toHaveURL(/\/sorties$/);
  await expect(page.getByText(/Aucune sortie pour l.instant/)).toBeVisible();

  // Fichier illisible : erreur expliquée, rien n'est importé.
  await page.getByRole('button', { name: 'Importer une sortie' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Fichier GPX').setInputFiles(file('cassé.gpx', Buffer.from('<gpx><trk>')));
  await expect(dialog.getByRole('alert')).toContainText("Ce fichier n'est pas un GPX lisible");

  // Aperçu : valeurs calculées, rien n'est encore enregistré.
  await dialog.getByLabel('Fichier GPX').setInputFiles(file('voltaire.gpx', recording));
  await expect(dialog.getByLabel('Titre')).toHaveValue(TITLE);
  await expect(dialog.getByText('samedi 14 novembre 2026, départ 13:37')).toBeVisible();
  await expect(dialog.getByText('6,8 km')).toBeVisible();
  await expect(dialog.getByText('87 m')).toBeVisible();
  await expect(dialog.getByText('1 h 25')).toBeVisible();
  await expect(dialog.getByText('AllTrails', { exact: true })).toBeVisible();

  await dialog.getByLabel('Titre').fill('Voltaire avec Rémi');
  await dialog.getByRole('button', { name: 'Importer', exact: true }).click();

  // Succès : la fiche s'ouvre, la sortie est dans l'historique et y reste.
  const sheet = page.getByRole('dialog', { name: 'Voltaire avec Rémi' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('13:37 → 15:03', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: /Voltaire avec Rémi/ })).toBeVisible();
  await expect(page.getByText('1 sortie', { exact: true })).toBeVisible();

  // Même fichier : doublon exact, aucun bouton d'import.
  await page.getByRole('button', { name: 'Importer une sortie' }).click();
  await dialog.getByLabel('Fichier GPX').setInputFiles(file('copie.gpx', recording));
  await expect(dialog.getByText('Ce fichier a déjà été importé')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Importer/ })).toHaveCount(0);

  // Autre fichier, même sortie : doublon probable, import seulement sur choix explicite.
  const otherExport = Buffer.from(
    recording.toString('utf8').replace('</gpx>', '<!-- autre export -->\n</gpx>'),
  );
  await dialog.getByLabel('Fichier GPX').setInputFiles(file('autre-export.gpx', otherExport));
  await expect(dialog.getByText('Cette sortie ressemble à une sortie déjà importée')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importer quand même' }).click();
  await expect(page.getByRole('dialog', { name: TITLE })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 sorties', { exact: true })).toBeVisible();
});
