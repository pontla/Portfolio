/**
 * Saisie par ISIN : c'est l'identifiant que portent les releves de PEA et
 * d'assurance-vie, la ou le symbole d'un OPCVM est un code Morningstar opaque.
 */
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.js';

async function openTransactionModal(page) {
    await page.locator('#addTransactionBtn:visible, #addTransactionFab:visible').first().click();
    await expect(page.locator('#transactionModal')).toHaveClass(/open/);
}

test('un ISIN saisi est traduit en symbole cotable', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);

    const symbol = page.locator('#symbolInputField');
    await symbol.fill('LU2358392376');
    await symbol.blur();

    await expect(symbol).toHaveValue('0P0001OOS9.F');
    await expect(page.locator('#symbolHint')).toHaveText('LU2358392376 → 0P0001OOS9.F');
    // La devise du fonds suit la resolution.
    await expect(page.locator('#priceCurrencyField')).toHaveValue('EUR');
});

test('un ISIN sans historique exploitable est signale', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);

    const symbol = page.locator('#symbolInputField');
    await symbol.fill('FR0010149302');
    await symbol.blur();

    await expect(symbol).toHaveValue('Y9U3.F');
    await expect(page.locator('#symbolHint')).toContainText('pas d’historique');
});

test('un ISIN introuvable le dit, sans remplacer la saisie', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);

    const symbol = page.locator('#symbolInputField');
    await symbol.fill('LU1244893696');
    await symbol.blur();

    await expect(page.locator('#symbolHint')).toContainText('introuvable');
    await expect(symbol).toHaveValue('LU1244893696');
});

test('un ticker classique n est pas traite comme un ISIN', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);

    const symbol = page.locator('#symbolInputField');
    await symbol.fill('MSFT');
    await symbol.blur();

    await expect(symbol).toHaveValue('MSFT');
    await expect(page.locator('#symbolHint')).toHaveText('');
});

test('l ISIN resolu est enregistre avec la transaction', async ({ page }) => {
    await bootApp(page);
    await openTransactionModal(page);

    const symbol = page.locator('#symbolInputField');
    await symbol.fill('LU2358392376');
    await symbol.blur();
    await expect(symbol).toHaveValue('0P0001OOS9.F');

    await page.locator('#qtyInputField').fill('2');
    await page.locator('#priceInputField').fill('489');
    await page.locator('#transactionForm input[name="cashSource"][value="DIRECT"]').check();
    await page.locator('#transactionForm button[type="submit"]').click();
    await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);

    // Rouvrir la ligne : l'ISIN est rappele, il a donc bien ete conserve.
    await page.locator('button[data-tab="transactions"]:visible').first().click();
    await page
        .locator('#transactionsTableBody tr', { hasText: '0P0001OOS9.F' })
        .first()
        .locator('.edit-trade-btn')
        .click();
    await expect(page.locator('#transactionModalTitle')).toHaveText('Modifier la transaction');
    await expect(page.locator('#symbolHint')).toContainText('LU2358392376');
});
