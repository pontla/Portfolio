import { test, expect } from '@playwright/test';
import { bootApp, openResearch } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await bootApp(page);
});

test('affiche la valeur recherchée avec un contenu complet', async ({ page }) => {
    await openResearch(page, 'AAPL');

    await expect(page.locator('#researchEmpty')).toBeHidden();
    await expect(page.locator('#researchContent')).toBeVisible();
    await expect(page.locator('#researchSymbol')).toHaveText('AAPL');
    await expect(page.locator('#researchName')).toHaveText(/Apple/);
    await expect(page.locator('#researchPrice')).toHaveText(/\d/);
    await expect(page.locator('#researchPrice')).not.toHaveText('—');
    await expect(page.locator('#researchKeyGrid .research-kv').first()).toBeVisible();
    await expect(page.locator('#researchChart')).toBeVisible();
});

test('les cartes ont un padding cohérent (contenu décollé des bords)', async ({ page }) => {
    await openResearch(page, 'AAPL');

    // Desktop : 20px sur les cartes, 16px sur la carte de recherche.
    const headPad = await page.locator('#view-research .research-head-card').evaluate(
        (el) => getComputedStyle(el).paddingTop
    );
    expect(headPad).toBe('20px');

    const searchPad = await page.locator('#view-research .research-search-card').evaluate(
        (el) => getComputedStyle(el).paddingTop
    );
    expect(searchPad).toBe('16px');

    // Le logo ne touche pas le bord gauche de la carte.
    const card = await page.locator('.research-head-card').boundingBox();
    const logo = await page.locator('#researchLogo').boundingBox();
    expect(logo.x - card.x).toBeGreaterThanOrEqual(16);
});

test('la tuile de prix est stylée et alignée à droite en desktop', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const box = page.locator('.research-price');
    const s = await box.evaluate((el) => {
        const c = getComputedStyle(el);
        return { radius: c.borderTopLeftRadius, border: c.borderTopWidth, bg: c.backgroundColor };
    });
    expect(s.radius).toBe('10px');
    expect(s.border).toBe('1px');
    expect(s.bg).not.toBe('rgba(0, 0, 0, 0)');

    // Alignée à droite : bord droit de la tuile ~= bord droit du contenu de la carte.
    const card = await page.locator('.research-head-card').boundingBox();
    const price = await box.boundingBox();
    expect(card.x + card.width - (price.x + price.width)).toBeLessThanOrEqual(24);

    await expect(page.locator('.research-price-cap')).toHaveText(/Dernier cours/i);
});

test('le bouton Max recharge le graphe depuis le début de l’action', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const req = page.waitForRequest((r) => r.url().includes('/history') && /[?&]from=/.test(r.url()));
    await page.locator('#researchRange .range-btn[data-range="MAX"]').click();
    const from = new URL((await req).url()).searchParams.get('from');

    const yearsBack = new Date().getFullYear() - Number(from.slice(0, 4));
    expect(yearsBack).toBeGreaterThanOrEqual(45);
    expect(yearsBack).toBeLessThanOrEqual(51);

    await expect(page.locator('#researchRange .range-btn[data-range="MAX"]')).toHaveClass(/active/);
    await expect(page.locator('#researchChart')).toBeVisible();
});

test('le graphe expose un tooltip au survol (mode index)', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const mode = await page.evaluate(() => window.App?.researchChart?.options?.interaction?.mode
        ?? App.researchChart.options.interaction.mode);
    expect(mode).toBe('index');

    const tip = await page.evaluate(() => App.researchChart.options.plugins.tooltip.mode);
    expect(tip).toBe('index');
});

test('cliquer sur une position détenue ouvre l’Explorer sur cette valeur', async ({ page }) => {
    await page.locator('button[data-tab="holdings"]:visible').first().click();
    await page.locator('#view-holdings').waitFor({ state: 'visible' });

    await page.locator('.holding-asset-cell[data-symbol="AAPL"]:visible').first().click();

    await expect(page.locator('#view-research')).toBeVisible();
    await expect(page.locator('#researchContent')).toBeVisible();
    await expect(page.locator('#researchSymbol')).toHaveText('AAPL');
    await expect(page.locator('#researchName')).toHaveText(/Apple/);
    await expect(page.locator('#researchChart')).toBeVisible();
});

test('section Valorisation : rendue en différé avec repères moyenne 5 ans et aides', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchValuationCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchValuationGrid');
    // le placeholder "Chargement…" est remplacé par les métriques
    await expect(grid.locator('.research-kv')).toHaveCount(8);
    await expect(grid.locator('.research-kv-loading')).toHaveCount(0);

    // PER prévisionnel provient de quoteSummary (27,4 ×)
    await expect(grid).toContainText('PER prévisionnel');
    await expect(grid).toContainText('27,4 ×');

    // repère visuel vs moyenne historique du titre + info-bulle d'aide
    await expect(grid.locator('.kv-cmp').first()).toBeVisible();
    await expect(grid.locator('.kv-help').first()).toHaveAttribute('data-tip', /.+/);
});

test('aucun débordement horizontal du corps de page', async ({ page }) => {
    await openResearch(page, 'AAPL');
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
});

test('mobile : la carte d’en-tête reste lisible et sans scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openResearch(page, 'AAPL');

    const pad = await page.locator('#view-research .research-head-card').evaluate(
        (el) => getComputedStyle(el).paddingTop
    );
    expect(pad).toBe('16px');

    // La tuile de prix prend toute la largeur du contenu de la carte.
    const card = await page.locator('.research-head-card').boundingBox();
    const price = await page.locator('.research-price').boundingBox();
    expect(price.width).toBeGreaterThan(card.width - 40);

    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
});
