/**
 * Import d'un releve de position (assurance vie, PER...) : un support couvert
 * par l'API n'a besoin que de son achat ; un support que la source ne cote
 * pas recoit en plus une valorisation manuelle au montant du releve.
 */
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.js';

const HEADER = 'Nom du support\tISIN\tNombre de parts\tMontant\tPMPA\tDate VL';
const row = (name, isin, qty, montant, pmpa, dateVL) =>
    [name, isin, qty, montant, pmpa, dateVL].join('\t');

// Resolu par l'API avec historique (mock e2e/helpers.js) -> achat seul.
const VARENNE = row(
    'Varenne Valeur A EUR Acc',
    'LU2358392376',
    '11,7508',
    '5 748,13 €',
    '387,69 €',
    '03/09/2026'
);
// ISIN absent du referentiel de la source (mock : tout ISIN inconnu -> []) ->
// achat + valorisation manuelle.
const UNKNOWN = row('Fonds Inconnu', 'FR0099999999', '10', '1 000,00 €', '90,00 €', '03/09/2026');

const csv = (...lines) => [HEADER, ...lines].join('\n');

async function goToTab(page, tab) {
    await page.locator(`button[data-tab="${tab}"]:visible`).first().click();
    await page.locator(`#view-${tab}`).waitFor({ state: 'visible' });
}

async function switchTo(page, name) {
    await page.locator('#portfolioSwitcherBtn').click();
    await page.locator('#portfolioDropdownList').getByText(name, { exact: true }).click();
    await expect(page.locator('#appTitle')).toHaveText(name);
}

async function openPositionImport(page) {
    await page.locator('#settingsBtn:visible').first().click();
    await expect(page.locator('#settingsModal')).toHaveClass(/open/);
    await page.locator('#openPositionImportBtn').click();
    await expect(page.locator('#positionImportModal')).toHaveClass(/open/);
}

/**
 * Colle un releve et lance l'import, en acceptant l'alerte finale.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {string} portfolioName
 */
async function importPosition(page, text, portfolioName = 'Assurance Vie') {
    await openPositionImport(page);
    await page.locator('#positionImportPortfolio').fill(portfolioName);
    await page.locator('#positionImportTextarea').fill(text);

    /** @type {string[]} */
    const dialogs = [];
    page.on('dialog', async (d) => {
        dialogs.push(d.message());
        await d.accept();
    });
    await page.locator('#positionImportSubmitBtn').click();
    await expect(page.locator('#positionImportModal')).not.toHaveClass(/open/);
    return dialogs;
}

test.beforeEach(async ({ page }) => {
    await bootApp(page);
});

test('un support couvert par l API n ajoute qu un achat, un support inconnu une valorisation manuelle', async ({
    page,
}) => {
    const dialogs = await importPosition(page, csv(VARENNE, UNKNOWN));
    expect(dialogs[0]).toContain('3 transaction(s) importée(s)');
    expect(dialogs[0]).toContain('aucune cotation trouvée');

    await switchTo(page, 'Assurance Vie');
    await goToTab(page, 'holdings');

    const varenneRow = page.locator('#holdingsTableBody tr', { hasText: '0P0001OOS9.F' });
    await expect(varenneRow).toBeVisible();
    await expect(varenneRow).not.toContainText('valorisé à la main');

    // Support non resolu : retenu sous son propre ISIN, valorise a la main.
    const unknownRow = page.locator('#holdingsTableBody tr', { hasText: 'FR0099999999' });
    await expect(unknownRow).toBeVisible();
    await expect(unknownRow).toContainText('valorisé à la main');
});

test('la quantite et le PRU importes correspondent au releve (PRU = PMPA)', async ({ page }) => {
    await importPosition(page, csv(VARENNE));
    await switchTo(page, 'Assurance Vie');
    await goToTab(page, 'transactions');

    const txRow = page.locator('#transactionsTableBody tr, .tx-card').first();
    await expect(txRow).toContainText('11.7508');
    await expect(txRow).toContainText('387,69');
});

test('sans portefeuille de destination, l import est bloque', async ({ page }) => {
    await openPositionImport(page);
    // Le champ est prerempli par defaut : on verifie explicitement le cas vide.
    await page.locator('#positionImportPortfolio').fill('');
    await page.locator('#positionImportTextarea').fill(csv(VARENNE));
    await page.locator('#positionImportSubmitBtn').click();
    await expect(page.locator('#positionImportHint')).toContainText('portefeuille');
    await expect(page.locator('#positionImportModal')).toHaveClass(/open/);
});

test('sans releve colle, l import est bloque', async ({ page }) => {
    await openPositionImport(page);
    await page.locator('#positionImportPortfolio').fill('Assurance Vie');
    await page.locator('#positionImportSubmitBtn').click();
    await expect(page.locator('#positionImportHint')).toContainText('Colle');
    await expect(page.locator('#positionImportModal')).toHaveClass(/open/);
});
