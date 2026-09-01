// Parcours du tableau de bord : transactions, portefeuilles, filtres, reglages.
// Ces ecrans sont ceux que `setupEventListeners` cable ; ils n'avaient aucune
// couverture end-to-end.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await bootApp(page);
});

/** Ouvre un onglet de la nav (sous-nav desktop, nav basse ou menu lateral). */
async function goToTab(page, tab) {
    await page.locator(`button[data-tab="${tab}"]:visible`).first().click();
    await page.locator(`#view-${tab}`).waitFor({ state: 'visible' });
}

/** Ouvre la modale de transaction et attend qu'elle soit prete. */
async function openTransactionModal(page) {
    await page.locator('#addTransactionBtn:visible, #addTransactionFab:visible').first().click();
    await expect(page.locator('#transactionModal')).toHaveClass(/open/);
}

// ---------------------------------------------------------------------------
// Modale de transaction : formulaire dynamique + enregistrement
// ---------------------------------------------------------------------------

test.describe('modale de transaction', () => {
    test('ouverture : titre, date du jour et portefeuille actif pre-remplis', async ({ page }) => {
        await openTransactionModal(page);

        await expect(page.locator('#transactionModalTitle')).toHaveText('Nouvelle Transaction');
        const today = new Date();
        const iso = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0'),
        ].join('-');
        await expect(page.locator('#transactionForm input[name="date"]')).toHaveValue(iso);
        await expect(page.locator('#transactionForm input[name="type"]:checked')).toHaveValue(
            'BUY'
        );
        await expect(page.locator('#targetPortfolioSelect')).toHaveValue('e2e-pf');
    });

    test('le type pilote les champs affiches (achat / depot / dividende)', async ({ page }) => {
        await openTransactionModal(page);

        // Achat : symbole + quantite/prix, pas de montant global.
        await expect(page.locator('#symbolGroup')).toBeVisible();
        await expect(page.locator('#qtyPriceRow')).toBeVisible();
        await expect(page.locator('#amountGroup')).toBeHidden();

        // Depot : montant seul, ni symbole ni quantite.
        await page.locator('#transactionForm input[name="type"][value="DEPOSIT"]').check();
        await expect(page.locator('#amountGroup')).toBeVisible();
        await expect(page.locator('#qtyPriceRow')).toBeHidden();
        await expect(page.locator('#symbolGroup')).toBeHidden();
        await expect(page.locator('#amountLabel')).toHaveText('Montant du dépôt ($)');

        // Dividende : symbole concerne + montant, sans quantite/prix.
        await page.locator('#transactionForm input[name="type"][value="DIVIDEND"]').check();
        await expect(page.locator('#symbolGroup')).toBeVisible();
        await expect(page.locator('#amountGroup')).toBeVisible();
        await expect(page.locator('#qtyPriceRow')).toBeHidden();
        await expect(page.locator('#amountLabel')).toHaveText('Montant du dividende net ($)');

        // Retour a l'achat : l'etat initial est restaure.
        await page.locator('#transactionForm input[name="type"][value="BUY"]').check();
        await expect(page.locator('#qtyPriceRow')).toBeVisible();
        await expect(page.locator('#amountGroup')).toBeHidden();
    });

    test('enregistrer un achat ajoute la ligne et met a jour les positions', async ({ page }) => {
        await goToTab(page, 'holdings');
        await expect(page.locator('#holdingsTableBody tr')).toHaveCount(1);

        await openTransactionModal(page);
        await page.locator('#symbolInputField').fill('MSFT');
        await page.locator('#qtyInputField').fill('4');
        await page.locator('#priceInputField').fill('300');
        await page.locator('#transactionForm button[type="submit"]').click();

        await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);
        await expect(page.locator('#holdingsTableBody tr')).toHaveCount(2);
        await expect(page.locator('#holdingsTableBody')).toContainText('MSFT');

        await goToTab(page, 'transactions');
        await expect(page.locator('#transactionsTableBody')).toContainText('MSFT');
    });

    test('un depot alimente le cash de la carte de synthese', async ({ page }) => {
        const cashLine = page.locator('#statsGrid .stat-card').first();
        const before = await cashLine.textContent();

        await openTransactionModal(page);
        await page.locator('#transactionForm input[name="type"][value="DEPOSIT"]').check();
        await page.locator('#amountInputField').fill('2500');
        await page.locator('#transactionForm button[type="submit"]').click();

        await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);
        await expect(cashLine).not.toHaveText(before ?? '');
        await expect(cashLine).toContainText('Cash');
    });

    test('la recherche de symbole remplit le champ depuis la liste', async ({ page }) => {
        await openTransactionModal(page);
        await page.locator('#symbolInputField').click();
        await expect(page.locator('#symbolSearchModal')).toHaveClass(/open/);

        await page.locator('#globalSearchInput').fill('MSFT');
        const row = page.locator('#searchResultsList .search-result-row').first();
        await row.waitFor();
        await row.click();

        await expect(page.locator('#symbolSearchModal')).not.toHaveClass(/open/);
        await expect(page.locator('#symbolInputField')).toHaveValue('MSFT');
    });
});

// ---------------------------------------------------------------------------
// Actions deleguees : edition, suppression, vente rapide
// ---------------------------------------------------------------------------

test.describe('actions sur les lignes existantes', () => {
    test('modifier une transaction pre-remplit la modale avec ses valeurs', async ({ page }) => {
        await goToTab(page, 'transactions');
        await page.locator('#transactionsTableBody .edit-trade-btn').first().click();

        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
        await expect(page.locator('#transactionModalTitle')).toHaveText('Modifier la transaction');
        await expect(page.locator('#transactionForm input[name="type"]:checked')).toHaveValue(
            'BUY'
        );
        await expect(page.locator('#symbolInputField')).toHaveValue('AAPL');
        await expect(page.locator('#qtyInputField')).toHaveValue('10');
        await expect(page.locator('#priceInputField')).toHaveValue('150');
        await expect(page.locator('#transactionForm input[name="date"]')).toHaveValue('2024-02-01');
    });

    test('supprimer une transaction apres confirmation vide la liste', async ({ page }) => {
        page.on('dialog', (d) => d.accept());
        await goToTab(page, 'transactions');
        await expect(page.locator('#transactionsTableBody tr')).toHaveCount(1);

        await page.locator('#transactionsTableBody .delete-trade-btn').first().click();
        await expect(page.locator('#transactionsTableBody')).toContainText('Aucune transaction');
    });

    test('refuser la confirmation conserve la transaction', async ({ page }) => {
        page.on('dialog', (d) => d.dismiss());
        await goToTab(page, 'transactions');

        await page.locator('#transactionsTableBody .delete-trade-btn').first().click();
        await expect(page.locator('#transactionsTableBody tr')).toHaveCount(1);
        await expect(page.locator('#transactionsTableBody')).toContainText('AAPL');
    });

    test('vente rapide depuis une position pre-remplit une vente', async ({ page }) => {
        await goToTab(page, 'holdings');
        await page.locator('#holdingsTableBody .quick-sell-btn').first().click();

        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
        await expect(page.locator('#transactionModalTitle')).toHaveText('Vendre AAPL');
        await expect(page.locator('#transactionForm input[name="type"]:checked')).toHaveValue(
            'SELL'
        );
        await expect(page.locator('#symbolInputField')).toHaveValue('AAPL');
        await expect(page.locator('#qtyInputField')).toHaveValue('10');
    });

    test('cliquer sur le nom d une position ouvre l Explorer', async ({ page }) => {
        await goToTab(page, 'holdings');
        await page.locator('#holdingsTableBody .holding-asset-cell').first().click();

        await expect(page.locator('#view-research')).toBeVisible();
        await expect(page.locator('#researchSymbol')).toContainText('AAPL');
    });
});

// ---------------------------------------------------------------------------
// Switcher de portefeuille
// ---------------------------------------------------------------------------

test.describe('portefeuilles', () => {
    test('le switcher liste le portefeuille et l option consolidee', async ({ page }) => {
        await page.locator('#portfolioSwitcherBtn').click();
        await expect(page.locator('#portfolioDropdownContainer')).toHaveClass(/open/);
        await expect(page.locator('#globalPortfolioItem')).toBeVisible();
        await expect(page.locator('#portfolioDropdownList')).toContainText('Portefeuille E2E');
    });

    test('creer un portefeuille le rend actif', async ({ page }) => {
        await page.locator('#portfolioSwitcherBtn').click();
        await page.locator('#openCreatePortfolioBtn').click();

        await expect(page.locator('#portfolioModal')).toHaveClass(/open/);
        await expect(page.locator('#portfolioModalTitle')).toHaveText('Nouveau Portefeuille');
        await page.locator('#portfolioNameInput').fill('Crypto');
        await page.locator('#portfolioForm button[type="submit"]').click();

        await expect(page.locator('#portfolioModal')).not.toHaveClass(/open/);
        await expect(page.locator('#appTitle')).toHaveText('Crypto');
    });

    test('editer un portefeuille pre-remplit nom et couleur', async ({ page }) => {
        await page.locator('#portfolioSwitcherBtn').click();
        await page.locator('#portfolioDropdownList .edit-portfolio-btn').first().click();

        await expect(page.locator('#portfolioModal')).toHaveClass(/open/);
        await expect(page.locator('#portfolioModalTitle')).toHaveText('Modifier le portefeuille');
        await expect(page.locator('#portfolioNameInput')).toHaveValue('Portefeuille E2E');
        await expect(page.locator('#portfolioSubmitBtn')).toHaveText('Sauvegarder');
        await expect(page.locator('input[name="portfolioColor"]:checked')).toHaveValue('#3b82f6');
    });

    test('aucun bouton de suppression quand il ne reste qu un portefeuille', async ({ page }) => {
        await page.locator('#portfolioSwitcherBtn').click();
        await expect(page.locator('#portfolioDropdownList .edit-portfolio-btn')).toHaveCount(1);
        await expect(page.locator('#portfolioDropdownList .delete-portfolio-btn')).toHaveCount(0);
    });

    test('supprimer un portefeuille apres en avoir cree un second', async ({ page }) => {
        page.on('dialog', (d) => d.accept());

        // Un second portefeuille fait apparaitre les boutons de suppression.
        await page.locator('#portfolioSwitcherBtn').click();
        await page.locator('#openCreatePortfolioBtn').click();
        await page.locator('#portfolioNameInput').fill('Crypto');
        await page.locator('#portfolioForm button[type="submit"]').click();
        await expect(page.locator('#appTitle')).toHaveText('Crypto');

        await page.locator('#portfolioSwitcherBtn').click();
        await expect(page.locator('#portfolioDropdownList .delete-portfolio-btn')).toHaveCount(2);

        await page.locator('#portfolioDropdownList .delete-portfolio-btn').last().click();
        await expect(page.locator('#portfolioDropdownList .delete-portfolio-btn')).toHaveCount(0);
        await expect(page.locator('#portfolioDropdownList')).not.toContainText('Crypto');
    });

    test('basculer sur la vue consolidee change le titre', async ({ page }) => {
        await page.locator('#portfolioSwitcherBtn').click();
        await page.locator('#globalPortfolioItem').click();

        await expect(page.locator('#portfolioDropdownContainer')).not.toHaveClass(/open/);
        await expect(page.locator('#appTitle')).toContainText('Global');
    });
});

// ---------------------------------------------------------------------------
// Filtres de transactions
// ---------------------------------------------------------------------------

test.describe('filtres de transactions', () => {
    test('la recherche filtre sur le symbole', async ({ page }) => {
        await goToTab(page, 'transactions');
        await expect(page.locator('#transactionsTableBody tr')).toHaveCount(1);

        await page.locator('#txSearchInput').fill('ZZZZ');
        await expect(page.locator('#transactionsTableBody')).toContainText('Aucune transaction');

        await page.locator('#txSearchInput').fill('AAPL');
        await expect(page.locator('#transactionsTableBody tr')).toHaveCount(1);
    });

    test('le filtre par type exclut les operations non retenues', async ({ page }) => {
        await goToTab(page, 'transactions');
        await page.locator('#txFilterOpenBtn').click();
        await expect(page.locator('#txFilterModal')).toHaveClass(/open/);

        await page.locator('#txTypePills button[data-type="DIVIDEND"]').click();
        await page.locator('#txApplyBtn').click();

        await expect(page.locator('#txFilterModal')).not.toHaveClass(/open/);
        await expect(page.locator('#transactionsTableBody')).toContainText('Aucune transaction');

        await page.locator('#txFilterOpenBtn').click();
        await page.locator('#txFilterResetBtn').click();
        await expect(page.locator('#transactionsTableBody tr')).toHaveCount(1);
    });
});

// ---------------------------------------------------------------------------
// Reglages
// ---------------------------------------------------------------------------

test.describe('reglages', () => {
    test.beforeEach(async ({ page }) => {
        await page.locator('#settingsBtn').click();
        await expect(page.locator('#settingsModal')).toHaveClass(/open/);
    });

    test('le champ de cle IA reste inactif tant qu aucun fournisseur n est choisi', async ({
        page,
    }) => {
        await expect(page.locator('#aiKeyInput')).toBeDisabled();

        await page.locator('#aiProviderSelect').selectOption('anthropic');
        await expect(page.locator('#aiKeyInput')).toBeEnabled();
        await expect(page.locator('#aiKeyInput')).toHaveAttribute('placeholder', /sk-ant/);
    });

    test('export CSV : telecharge un fichier contenant la transaction', async ({ page }) => {
        const download = page.waitForEvent('download');
        await page.locator('#exportCsvBtn').click();
        const file = await download;

        expect(file.suggestedFilename()).toMatch(/\.csv$/);
        const stream = await file.createReadStream();
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const csv = Buffer.concat(chunks).toString('utf8');
        expect(csv).toContain('date;type;symbol');
        expect(csv).toContain('AAPL');
    });

    test('modele CSV : telecharge un gabarit avec l en-tete attendu', async ({ page }) => {
        const download = page.waitForEvent('download');
        await page.locator('#downloadTemplateBtn').click();
        const file = await download;

        const stream = await file.createReadStream();
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        expect(Buffer.concat(chunks).toString('utf8')).toContain('date;type;symbol');
    });

    test('le theme clair est applique et memorise', async ({ page }) => {
        await page.locator('#themeSegmented button[data-theme-choice="light"]').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

        await page.locator('#themeSegmented button[data-theme-choice="dark"]').click();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
    });
});

// ---------------------------------------------------------------------------
// Controles du graphique et navigation
// ---------------------------------------------------------------------------

test.describe('controles de la vue d ensemble', () => {
    test('la bascule de devise change le libelle des montants', async ({ page }) => {
        const stat = page.locator('#statsGrid .stat-value').first();
        // La preference est persistee, avec EUR par defaut : on part de l'etat reel.
        const active = page.locator('#currencyToggle button.active');
        await expect(active).toHaveCount(1);
        const from = await active.getAttribute('data-currency');
        const to = from === 'EUR' ? 'USD' : 'EUR';
        await expect(stat).toContainText(from === 'EUR' ? '€' : '$');

        const target = page.locator('#currencyToggle button[data-currency="' + to + '"]');
        await target.click();
        await expect(target).toHaveClass(/active/);
        await expect(stat).toContainText(to === 'EUR' ? '€' : '$');
    });

    test('les boutons de periode marquent la plage active', async ({ page }) => {
        const btn = page.locator('#timeRangeSelector .range-btn[data-range="1M"]');
        await btn.click();
        await expect(btn).toHaveClass(/active/);
        await expect(page.locator('#timeRangeSelector .range-btn.active')).toHaveCount(1);
    });

    test('la navigation par onglets synchronise les trois barres', async ({ page }) => {
        await goToTab(page, 'analysis');
        await expect(page.locator('#view-analysis')).toBeVisible();
        await expect(page.locator('#view-overview')).toBeHidden();
        await expect(page.locator('.tab-btn.active[data-tab="analysis"]')).toHaveCount(3);
    });
});

// ---------------------------------------------------------------------------
// Qualite des donnees de marche : ne jamais presenter un montant invente
// comme un montant reel.
// ---------------------------------------------------------------------------

test.describe('cours indisponible', () => {
    /**
     * Coupe le proxy de cotation, puis relance le rafraichissement des prix.
     *
     * Un `page.reload()` serait plus fidele mais impossible ici : la balise
     * <script> du SDK Supabase porte un hash SRI, que le stub du harnais ne
     * satisfait pas au second chargement. On repasse donc par le chemin de
     * production reel — refreshPrices() puis render() — sans recharger.
     */
    async function withoutQuotes(page) {
        await page.route('**/quote?**', (route) =>
            route.fulfill({
                status: 502,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'proxy injoignable' }),
            })
        );
        await page.evaluate(async () => {
            // Le cache de cotations garde 5 minutes le dernier cours reel : on le
            // vide pour que la panne soit visible immediatement.
            // Chemin construit a l'execution : le module est resolu par le
            // navigateur, pas par tsc (qui ne connait pas la racine du serveur).
            const modulePath = ['', 'js', 'core', 'api.js'].join('/');
            const api = (await import(modulePath)).APIService;
            api.quoteCache = {};
            api.cachedFxRates = {};
            api.fxEstimated = {};
            await window.App.service.refreshPrices();
            await window.App.render();
        });
    }

    test('un avertissement nomme la valeur concernee', async ({ page }) => {
        await withoutQuotes(page);

        const notice = page.locator('#dataNotice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('AAPL');
        await expect(notice).toContainText('prix de revient');
    });

    test('la plus-value latente n est pas chiffree a zero', async ({ page }) => {
        await withoutQuotes(page);
        await goToTab(page, 'holdings');

        // Avant correction : un cours code en dur de 2024 produisait une
        // plus-value chiffree, presentee comme reelle. Elle est inconnue.
        const gainCell = page.locator('#holdingsTableBody td[data-label="+/- Latente"]').first();
        await expect(gainCell).toContainText('cours indisponible');
        await expect(gainCell).not.toContainText('%');
    });

    test('le cours affiche est le prix de revient, signale comme tel', async ({ page }) => {
        await withoutQuotes(page);
        await goToTab(page, 'holdings');

        const priceCell = page.locator('#holdingsTableBody td[data-label="Prix Actuel"]').first();
        await expect(priceCell).toHaveClass(/price-stale/);
        // Le PRU de la fixture est de 150 : c'est ce qui doit s'afficher, pas 225,50.
        await expect(priceCell).toContainText('150');
        await expect(priceCell).not.toContainText('225');
    });

    test('cours disponibles : aucun avertissement', async ({ page }) => {
        await expect(page.locator('#statsGrid .stat-value').first()).toBeVisible();
        await expect(page.locator('#dataNotice')).toBeHidden();

        await goToTab(page, 'holdings');
        const priceCell = page.locator('#holdingsTableBody td[data-label="Prix Actuel"]').first();
        await expect(priceCell).not.toHaveClass(/price-stale/);
    });
});
