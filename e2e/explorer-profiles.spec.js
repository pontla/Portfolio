/**
 * Vérifications finales de l'Explorer (phase 12) : trois profils de valeur très
 * différents, absence de NaN / date invalide, temps de rendu et affichage mobile.
 * Chaque test installe son propre profil de données, d'où l'absence de beforeEach.
 */
import { test, expect } from '@playwright/test';
import { bootApp, openResearch } from './helpers.js';

/** Attend la fin du rendu différé (analyse complète + comparables). */
async function waitForAnalysis(page) {
    await expect(page.locator('#researchScoreTop .score-signal')).toBeVisible();
    await expect(page.locator('#researchPeersTable')).not.toBeEmpty();
}

/** Texte visible de toute la vue Explorer. */
function viewText(page) {
    return page.locator('#researchContent').innerText();
}

const GARBAGE = ['NaN', 'undefined', 'Invalid Date', 'null', '[object Object]'];

test('profil 1 — action US complète : toutes les sections remplies, aucune valeur parasite', async ({ page }) => {
    await bootApp(page);
    await openResearch(page, 'AAPL');
    await waitForAnalysis(page);

    for (const id of ['researchScoreCard', 'researchValuationCard', 'researchGrowthCard',
        'researchHealthCard', 'researchProfitCard', 'researchSentimentCard', 'researchTechCard',
        'researchDivCard', 'researchPeersCard', 'researchQualCard', 'researchAboutCard']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
    }

    const txt = await viewText(page);
    for (const bad of GARBAGE) expect(txt).not.toContain(bad);
    // le bug historique des dates d'actualités : plus aucun "NaN/NaN/NaN"
    expect(txt).not.toMatch(/\d?\d?\/\s*\/|NaN\//);
});

test('profil 2 — valeur hors périmètre fondamental : dégradation propre, sans NaN', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await bootApp(page, { profile: 'sparse' });
    await openResearch(page, 'MC.PA');
    await waitForAnalysis(page);

    // cours et graphe restent fonctionnels
    await expect(page.locator('#researchPrice')).toHaveText(/\d/);
    await expect(page.locator('#researchChart')).toBeVisible();

    // score : pas assez de dimensions notables -> refus explicite plutôt qu'un chiffre trompeur
    await expect(page.locator('#researchScoreTop .score-signal')).toHaveText('Non disponible');
    await expect(page.locator('#researchScoreCard')).toContainText('Trop peu de données publiques');

    // sections fondamentales : "Non disponible", jamais un tiret sec ni un NaN
    await expect(page.locator('#researchValuationGrid')).toContainText('Non disponible');
    await expect(page.locator('#researchSentimentGrid')).toContainText('Non disponible');
    await expect(page.locator('#researchPeersCard')).toContainText('actions US uniquement');

    // aucune donnée de dividende ni de risque publiée -> cartes/sous-sections omises
    await expect(page.locator('#researchDivCard')).toBeHidden();
    await expect(page.locator('#researchQualBody')).not.toContainText('Risques');

    const txt = await viewText(page);
    for (const bad of GARBAGE) expect(txt).not.toContain(bad);
    expect(errors).toEqual([]);
});

test('profil 3 — action sans dividende : la carte Dividende disparaît, le reste tient', async ({ page }) => {
    await bootApp(page, { profile: 'nodiv' });
    await openResearch(page, 'AAPL');
    await waitForAnalysis(page);

    await expect(page.locator('#researchDivCard')).toBeHidden();
    await expect(page.locator('#researchScoreTop .score-val')).toHaveText(/^\d{1,3}$/);
    await expect(page.locator('#researchProfitCard')).toBeVisible();
    await expect(page.locator('#researchQualCard')).toBeVisible();
    // le calendrier n'invente pas de détachement
    await expect(page.locator('#researchQualBody').filter({ hasText: 'Calendrier' }))
        .toContainText('Détachement du dividende');

    const txt = await viewText(page);
    for (const bad of GARBAGE) expect(txt).not.toContain(bad);
});

test('le rendu complet reste rapide et non bloquant', async ({ page }) => {
    await bootApp(page);

    const t0 = Date.now();
    await openResearch(page, 'AAPL');
    // les sections rapides sont là avant l'analyse différée
    await expect(page.locator('#researchKeyGrid .research-kv').first()).toBeVisible();
    const tFast = Date.now() - t0;

    await waitForAnalysis(page);
    const tFull = Date.now() - t0;

    expect(tFast).toBeLessThan(4000);
    expect(tFull).toBeLessThan(10000);
});

test('mobile 390 px : toutes les cartes tiennent sans débordement horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootApp(page);
    await openResearch(page, 'AAPL');
    await waitForAnalysis(page);

    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // le tableau sectoriel défile dans son propre conteneur, pas dans la page
    const scrollable = await page.locator('.peers-wrap').evaluate(
        (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto'
    );
    expect(scrollable).toBe(true);

    // aucune carte ne dépasse la largeur du viewport
    const widths = await page.locator('#researchContent .card').evaluateAll(
        (els) => els.filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect().right)
    );
    for (const right of widths) expect(right).toBeLessThanOrEqual(391);
});
