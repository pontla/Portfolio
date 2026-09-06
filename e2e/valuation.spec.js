/**
 * Valorisation manuelle : pour ce que la source ne cote pas (fonds euros, UC
 * sans VL). Ce n'est pas un mouvement — ni cash, ni quantite, ni prix de
 * revient ne bougent, seule la valeur de marche est fixee a la main.
 */
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.js';

async function goToTab(page, tab) {
    await page.locator(`button[data-tab="${tab}"]:visible`).first().click();
    await page.locator(`#view-${tab}`).waitFor({ state: 'visible' });
}

async function openTransactionModal(page) {
    await page.locator('#addTransactionBtn:visible, #addTransactionFab:visible').first().click();
    await expect(page.locator('#transactionModal')).toHaveClass(/open/);
}

test('le formulaire ne demande ni quantite, ni prix, ni financement', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);
    await page.locator('#transactionForm input[name="type"][value="VALUATION"]').check();

    await expect(page.locator('#symbolGroup')).toBeVisible();
    await expect(page.locator('#amountGroup')).toBeVisible();
    await expect(page.locator('#qtyPriceRow')).toBeHidden();
    await expect(page.locator('#cashSourceGroup')).toBeHidden();
    await expect(page.locator('#priceCurrencyGroup')).toBeHidden();
    await expect(page.locator('#amountLabel')).toContainText('Valeur totale de la position');
});

test('le montant est demande dans la devise du support', async ({ page }) => {
    await bootApp(page, { profile: 'fund' });
    await openTransactionModal(page);
    await page.locator('#transactionForm input[name="type"][value="VALUATION"]').check();

    const symbol = page.locator('#symbolInputField');
    await symbol.fill('0P0001OOS9.F');
    await symbol.blur();

    // Un fonds europeen se releve en euros : lui reclamer des dollars serait absurde.
    await expect(page.locator('#amountLabel')).toContainText('€');
});

test('une valorisation fixe la valeur sans toucher au cash ni a la quantite', async ({ page }) => {
    await bootApp(page);
    await page.locator('#currencyToggle .toggle-btn[data-currency="USD"]').click();

    await goToTab(page, 'holdings');
    const row = page.locator('#holdingsTableBody tr').first();
    // Cours live du mock : 10 x 192,50.
    await expect(row).toContainText('1 925,00');

    await openTransactionModal(page);
    await page.locator('#transactionForm input[name="type"][value="VALUATION"]').check();
    await page.locator('#symbolInputField').fill('AAPL');
    await page.locator('#amountInputField').fill('2000');
    await page.locator('#transactionForm button[type="submit"]').click();
    await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);

    await goToTab(page, 'holdings');
    // Le releve prime sur la cotation, et la quantite reste celle de l'achat.
    await expect(row).toContainText('2 000,00');
    await expect(row).toContainText('valorisé à la main');
    await expect(row).toContainText('10');

    // Aucun mouvement de cash : l'achat initial l'avait deja laisse a zero.
    await goToTab(page, 'overview');
    await expect(page.locator('#statsGrid [data-stat="cash"]')).toHaveText('$0,00');
});

test('la ligne apparait comme valorisation, sans quantite ni prix unitaire', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);
    await page.locator('#transactionForm input[name="type"][value="VALUATION"]').check();
    await page.locator('#symbolInputField').fill('AAPL');
    await page.locator('#amountInputField').fill('2000');
    await page.locator('#transactionForm button[type="submit"]').click();
    await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);

    await goToTab(page, 'transactions');
    const line = page.locator('#transactionsTableBody tr').first();
    await expect(line.locator('.badge')).toHaveText('Valorisation');
    await expect(line.locator('[data-label="Quantité"]')).toHaveText('—');
    await expect(line.locator('[data-label="Prix"]')).toHaveText('—');
});

test('une valorisation sans position a cette date est refusee', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);
    await page.locator('#transactionForm input[name="type"][value="VALUATION"]').check();
    await page.locator('#symbolInputField').fill('MSFT'); // jamais achete
    await page.locator('#amountInputField').fill('500');
    await page.locator('#transactionForm button[type="submit"]').click();

    // La modale reste ouverte : rien n'a ete enregistre.
    await expect(page.locator('#transactionModal')).toHaveClass(/open/);
});
