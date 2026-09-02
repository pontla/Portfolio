// Analyse detaillee redigee par l'IA (phase 13) : la carte n'apparait qu'une fois
// l'analyse approfondie lancee, et le compte doit avoir une cle IA enregistree.
import { test, expect } from '@playwright/test';
import { bootApp, openResearch, runDeepAnalysis } from './helpers.js';

test('affiche le texte généré, le timestamp et le bouton de régénération', async ({ page }) => {
    await bootApp(page, { ai: true });
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchAiCard');
    await expect(card).toBeVisible();
    await expect(card.locator('.research-ai-text p').first()).toContainText(/Apple/);
    await expect(page.locator('#researchAiUpdated')).toHaveText(
        /Analyse générée le \d{2}\/\d{2}\/\d{4}/
    );
    await expect(page.locator('#researchAiRefreshBtn')).toBeVisible();

    // Le disclaimer reste affiché en dur sous le texte.
    await expect(card.locator('.score-disclaimer')).toContainText(
        /pas un conseil en investissement/i
    );
});

test('texte long : tronqué par défaut, déplié par « Afficher plus »', async ({ page }) => {
    await bootApp(page, { ai: true });
    await openResearch(page, 'AAPL');

    const text = page.locator('#researchAiCard .research-ai-text');
    const toggle = page.locator('#researchAiCard .insights-summary-toggle');
    await expect(text).toHaveClass(/is-clamped/);
    await expect(toggle).toHaveText('Afficher plus');

    const clampedHeight = (await text.boundingBox()).height;
    await toggle.click();
    await expect(text).not.toHaveClass(/is-clamped/);
    await expect(toggle).toHaveText('Afficher moins');
    expect((await text.boundingBox()).height).toBeGreaterThan(clampedHeight);
});

test('un seul appel au fournisseur : le cache local sert les visites suivantes', async ({
    page,
}) => {
    const calls = [];
    await bootApp(page, { ai: true });
    await page.route('**/ai/stock-analysis', (route) => {
        calls.push(route.request().postDataJSON());
        return route.fallback(); // laisse le mock de bootApp repondre
    });

    await openResearch(page, 'AAPL');
    await expect(page.locator('#researchAiCard .research-ai-text')).toBeVisible();
    expect(calls).toHaveLength(1);

    // Le payload envoyé ne contient que des données déjà calculées.
    const sent = calls[0].data;
    expect(sent.symbol).toBe('AAPL');
    expect(sent.scoreGlobal).toEqual(expect.any(Number));
    expect(Array.isArray(sent.sousScores)).toBe(true);
    expect(Array.isArray(sent.nonDisponible)).toBe(true);
    expect(calls[0].force).toBe(false);

    // Retour sur la valeur : rendu depuis le cache local, aucun nouvel appel.
    await page.locator('button[data-tab="overview"]:visible').first().click();
    await page.locator('button[data-tab="research"]:visible').first().click();
    await runDeepAnalysis(page);
    await expect(page.locator('#researchAiCard .research-ai-text')).toBeVisible();
    expect(calls).toHaveLength(1);

    // Le bouton de régénération force un nouvel appel.
    await page.locator('#researchAiRefreshBtn').click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1].force).toBe(true);
});

test('échec de génération : message clair, le reste de la page reste intact', async ({ page }) => {
    await bootApp(page, { ai: true });
    await page.route('**/ai/stock-analysis', (route) =>
        route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'fournisseur injoignable' }),
        })
    );

    await openResearch(page, 'AAPL');

    await expect(page.locator('#researchAiCard .insights-plain-note')).toContainText(
        'Analyse temporairement indisponible'
    );
    // Les autres cartes de l'analyse approfondie ne sont pas affectées.
    await expect(page.locator('#researchScoreCard')).toBeVisible();
    await expect(page.locator('#researchScoreSubs .score-sub').first()).toBeVisible();
    await expect(page.locator('#researchValuationCard')).toBeVisible();
    await expect(page.locator('#researchPeersCard')).toBeVisible();
});

test('valeur pauvre en données : les métriques absentes sont transmises au modèle', async ({
    page,
}) => {
    await bootApp(page, { ai: true, profile: 'sparse' });
    // On attend la requête au lieu de tester si elle a eu lieu : le test doit
    // échouer si l'analyse n'est plus déclenchée, pas passer silencieusement.
    const sentRequest = page.waitForRequest('**/ai/stock-analysis');

    await openResearch(page, 'MC.PA');
    await expect(page.locator('#researchAiCard')).toBeVisible();

    const sent = (await sentRequest).postDataJSON().data;
    expect(sent.nonDisponible.length).toBeGreaterThan(10);
    expect(sent.nonDisponible).toContain('ROIC (%)');
});

test('résumé du portefeuille : un événement récent daté au format FR est conservé', async ({
    page,
}) => {
    // Les dates des événements viennent du modèle : le format demandé est
    // AAAA-MM-JJ, rien ne garantit qu'il soit respecté. La fenêtre des six
    // derniers mois se comparait en texte, où « 01/08/2026 » est inférieur à
    // toute date ISO : un événement bel et bien récent était écarté.
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const dateFr = `01/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    await bootApp(page, {
        ai: true,
        insights: {
            summary: 'Résumé du mois.',
            portfolio: [
                {
                    symbol: 'AAPL',
                    items: [
                        {
                            date: dateFr,
                            title: 'Résultats trimestriels au-dessus des attentes',
                            detail: "Le chiffre d'affaires progresse de 8 % sur un an.",
                        },
                    ],
                },
            ],
        },
    });

    await page.locator('#refreshInsightsBtn').click();
    await expect(page.locator('#portfolioInsightsBody')).toContainText(
        'Résultats trimestriels au-dessus des attentes'
    );
    // Rendu des événements du modèle, et non le repli sans actualités.
    await expect(page.locator('#portfolioInsightsBody .insights-plain-note')).toHaveCount(0);
});
