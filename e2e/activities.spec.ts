import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { northboundPoints, recordedGpx } from '../shared/recorded-gpx.fixture';

const RECORDING = 'fixtures/recordings/sur-les-traces-de-voltaire.gpx';
const TITLE = "Randonnée de l'après-midi à Sur les Traces de Voltaire";

const EXPORTS = path.resolve('.e2e-trips/exports-alltrails');

// Les tests s'enchaînent sur les mêmes données : un échec arrête les suivants.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Données de départ vides, comme pour les voyages : sorties, bibliothèque, réglages et dossier.
  await rm('.e2e-trips', { recursive: true, force: true });
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

test('synchroniser un dossier d’exports et trancher un doublon probable', async ({ page }) => {
  await mkdir(EXPORTS, { recursive: true });
  const files: Record<string, string> = {
    // Déjà importée par le test précédent : doublon exact.
    'voltaire.gpx': await readFile(RECORDING, 'utf8'),
    'col.gpx': recordedGpx([northboundPoints(30)], { name: 'Col du Festre' }),
    'cassé.gpx': '<gpx><trk>',
  };
  const past = new Date(Date.now() - 60_000);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(EXPORTS, name), content);
    await utimes(path.join(EXPORTS, name), past, past);
  }

  await page.goto('/sorties');
  const panel = page.getByRole('region', { name: 'Synchronisation' });
  await panel.getByLabel('Dossier des exports AllTrails').fill('exports');
  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(panel.getByRole('alert')).toContainText('chemin complet');

  await panel.getByLabel('Dossier des exports AllTrails').fill(EXPORTS);
  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await panel.getByRole('button', { name: 'Synchroniser maintenant' }).click();

  await expect(panel).toContainText('1 sortie importée, 1 doublon, 1 échec');
  await expect(panel).toContainText("cassé.gpx : Ce fichier n'est pas un GPX lisible");
  await expect(page.getByRole('button', { name: /Col du Festre/ })).toBeVisible();

  // Un second passage n'importe rien de plus.
  await panel.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await expect(panel).toContainText('Dernière synchronisation');
  await expect(panel).not.toContainText('sortie importée');

  // Autre export de la même sortie : en attente, puis importé sur choix explicite.
  const otherExport = path.join(EXPORTS, 'col-montre.gpx');
  await writeFile(otherExport, `${files['col.gpx']}\n<!-- montre -->`);
  await utimes(otherExport, past, past);
  await panel.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await expect(panel).toContainText('Un fichier ressemble à une sortie déjà importée');
  await panel.getByRole('button', { name: 'Importer quand même' }).click();
  await expect(panel).not.toContainText('ressemble à une sortie');
  await expect(page.getByRole('button', { name: /Col du Festre/ })).toHaveCount(2);
});

test('lier une sortie à la rando prévue qu’elle a suivie', async ({ page }) => {
  // La rando prévue entre dans la bibliothèque par l'import d'un GPX dans un voyage.
  const trip = await (
    await page.request.post('/api/trips', {
      data: { name: 'Normandie', startDate: '2026-11-14', endDate: '2026-11-15', withDog: false },
    })
  ).json();
  const upload = await page.request.post(`/api/trips/${trip.slug}/gpx`, {
    multipart: {
      file: {
        name: 'voltaire-itineraire.gpx',
        mimeType: 'application/gpx+xml',
        buffer: await readFile(RECORDING),
      },
      name: 'Sur les traces de Voltaire',
    },
  });
  expect(upload.status()).toBe(201);

  await page.goto('/sorties');
  await page.getByRole('button', { name: /Voltaire avec Rémi/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Voltaire avec Rémi' });
  const section = sheet.getByRole('region', { name: 'Rando prévue' });
  await expect(section).toContainText('Correspond probablement à « Sur les traces de Voltaire »');
  await section.getByRole('button', { name: 'Lier', exact: true }).first().click();

  await expect(section).toContainText('Rando prévue : Sur les traces de Voltaire');
  await expect(section.getByRole('columnheader', { name: 'Prévu' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: 'Réalisé' })).toBeVisible();

  // Contrat d'export JSON (v1, cible Obsidian) : télécharge la sortie et sa rando liée séparément.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Exporter JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('2026-11-14-voltaire-avec-remi.lifeos.json');
  const exportedPath = await download.path();
  expect(exportedPath).not.toBeNull();
  const exported = JSON.parse(await readFile(exportedPath!, 'utf8'));
  expect(exported).toMatchObject({
    version: 1,
    kind: 'activity',
    target: 'obsidian',
    activity: { title: 'Voltaire avec Rémi', localDate: '2026-11-14', localStartTime: '13:37' },
    plannedRoute: { name: 'Sur les traces de Voltaire' },
  });

  // La rando prévue compte comme faite et renvoie vers la sortie.
  await page.goto('/randos');
  const card = page.getByRole('button', { name: /Sur les traces de Voltaire/ });
  await expect(card).toContainText('Faite 1 fois');
  await card.click();
  await page.getByRole('link', { name: /14 nov\. 2026/ }).click();
  await expect(page).toHaveURL(/\/sorties\?sortie=/);
  await expect(page.getByRole('dialog', { name: 'Voltaire avec Rémi' })).toBeVisible();

  // Retirer le lien la fait redevenir « jamais faite ».
  await page
    .getByRole('dialog', { name: 'Voltaire avec Rémi' })
    .getByRole('button', { name: 'Retirer le lien' })
    .click();
  await expect(page.getByRole('region', { name: 'Rando prévue' })).toContainText(
    'Correspond probablement',
  );
});
