/**
 * Explorer, profil OPCVM : un fonds n'a aucun ratio d'action, la fiche doit
 * donc afficher un profil de fonds plutot qu'une carte vide.
 */
import { test, expect } from '@playwright/test';
import { bootApp, openResearch } from './helpers.js';

const SYM = '0P0001OOS9.F';
const GARBAGE = ['NaN', 'undefined', 'Invalid Date', 'null', '[object Object]'];

test('OPCVM : la carte « Profil du fonds » remplace les ratios absents', async ({ page }) => {
    await bootApp(page, { profile: 'fund' });
    await openResearch(page, SYM, { deep: false });

    const card = page.locator('#researchFundCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchFundGrid');
    await expect(grid).toContainText('Varenne Capital Partners');
    await expect(grid).toContainText('02/09/2024');
    await expect(grid).toContainText('★★★★☆');
    // Fractions rendues en pourcentage : 0,7798 -> 77,98 %.
    await expect(grid).toContainText('77,98 %');
    await expect(grid).toContainText('22,02 %');

    // Les frais sont servis a 0 par la source : un tiret, jamais « 0,00 % ».
    const fees = grid.locator('.research-kv', { hasText: 'Frais courants' });
    await expect(fees.locator('.v')).toHaveText('—');
    await expect(page.locator('#researchFundNote')).toContainText('non publiés');
});

test('OPCVM : performances calendaires, lignes et secteurs sont rendus', async ({ page }) => {
    await bootApp(page, { profile: 'fund' });
    await openResearch(page, SYM, { deep: false });

    const series = page.locator('#researchFundSeries');
    await expect(series).toContainText('Performances calendaires');
    await expect(series).toContainText('2025');
    await expect(series).toContainText('9,07 %');
    await expect(series).toContainText('ASML Holding NV');
    // Cle Yahoo traduite, pas servie brute.
    await expect(series).toContainText('Technologie');
    await expect(series).not.toContainText('consumer_cyclical');

    // L'exercice en cours, sans valeur, ne doit pas apparaitre a 0.
    await expect(series).not.toContainText('0,00 %');
});

test('OPCVM : la carte de ratios annonce l absence au lieu d une limite US', async ({ page }) => {
    await bootApp(page, { profile: 'fund' });
    await openResearch(page, SYM, { deep: false });

    const src = page.locator('#researchKeySrc');
    await expect(src).toHaveText('Ratios fondamentaux indisponibles pour ce titre');
    await expect(src).not.toContainText('actions US');

    const text = await page.locator('#researchContent').innerText();
    for (const g of GARBAGE) expect(text).not.toContain(g);
});
