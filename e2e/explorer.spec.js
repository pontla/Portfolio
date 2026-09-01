import { test, expect } from '@playwright/test';
import { bootApp, openResearch, runDeepAnalysis } from './helpers.js';

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

test('synthèse : score global, signal et sous-scores justifiés', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchScoreCard');
    await expect(card).toBeVisible();

    // score global sur 100 + signal
    const top = page.locator('#researchScoreTop');
    await expect(top.locator('.score-val')).toHaveText(/^\d{1,3}$/);
    await expect(top.locator('.score-max')).toHaveText('/ 100');
    const signal = top.locator('.score-signal');
    await expect(signal).toHaveText(/^(Achat|Conserver|Vente)$/);
    // la pondération est explicitée dans l'aide
    await expect(top.locator('.kv-help')).toHaveAttribute('data-tip', /Achat/);

    // 5 sous-scores, chacun avec sa barre et sa justification chiffrée
    const subs = page.locator('#researchScoreSubs .score-sub');
    await expect(subs).toHaveCount(5);
    await expect(page.locator('#researchScoreSubs')).toContainText('Valorisation');
    await expect(page.locator('#researchScoreSubs')).toContainText('Sentiment & technique');
    await expect(subs.locator('.score-bar i')).toHaveCount(5);
    for (const t of ['Valorisation', 'Rentabilité']) {
        const row = subs.filter({ hasText: t }).first();
        await expect(row.locator('.score-sub-val')).toContainText('/ 100');
        await expect(row.locator('.score-note')).not.toBeEmpty();
    }
    await expect(page.locator('#researchScoreSubs')).not.toContainText('NaN');

    // avertissement visible
    await expect(card.locator('.score-disclaimer')).toContainText('pas un conseil en investissement');
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

test('section Croissance : historiques annuels en barres et consensus analystes', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchGrowthCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchGrowthGrid');
    await expect(grid.locator('.research-kv')).toHaveCount(8);
    await expect(grid.locator('.research-kv-loading')).toHaveCount(0);

    // TCAC calculé depuis l'historique FMP (260 Md -> 383 Md sur 4 ans)
    await expect(grid).toContainText('TCAC CA 5 ans');
    await expect(grid).toContainText('%');
    // guidance non fournie par les sources gratuites
    await expect(grid).toContainText('Non disponible');

    // deux séries annuelles de 5 exercices, avec barres dimensionnées
    const series = page.locator('#researchGrowthSeries');
    await expect(series.locator('.gs-block')).toHaveCount(2);
    await expect(series.locator('.gs-row')).toHaveCount(10);
    await expect(series.locator('.gs-empty')).toHaveCount(0);
    const w = await series.locator('.gs-bar').first().evaluate((el) => el.getBoundingClientRect().width);
    expect(w).toBeGreaterThan(0);
    await expect(series.locator('.gs-yoy.up').first()).toBeVisible();
});

test('section Santé financière : ratios avec pastilles de risque et historique FCF', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchHealthCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchHealthGrid');
    await expect(grid.locator('.research-kv')).toHaveCount(8);
    await expect(grid.locator('.research-kv-loading')).toHaveCount(0);

    // dette nette = 108 Md − 61 Md (quoteSummary)
    await expect(grid).toContainText('Dette nette');
    await expect(grid).toContainText('47 Md');
    // dette nette/EBITDA 0,4 et couverture des intérêts 30 -> confortable ;
    // liquidité générale 1,0 -> correct ; dette nette positive -> endettée
    await expect(grid.locator('.kv-tag.ok').first()).toBeVisible();
    await expect(grid.locator('.kv-tag.mid').first()).toBeVisible();
    await expect(grid).toContainText('endettée');

    // FCF sur 5 exercices + tendance dans le titre
    const series = page.locator('#researchHealthSeries');
    await expect(series.locator('.gs-row')).toHaveCount(5);
    await expect(series.locator('.gs-title')).toContainText('Flux de trésorerie disponible');
    await expect(series.locator('.gs-empty')).toHaveCount(0);
});

test('section Rentabilité : ROIC/ROA/marges et sparklines 5 ans', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchProfitCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchProfitGrid');
    await expect(grid.locator('.research-kv')).toHaveCount(6);
    await expect(grid.locator('.research-kv-loading')).toHaveCount(0);
    await expect(grid).toContainText('ROIC');
    await expect(grid).toContainText('55,00 %');   // roicTTM 0.55 (FMP key-metrics-ttm)
    await expect(grid).toContainText('Marge brute');

    // trois courbes de marges, avec variation en points de pourcentage
    const sparks = page.locator('#researchProfitSparks');
    await expect(sparks.locator('.spark-row')).toHaveCount(3);
    await expect(sparks.locator('svg.spark polyline')).toHaveCount(3);
    await expect(sparks.locator('.spark-empty')).toHaveCount(0);
    await expect(sparks.locator('.spark-delta').first()).toContainText('pts');
});

test('section Sentiment de marché : consensus, objectifs de cours et positionnement', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchSentimentCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchSentimentGrid');
    await expect(grid.locator('.research-kv')).toHaveCount(11);
    await expect(grid.locator('.research-kv-loading')).toHaveCount(0);

    // consensus Yahoo "buy" + 38 analystes, note 2,0/5 -> pastille favorable
    await expect(grid).toContainText('Achat (38 analystes)');
    await expect(grid).toContainText('2,0 / 5');
    await expect(grid.locator('.kv-tag.ok').first()).toBeVisible();

    // objectif moyen 220 vs cours 192,5 -> potentiel +14,29 %
    await expect(grid).toContainText('$220,00');
    await expect(grid.locator('.kv-cmp.up').first()).toContainText('+14,29 %');

    // champs sans source gratuite : affichés explicitement en "Non disponible"
    await expect(grid).toContainText('Révisions d\'objectif');
    await expect(grid).toContainText('Transactions d\'initiés');
    await expect(grid.locator('.research-kv', { hasText: 'Révisions' })).toContainText('Non disponible');
    await expect(grid.locator('.research-kv', { hasText: 'Transactions' })).toContainText('Non disponible');

    // vente à découvert 0,8 % du flottant -> faible
    await expect(grid).toContainText('0,80 %');
    await expect(grid).toContainText('faible');

    // barre de consensus (37 avis) + échelle d'objectifs 170 / 220 / 260
    const top = page.locator('#researchSentimentTop');
    await expect(top.locator('.cons-seg:not(.cons-dot)')).toHaveCount(4);   // strongSell = 0 -> pas de segment
    await expect(top.locator('.cons-legend .cons-leg')).toHaveCount(4);
    await expect(top.locator('.sent-empty')).toHaveCount(0);
    await expect(top.locator('.pt-track .pt-mark.cur')).toBeVisible();
    await expect(top.locator('.pt-track .pt-mark.avg')).toBeVisible();
    await expect(top.locator('.pt-legend')).toContainText('$170,00');
    await expect(top.locator('.pt-legend')).toContainText('$260,00');
});

test('section Analyse technique : moyennes mobiles, RSI et overlay sur le graphe', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchTechCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchTechGrid');
    await expect(grid.locator('.research-kv')).toHaveCount(9);
    await expect(grid.locator('.research-kv-loading')).toHaveCount(0);
    await expect(grid).toContainText('Moyenne mobile 50 j');
    await expect(grid).toContainText('Moyenne mobile 200 j');
    await expect(grid).toContainText('RSI 14');

    // série synthétique haussière -> cours > MM50 > MM200
    await expect(grid.locator('.research-kv', { hasText: 'Tendance' })).toContainText('haussière');
    // volume 64 M vs moyenne 58 M -> 1,1 ×
    await expect(grid).toContainText('1,1 ×');
    await expect(grid).toContainText('activité normale');

    // jauge RSI + légende des moyennes mobiles
    const top = page.locator('#researchTechTop');
    await expect(top.locator('.gauge-track.rsi .gauge-mark')).toBeVisible();
    await expect(top.locator('.ma-legend .ma-leg')).toHaveCount(2);
    await expect(top.locator('.sent-empty')).toHaveCount(0);

    // le graphe de cours porte désormais 3 séries : cours + MM 50 + MM 200
    const labels = await page.evaluate(() => App.researchChart.data.datasets.map(d => d.label));
    expect(labels.slice(1)).toEqual(['MM 50', 'MM 200']);
    const filled = await page.evaluate(
        () => App.researchChart.data.datasets[2].data.filter(v => v != null).length
    );
    expect(filled).toBeGreaterThan(50);
});

test('section Dividende : rendement, distribution et historique par action', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchDivCard');
    await expect(card).toBeVisible();

    const grid = page.locator('#researchDivGrid');
    await expect(grid.locator('.research-kv')).toHaveCount(8);

    // le rendement a quitté "Données clés" pour cette section
    await expect(page.locator('#researchKeyGrid')).not.toContainText('Rendement du dividende');
    await expect(grid).toContainText('Rendement actuel');
    await expect(grid).toContainText('0,51 %');
    // 0,51 % vs 0,62 % de moyenne 5 ans
    await expect(grid.locator('.kv-cmp.dn').first()).toContainText('pts vs moyenne 5 ans');

    // payout 15 % -> soutenable ; 2 exercices complets de hausse (2021 < 2022 < 2023)
    await expect(grid).toContainText('15,00 %');
    await expect(grid).toContainText('soutenable');
    await expect(grid.locator('.research-kv', { hasText: 'Hausses consécutives' })).toContainText('2 ans');

    // 4 années civiles de versements
    const series = page.locator('#researchDivSeries');
    await expect(series.locator('.gs-row')).toHaveCount(4);
    await expect(series.locator('.gs-empty')).toHaveCount(0);
});

test('section Comparaison sectorielle : tableau des pairs avec médiane du groupe', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchPeersCard');
    await expect(card).toBeVisible();

    const table = page.locator('#researchPeersTable');
    // en-tête : Valeur + 5 métriques, chacune avec son aide contextuelle
    await expect(table.locator('thead th')).toHaveCount(6);
    await expect(table.locator('thead .kv-help.tip-below')).toHaveCount(5);

    // valeur analysée + 4 comparables + médiane
    await expect(table.locator('tbody tr')).toHaveCount(6);
    const self = table.locator('tr.self');
    await expect(self).toContainText('AAPL');
    await expect(self).toContainText('31,2 ×');

    await expect(table.locator('tbody tr', { hasText: 'MSFT' })).toContainText('35,0 ×');
    // ROE absent chez DELL -> tiret, jamais NaN
    await expect(table.locator('tbody tr', { hasText: 'DELL' })).toContainText('—');
    await expect(table).not.toContainText('NaN');

    // médiane du groupe sur les 5 valeurs
    const median = table.locator('tr.median');
    await expect(median).toContainText('Médiane');
    await expect(median).toContainText('5 valeurs');

    // seule la ligne analysée est colorée : croissance sous la médiane (8 % vs 11 %),
    // ROE très au-dessus (150,2 % vs 34,5 %)
    await expect(self.locator('td.worse')).toHaveCount(1);
    await expect(self.locator('td.better')).toHaveCount(1);
    await expect(table.locator('tbody tr:not(.self) td.better, tbody tr:not(.self) td.worse')).toHaveCount(0);

    await expect(page.locator('#researchPeersSrc')).toContainText('4 comparables');
});

test('section Profil & risques : activité, risques publiés et calendrier', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchQualCard');
    await expect(card).toBeVisible();

    const body = page.locator('#researchQualBody');
    const secs = body.locator('.qual-sec');
    await expect(secs).toHaveCount(3);   // Activité + Risques + Calendrier

    // Activité : texte de l'émetteur repris tel quel
    await expect(body).toContainText('Activité');
    await expect(body.locator('.qual-text')).toContainText('Apple Inc. conçoit, fabrique et commercialise');
    await expect(body).toContainText('161 k salariés');

    // Risques : bêta 1,24 -> plus volatil ; gouvernance 1..10 avec pastilles
    const risk = secs.filter({ hasText: 'Risques' });
    await expect(risk.locator('.research-kv', { hasText: 'Volatilité (bêta)' })).toContainText('1,24');
    await expect(risk.locator('.research-kv', { hasText: 'Volatilité (bêta)' }).locator('.kv-tag')).toHaveText('plus volatil');
    await expect(risk.locator('.research-kv', { hasText: 'Gouvernance (global)' })).toContainText('1 / 10');
    await expect(risk.locator('.research-kv', { hasText: 'Audit' }).locator('.kv-tag')).toHaveText('élevé');
    await expect(risk.locator('.research-kv', { hasText: 'Rémunération des dirigeants' }).locator('.kv-tag')).toHaveText('modéré');

    // Calendrier : la date de résultats a quitté "À propos" pour cette section
    await expect(page.locator('#researchAboutGrid')).not.toContainText('Prochains résultats');
    const cal = secs.filter({ hasText: 'Calendrier' });
    await expect(cal.locator('.research-kv', { hasText: 'Prochains résultats' })).toContainText('après clôture');
    await expect(cal.locator('.research-kv', { hasText: 'BPA attendu' })).toContainText('$1,90');
    await expect(cal.locator('.research-kv', { hasText: 'CA attendu' })).toContainText('$89 Md');
    await expect(cal.locator('.research-kv', { hasText: 'Détachement du dividende' })).not.toContainText('Non disponible');

    // chaque métrique porte son aide contextuelle
    await expect(body.locator('.kv-help').first()).toHaveAttribute('data-tip', /.+/);
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

test('analyse approfondie : aucun appel FMP avant le clic sur le bouton', async ({ page }) => {
    const fmpCalls = [];
    await page.route('**/fmp?**', (route) => {
        fmpCalls.push(route.request().url());
        return route.continue();
    });

    await openResearch(page, 'AAPL', { deep: false });

    // Sections rapides servies, analyse approfondie en attente d'une action.
    await expect(page.locator('#researchKeyGrid .research-kv').first()).toBeVisible();
    await expect(page.locator('#researchDeepCard')).toBeVisible();
    await expect(page.locator('#researchScoreCard')).toBeHidden();
    await expect(page.locator('#researchValuationCard')).toBeHidden();
    expect(fmpCalls).toHaveLength(0);

    await runDeepAnalysis(page);

    await expect(page.locator('#researchScoreCard')).toBeVisible();
    await expect(page.locator('#researchValuationCard')).toBeVisible();
    await expect(page.locator('#researchDeepCard')).toBeHidden();
    expect(fmpCalls.length).toBeGreaterThan(0);
});

test('analyse IA : sans clé IA, la carte invite à en configurer une', async ({ page }) => {
    await openResearch(page, 'AAPL');

    const card = page.locator('#researchAiCard');
    await expect(card).toBeVisible();
    await expect(card.locator('.insights-plain-note')).toContainText(/clé IA/i);
    await expect(page.locator('#researchAiRefreshBtn')).toBeHidden();
    await expect(page.locator('#researchAiUpdated')).toHaveText('');
});
