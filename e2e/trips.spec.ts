import { rm } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.beforeAll(async () => {
  await rm('.e2e-trips', { recursive: true, force: true });
});

test('créer un voyage, le retrouver après rechargement, le dupliquer et le supprimer', async ({
  page,
}) => {
  const mapErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Worker')) {
      mapErrors.push(message.text());
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Nouveau voyage' }).click();

  await page.getByLabel('Nom du voyage').fill('Dévoluy & Champsaur');
  await page.getByLabel('Début').fill('2027-07-01');
  await page.getByLabel('Fin', { exact: true }).fill('2027-07-05');
  await page.getByLabel('Avec chien').check();
  await page.getByRole('button', { name: 'Créer le voyage' }).click();

  await expect(page).toHaveURL(/\/voyages\/devoluy-champsaur$/);
  await expect(page.getByLabel('Nom du voyage')).toHaveValue('Dévoluy & Champsaur');
  await expect(page.getByText('5 jours', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Avec chien')).toBeChecked();

  await page.getByRole('button', { name: 'Ajouter une étape au jour 2' }).click();
  await page.getByLabel('Lien AllTrails').fill('https://www.alltrails.com/fr/randonnee/france/col');
  await page.getByLabel('Fichier GPX').setInputFiles({
    name: 'col.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Col du Festre</name><trkseg>
<trkpt lat="44.70" lon="5.90"><ele>1400</ele></trkpt>
<trkpt lat="44.72" lon="5.90"><ele>1600</ele></trkpt>
</trkseg></trk></gpx>`,
    ),
  });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Col du Festre' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Itinéraire' })).toHaveAttribute(
    'href',
    /destination=44\.7,5\.9/,
  );
  await page.reload();
  await expect(page.getByRole('link', { name: 'AllTrails' })).toBeVisible();

  await page.route('**/api/geocode*', (route) =>
    route.fulfill({
      json: [{ label: 'Gap, 05000', location: { lat: 44.56, lng: 6.08 } }],
    }),
  );
  await expect(page.getByRole('link', { name: 'Itinéraire' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Ajouter une étape au jour 3' }).click();
  await page.getByLabel('Étape avec trail').click();
  await page.getByLabel('Adresse du séjour').fill('Gap');
  await page.getByRole('button', { name: 'Gap, 05000' }).click();
  await page.getByLabel('Lien du séjour').fill('https://hotel.example/gap');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Séjour', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lien du séjour' })).toHaveAttribute(
    'href',
    'https://hotel.example/gap',
  );

  await expect(page.getByText(/1 trajet · .* de route/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.maplibregl-marker')).toHaveCount(2);
  expect(mapErrors).toEqual([]);

  await expect(page.getByText('Col du Festre → Gap, 05000')).toBeVisible();
  const handle = page.getByRole('button', { name: 'Déplacer Gap, 05000' });
  const target = page.getByRole('button', { name: 'Déplacer Col du Festre' });
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y - 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText('Gap, 05000 → Col du Festre')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Actualiser' }).click();
  await expect(page.getByText(/1 trajet · .* de route/)).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('Nom du voyage').fill('Dévoluy & Champsaur 2027');
  await page.getByLabel('Fin', { exact: true }).click();
  await expect(page.getByLabel('Nom du voyage')).toHaveValue('Dévoluy & Champsaur 2027');

  await page.getByLabel('Fin', { exact: true }).fill('2027-07-01');
  await page.getByLabel('Avec chien').focus();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByText('1 jour', { exact: true })).toBeVisible();
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: /Lieux/ }).click();
  await page.getByRole('button', { name: 'Planifier Gap, 05000' }).click();
  await page.getByRole('menuitem', { name: /^J1/ }).click();
  await page.getByRole('tab', { name: /Randos/ }).click();
  await page.getByRole('button', { name: 'Planifier Col du Festre' }).click();
  await page.getByRole('menuitem', { name: /^J1/ }).click();
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Annuler la dernière modification' }).click();
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(0);

  const gpx = (name: string) => ({
    name: `${name}.gpx`,
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>
<trkpt lat="44.80" lon="5.90"><ele>1000</ele></trkpt>
<trkpt lat="44.82" lon="5.90"><ele>1200</ele></trkpt>
</trkseg></trk></gpx>`,
    ),
  });
  await page.getByLabel('Importer des GPX').setInputFiles([
    gpx('Lac Bleu'),
    gpx('Crete Sud'),
    { name: 'casse.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('pas du xml') },
  ]);
  await expect(page.getByText('casse.gpx', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter à la bibliothèque' }).click();
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(2);

  await expect(page.getByText('Lac Bleu : dans aucun jour')).toBeVisible();

  await page.getByRole('button', { name: 'Lac Bleu', exact: true }).click();
  await page.getByLabel('Notes', { exact: true }).fill('Prévoir de l’eau');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('button', { name: 'Lac Bleu', exact: true }).click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Prévoir de l’eau');
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(1);

  const libraryHandle = page.getByRole('button', { name: 'Glisser Crete Sud vers un jour' });
  const dayTarget = page.getByRole('button', { name: 'Ajouter une étape au jour 1' });
  await libraryHandle.scrollIntoViewIfNeeded();
  const handleBox = (await libraryHandle.boundingBox())!;
  const dayBox = (await dayTarget.boundingBox())!;
  await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 12, handleBox.y + 12, { steps: 4 });
  await page.mouse.move(dayBox.x, dayBox.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText('Non planifiée', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByLabel('Allure à plat (km/h)').fill('2');
  await page.getByLabel('Marche max (h/jour)').fill('1');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('meter', { name: 'Marche : part du seuil' })).toBeVisible();

  // Alertes : A1 et A4 apparaissent, et A5 se corrige en un clic.
  await expect(page.getByText(/J1 : .* de marche pour 1 h max/)).toBeVisible();
  await expect(page.getByText('Chien à confirmer : Col du Festre')).toBeVisible();
  await expect(page.getByText('Col du Festre : le véhicule reste au départ')).toBeVisible();
  await page.getByRole('button', { name: 'Convertir Col du Festre en aller-retour' }).click();
  await expect(page.getByText('Col du Festre : le véhicule reste au départ')).toBeHidden();

  await page.getByRole('button', { name: 'Crete Sud', exact: true }).first().click();
  await page.getByLabel('Politique chiens').click();
  await page.getByRole('option', { name: 'Chiens interdits' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Chiens interdits : Crete Sud')).toBeVisible();

  await page.route('**/itinerary*', (route) =>
    route.fulfill({
      json: {
        legs: [
          {
            from: { lat: 44.7, lng: 5.9 },
            to: { lat: 44.56, lng: 6.08 },
            distanceKm: 30,
            durationMin: 26,
            geometry: {
              type: 'LineString',
              coordinates: [
                [5.9, 44.7],
                [6.08, 44.56],
              ],
            },
            source: 'straight-line-fallback',
            fromName: 'Col du Festre',
            toName: 'Gap, 05000',
            dayIndex: 1,
            stopId: null,
            phase: 'end',
            trailToStay: true,
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: 'Actualiser' }).click();
  await expect(
    page.getByText("Col du Festre → Gap, 05000 : trajet estimé à vol d'oiseau"),
  ).toBeVisible();
  await page.unroute('**/itinerary*');

  // Sans token, l'aperçu reste disponible et l'export s'explique.
  await page.getByRole('button', { name: 'Exporter vers Notion' }).click();
  await expect(page.getByText(/# Carnet|Tableau jour par jour|Hébergements/).first()).toBeVisible();
  await expect(page.getByText('NOTION_TOKEN', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).first().click();

  // Lieu ajouté d'un clic droit sur la carte, puis nuit et réservation.
  await page.locator('.maplibregl-canvas').click({ button: 'right' });
  await page.getByRole('button', { name: 'Ajouter un lieu ici' }).click();
  await page.getByLabel('Nom du lieu').fill('Parking du col');
  await page.getByLabel('Type de lieu').click();
  await page.getByRole('option', { name: 'Parking' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('tab', { name: /Lieux/ }).click();
  await expect(page.getByRole('button', { name: 'Parking du col', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Gap, 05000', exact: true }).first().click();
  await page.getByLabel('Réservation').click();
  await page.getByRole('option', { name: 'À réserver' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Gap, 05000 : à réserver')).toBeVisible();

  await page.getByLabel('Filtrer la carte').click();
  await page.getByRole('option', { name: 'J1' }).click();
  await expect(page.getByText('Profil du J1')).toBeVisible();

  await page.getByRole('link', { name: 'Mes voyages' }).click();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Dévoluy & Champsaur 2027' })).toBeVisible();
  await expect(page.getByText('1 juillet 2027 · 1 jour')).toBeVisible();

  await page.getByRole('button', { name: 'Actions pour Dévoluy & Champsaur 2027' }).click();
  await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
  const copy = page.getByRole('link', { name: 'Dévoluy & Champsaur 2027 (copie)' });
  await expect(copy).toBeVisible();

  await page.getByRole('button', { name: 'Actions pour Dévoluy & Champsaur 2027 (copie)' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(copy).toBeHidden();
  await expect(page.getByRole('link', { name: 'Dévoluy & Champsaur 2027', exact: true })).toBeVisible();
});
