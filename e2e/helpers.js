// Harnais E2E : neutralise Supabase (auth + données) et le worker proxy de marché,
// pour que l'app démarre connectée avec un portefeuille vide et des données de marché
// déterministes, sans aucun appel réseau réel.

const FAKE_SESSION = {
    access_token: 'e2e.header.payload',
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800, // 2100-01-01
    user: { id: 'e2e-user', email: 'e2e@example.test' },
};

const FUNDAMENTALS = {
    symbol: 'AAPL',
    name: 'Apple Inc',
    price: 192.5,
    previousClose: 190,
    currency: 'USD',
    exchange: 'NASDAQ',
    marketCap: 3000000,
    peTTM: 31.2,
    epsTTM: 6.16,
    dividendYield: 0.51,
    beta: 1.24,
    pbAnnual: 45.1,
    psTTM: 7.8,
    roeTTM: 150.2,
    netMarginTTM: 25.3,
    revenueGrowthTTM: 0.08,
    volume: 51000000,
    fiftyTwoWeekLow: 150,
    fiftyTwoWeekHigh: 210,
    fundamentalsSource: 'finnhub',
    industry: 'Technology',
    country: 'US',
    ipo: '1980-12-12',
    weburl: 'https://www.apple.com',
};

// Sortie deja normalisee du worker /quoteSummary (cf. normalizeQuoteSummary).
const QUOTE_SUMMARY = {
    symbol: 'AAPL',
    source: 'yahoo-quoteSummary',
    name: 'Apple Inc',
    currency: 'USD',
    exchange: 'NasdaqGS',
    price: 192.5,
    previousClose: 190,
    marketCap: 3000000000000,
    peTrailing: 31.2,
    peForward: 27.4,
    pegRatio: 2.3,
    priceToBook: 44.0,
    priceToSales: 7.6,
    enterpriseToEbitda: 22.1,
    enterpriseToRevenue: 7.1,
    trailingEps: 6.16,
    forwardEps: 7.1,
    ebitda: 130000000000,
    freeCashflow: 99000000000,
    totalCash: 61000000000,
    totalDebt: 108000000000,
    currentRatio: 0.99,
    quickRatio: 0.85,
    debtToEquity: 140,
    returnOnEquity: 1.5,
    returnOnAssets: 0.28,
    grossMargins: 0.46,
    operatingMargins: 0.3,
    profitMargins: 0.25,
    revenueGrowth: 0.08,
    earningsGrowth: 0.11,
    dividendYield: 0.005,
    dividendRate: 0.96,
    payoutRatio: 0.15,
    fiveYearAvgDividendYield: 0.62,
    exDividendDate: '2025-08-11',
    beta: 1.24,
    fiftyTwoWeekHigh: 210,
    fiftyTwoWeekLow: 150,
    fiftyDayAverage: 195,
    twoHundredDayAverage: 185,
    regularMarketVolume: 64000000,
    averageVolume: 58000000,
    averageVolume10Days: 61000000,
    sharesOutstanding: 15500000000,
    floatShares: 15400000000,
    sharesShort: 120000000,
    shortRatio: 1.5,
    shortPercentOfFloat: 0.008,
    heldPercentInstitutions: 0.61,
    heldPercentInsiders: 0.0007,
    targetMeanPrice: 220,
    targetLowPrice: 170,
    targetHighPrice: 260,
    targetMedianPrice: 225,
    recommendationMean: 2.0,
    recommendationKey: 'buy',
    numberOfAnalystOpinions: 38,
    recommendationTrend: { strongBuy: 12, buy: 18, hold: 6, sell: 1, strongSell: 0 },
    estimates: [
        { period: '0q', endDate: '2025-06-30', epsAvg: 1.9, revenueAvg: 89000000000, analysts: 24 },
        {
            period: '+1q',
            endDate: '2025-09-30',
            epsAvg: 2.1,
            revenueAvg: 95000000000,
            analysts: 25,
        },
    ],
    sector: 'Technology',
    industry: 'Consumer Electronics',
    country: 'United States',
    website: 'https://www.apple.com',
    fullTimeEmployees: 161000,
    longBusinessSummary:
        'Apple Inc. conçoit, fabrique et commercialise des smartphones, ordinateurs et services.',
    governance: { overall: 1, audit: 7, board: 1, compensation: 5, shareholderRights: 1 },
};

// Comparables : seules les metriques du tableau sectoriel varient d'un pair a
// l'autre, le reste reprend QUOTE_SUMMARY.
const PEER_SUMMARY = {
    MSFT: {
        symbol: 'MSFT',
        name: 'Microsoft',
        marketCap: 3.1e12,
        peTrailing: 35,
        profitMargins: 0.36,
        revenueGrowth: 0.16,
        returnOnEquity: 0.39,
    },
    GOOGL: {
        symbol: 'GOOGL',
        name: 'Alphabet',
        marketCap: 2.1e12,
        peTrailing: 24,
        profitMargins: 0.28,
        revenueGrowth: 0.14,
        returnOnEquity: 0.3,
    },
    AMZN: {
        symbol: 'AMZN',
        name: 'Amazon',
        marketCap: 1.9e12,
        peTrailing: 40,
        profitMargins: 0.08,
        revenueGrowth: 0.11,
        returnOnEquity: 0.2,
    },
    DELL: {
        symbol: 'DELL',
        name: 'Dell Technologies',
        marketCap: 8.5e10,
        peTrailing: 18,
        profitMargins: 0.04,
        revenueGrowth: 0.02,
        returnOnEquity: null,
    },
};

// Reponses FMP par ressource (tableaux du plus recent au plus ancien, comme l'API).
const FMP = {
    profile: [
        {
            companyName: 'Apple Inc.',
            sector: 'Technology',
            industry: 'Consumer Electronics',
            country: 'US',
            website: 'https://www.apple.com',
            ipoDate: '1980-12-12',
            mktCap: 3000000000000,
            exchangeShortName: 'NASDAQ',
            fullTimeEmployees: 161000,
            description:
                'Apple Inc. conçoit et vend des produits électroniques grand public et des services.',
        },
    ],
    ratios: [
        {
            calendarYear: '2023',
            priceEarningsRatio: 29,
            priceToBookRatio: 40,
            priceToSalesRatio: 7.0,
            enterpriseValueMultiple: 21,
            grossProfitMargin: 0.45,
            operatingProfitMargin: 0.29,
            netProfitMargin: 0.25,
            currentRatio: 1.0,
            quickRatio: 0.9,
            debtEquityRatio: 1.5,
            interestCoverage: 30,
            netDebtToEBITDA: 0.4,
            payoutRatio: 0.15,
        },
        {
            calendarYear: '2022',
            priceEarningsRatio: 25,
            priceToBookRatio: 35,
            priceToSalesRatio: 6.2,
            enterpriseValueMultiple: 19,
            grossProfitMargin: 0.43,
            operatingProfitMargin: 0.3,
            netProfitMargin: 0.25,
        },
        {
            calendarYear: '2021',
            priceEarningsRatio: 27,
            priceToBookRatio: 33,
            priceToSalesRatio: 6.8,
            enterpriseValueMultiple: 20,
            grossProfitMargin: 0.42,
            operatingProfitMargin: 0.3,
            netProfitMargin: 0.26,
        },
        {
            calendarYear: '2020',
            priceEarningsRatio: 33,
            priceToBookRatio: 30,
            priceToSalesRatio: 7.4,
            enterpriseValueMultiple: 24,
            grossProfitMargin: 0.38,
            operatingProfitMargin: 0.24,
            netProfitMargin: 0.21,
        },
        {
            calendarYear: '2019',
            priceEarningsRatio: 22,
            priceToBookRatio: 12,
            priceToSalesRatio: 4.4,
            enterpriseValueMultiple: 16,
            grossProfitMargin: 0.38,
            operatingProfitMargin: 0.25,
            netProfitMargin: 0.21,
        },
    ],
    income: [
        { calendarYear: '2023', revenue: 383000000000, eps: 6.13 },
        { calendarYear: '2022', revenue: 394000000000, eps: 6.11 },
        { calendarYear: '2021', revenue: 365000000000, eps: 5.61 },
        { calendarYear: '2020', revenue: 274000000000, eps: 3.28 },
        { calendarYear: '2019', revenue: 260000000000, eps: 2.97 },
    ],
    cashflow: [
        { calendarYear: '2023', freeCashFlow: 99000000000 },
        { calendarYear: '2022', freeCashFlow: 111000000000 },
        { calendarYear: '2021', freeCashFlow: 92000000000 },
        { calendarYear: '2020', freeCashFlow: 73000000000 },
        { calendarYear: '2019', freeCashFlow: 58000000000 },
    ],
    keyMetricsTtm: [
        {
            roicTTM: 0.55,
            freeCashFlowYieldTTM: 0.033,
            enterpriseValueOverEBITDATTM: 22.5,
            netDebtToEBITDATTM: 0.4,
        },
    ],
    ratiosTtm: [
        {
            peRatioTTM: 31.2,
            pegRatioTTM: 2.3,
            returnOnEquityTTM: 1.5,
            returnOnAssetsTTM: 0.28,
            dividendYieldTTM: 0.005,
            payoutRatioTTM: 0.15,
            currentRatioTTM: 0.99,
            quickRatioTTM: 0.85,
            interestCoverageTTM: 30,
        },
    ],
    estimates: [
        {
            date: '2024-12-31',
            estimatedRevenueAvg: 400000000000,
            estimatedEpsAvg: 6.7,
            numberAnalystsEstimatedEps: 28,
        },
    ],
    peers: [{ symbol: 'AAPL', peersList: ['MSFT', 'GOOGL', 'AMZN', 'DELL'] }],
    dcf: { symbol: 'AAPL', date: '2024-01-01', dcf: 180, 'Stock Price': 192.5 },
};

function buildHistory(fromStr, toStr) {
    const out = {};
    const from = new Date(fromStr);
    const to = new Date(toStr);
    let price = 80;
    // Pas quotidien sur les fenêtres courtes (moyennes mobiles / RSI calculables),
    // hebdomadaire au-delà de ~3 ans pour ne pas générer des milliers de points.
    const step = (to.getTime() - from.getTime()) / 86400000 > 1200 ? 7 : 1;
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + step)) {
        price += Math.sin(d.getTime() / 6e9) * 4 + 1.5;
        out[d.toISOString().slice(0, 10)] = Math.round(price * 100) / 100;
    }
    return out;
}

// Texte d'analyse IA servi par le mock /ai/stock-analysis : forme realiste
// (paragraphes separes par une ligne vide), assez long pour declencher la
// troncature « Afficher plus ».
const AI_ANALYSIS_TEXT = [
    "Apple Inc. presente un profil de societe tres rentable dont la valorisation reste exigeante, ce qui justifie un signal Conserver plutot qu'un signal d'achat.",
    'Sur la valorisation, le PER de 31,2 fois se situe au-dessus de sa moyenne des cinq dernieres annees et le VE/EBITDA de 22,1 fois confirme une prime de marche. Le rendement du free cash-flow de 3,3 % reste le point le plus favorable de cette dimension.',
    "La croissance est moderee : le chiffre d'affaires progresse de 8 % sur un an et le benefice par action de 11 %, des rythmes soutenus mais inferieurs a la prime payee sur le titre.",
    "La sante financiere est solide, avec une dette nette representant 0,4 fois l'EBITDA et des interets couverts 30 fois. La liquidite generale, a 0,99 fois, reste le seul point de vigilance de cette dimension.",
    'La rentabilite est le point fort du dossier : un ROE de 150 %, un ROIC de 55 % et une marge nette de 25 % traduisent une efficacite du capital nettement superieure a la moyenne.',
    'Du cote du sentiment, le consensus des analystes ressort a 2,0 sur 5 pour 38 suivis, avec un objectif moyen superieur au cours actuel, dans une tendance de moyennes mobiles orientee a la hausse.',
    "Au total, la qualite economique et la solidite du bilan s'opposent a une valorisation deja genereuse et a une croissance moderee. L'analyse reste par ailleurs limitee par les metriques non disponibles pour cette valeur, qui n'ont pas pu etre prises en compte.",
].join('\n\n');

const SUPABASE_STUB = `
window.supabase = {
  createClient: function () {
    var S = ${JSON.stringify(FAKE_SESSION)};
    var DATA = {
      portfolios: [{ id: 'e2e-pf', name: 'Portefeuille E2E', color: '#3b82f6', created_at: '2024-01-01T00:00:00Z' }],
      trades: [{
        id: 'e2e-t1', portfolio_id: 'e2e-pf', type: 'BUY', symbol: 'AAPL',
        qty: 10, price: 150, amount: 1500, fees: 0, fx_rate: null, date: '__TRADE_DATE__'
      }],
      user_settings: __USER_SETTINGS__
    };
    var seq = 0;
    // Les insertions renvoient la ligne ecrite (avec un id) : c'est ce que
    // PortfolioService attend de .insert().select().single() pour alimenter son
    // etat en memoire. Les update/delete se contentent de { error: null }.
    function builder(table) {
      var rows = DATA[table] || [];
      var pending = null;
      var b = {
        select: function () { return b; }, order: function () { return b; },
        eq: function () { return b; }, limit: function () { return b; },
        insert: function (payload) { pending = payload; return b; },
        update: function () { return b; },
        delete: function () { return b; }, upsert: function () { return b; },
        single: function () {
          if (pending) {
            var one = Array.isArray(pending) ? pending[0] : pending;
            var row = Object.assign({ id: table + '-new-' + (++seq), created_at: '2024-06-01T00:00:00Z' }, one);
            pending = null;
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        maybeSingle: function () { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then: function (res, rej) {
          if (pending) {
            var list = (Array.isArray(pending) ? pending : [pending]).map(function (one) {
              return Object.assign({ id: table + '-new-' + (++seq), created_at: '2024-06-01T00:00:00Z' }, one);
            });
            pending = null;
            return Promise.resolve({ data: list, error: null }).then(res, rej);
          }
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        }
      };
      return b;
    }
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: S }, error: null }); },
        refreshSession: function () { return Promise.resolve({ data: { session: S }, error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function () { return Promise.resolve({ data: { session: S, user: S.user }, error: null }); },
        signUp: function () { return Promise.resolve({ data: { user: S.user }, error: null }); },
        signOut: function () { return Promise.resolve({ error: null }); },
        updateUser: function () { return Promise.resolve({ data: { user: S.user }, error: null }); },
        resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: null }); }
      },
      from: builder
    };
  }
};
`;

/**
 * Installe tous les mocks réseau puis ouvre l'app déjà "connectée".
 * @param {import('@playwright/test').Page} page
 * @param {{ profile?: string, ai?: boolean, tradeDate?: string, insights?: any }} [opts]
 */
export async function bootApp(page, opts = {}) {
    // Profils de données utilisés par les vérifications finales (phase 12) :
    //   'full'   : action US complète (défaut, toutes les sources répondent)
    //   'sparse' : valeur hors périmètre fondamental (place européenne)
    //   'nodiv'  : action US qui ne verse aucun dividende
    const profile = opts.profile || 'full';
    // `ai` : simule un compte ayant enregistre une cle IA (analyse redigee active).
    const userSettings = opts.ai
        ? [
              {
                  user_id: 'e2e-user',
                  ai_provider: 'anthropic',
                  ai_providers_configured: ['anthropic'],
              },
          ]
        : [];
    // `tradeDate` : ecriture de la date de la transaction seedee. Le defaut est
    // canonique ; un test peut passer une autre ecriture du meme jour
    // ('2024-2-1') pour verifier que le chargement la normalise.
    const supabaseStub = SUPABASE_STUB.replace(
        '__USER_SETTINGS__',
        JSON.stringify(userSettings)
    ).replace('__TRADE_DATE__', opts.tradeDate || '2024-02-01');

    // 1. Remplace le SDK Supabase (CDN) par un stub local.
    await page.route(/@supabase\/supabase-js/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: supabaseStub })
    );

    // 2. Intercepte le worker proxy de données de marché.
    await page.route(/fragrant-band-1476\.[^/]*\.workers\.dev/, async (route) => {
        const url = new URL(route.request().url());
        const p = url.pathname;
        const json = (body) =>
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

        if (p.endsWith('/search')) {
            const q = (url.searchParams.get('q') || 'AAPL').toUpperCase();
            return json([
                {
                    displaySymbol: q,
                    symbol: q,
                    description: q === 'AAPL' ? 'Apple Inc' : q,
                    type: 'Common Stock',
                },
            ]);
        }

        // Hors périmètre Finnhub/FMP : seuls le cours et l'historique répondent.
        if (profile === 'sparse') {
            if (p.endsWith('/quote')) return json({ symbol: 'MC.PA', price: 640, currency: 'EUR' });
            if (p.endsWith('/history'))
                return json(buildHistory(url.searchParams.get('from'), url.searchParams.get('to')));
            if (p.endsWith('/quoteSummary'))
                return json({
                    symbol: 'MC.PA',
                    source: 'yahoo-quoteSummary',
                    name: 'LVMH',
                    currency: 'EUR',
                    exchange: 'Paris',
                    price: 640,
                    previousClose: 635,
                    marketCap: 320000000000,
                    governance: {
                        overall: null,
                        audit: null,
                        board: null,
                        compensation: null,
                        shareholderRights: null,
                    },
                });
            if (p.endsWith('/fundamentals')) return json(null);
            if (p.endsWith('/fmp')) return json({ unavailable: true });
            if (p.endsWith('/peers')) return json([]);
            if (p.endsWith('/earnings')) return json({ date: null });
            if (p.endsWith('/dividends')) return json([]);
            if (p.endsWith('/recommendation')) return json([]);
            if (p.endsWith('/insider')) return json({ data: [] });
            if (p.endsWith('/sector')) return json({ sector: null });
            if (p.endsWith('/websearch')) return json({ results: [] });
            if (p === '/ai/key') return json({ ok: true, provider: 'anthropic', configured: [] });
            if (p === '/ai/stock-analysis')
                return json({
                    text: AI_ANALYSIS_TEXT,
                    generatedAt: new Date().toISOString(),
                    cached: false,
                });
            return json({});
        }

        // Action US identique au profil complet, mais sans aucun dividende.
        if (profile === 'nodiv') {
            if (p.endsWith('/dividends')) return json([]);
            if (p.endsWith('/quoteSummary'))
                return json({
                    ...QUOTE_SUMMARY,
                    dividendYield: null,
                    dividendRate: null,
                    payoutRatio: null,
                    fiveYearAvgDividendYield: null,
                    exDividendDate: null,
                });
            if (p.endsWith('/fundamentals')) return json({ ...FUNDAMENTALS, dividendYield: null });
            if (p.endsWith('/fmp')) {
                const r = url.searchParams.get('resource');
                const data = Object.prototype.hasOwnProperty.call(FMP, r) ? FMP[r] : [];
                // FMP porte aussi un rendement/payout : sans ça la valeur passerait
                // pour distributrice alors qu'elle ne verse rien.
                if (r === 'ratiosTtm')
                    return json(
                        data.map((x) => ({ ...x, dividendYieldTTM: null, payoutRatioTTM: null }))
                    );
                if (r === 'ratios') return json(data.map((x) => ({ ...x, payoutRatio: null })));
                return json(data);
            }
        }
        if (p.endsWith('/fundamentals')) return json(FUNDAMENTALS);
        if (p.endsWith('/quote')) return json({ symbol: 'AAPL', price: 192.5, currency: 'USD' });
        if (p.endsWith('/history')) {
            return json(buildHistory(url.searchParams.get('from'), url.searchParams.get('to')));
        }
        if (p.endsWith('/dividends'))
            return json([
                { date: '2021-05-07', amountPerShare: 0.22 },
                { date: '2021-08-06', amountPerShare: 0.22 },
                { date: '2022-05-06', amountPerShare: 0.23 },
                { date: '2022-08-05', amountPerShare: 0.23 },
                { date: '2023-05-12', amountPerShare: 0.24 },
                { date: '2023-08-11', amountPerShare: 0.24 },
                { date: '2024-05-10', amountPerShare: 0.25 },
            ]);
        if (p.endsWith('/sector')) return json({ sector: 'Technology' });
        if (p.endsWith('/earnings'))
            return json({
                date: '2025-07-31',
                hour: 'amc',
                epsEstimate: 1.9,
                revenueEstimate: 89000000000,
            });
        if (p.endsWith('/quoteSummary')) {
            const sym = url.searchParams.get('symbol');
            return json(
                sym && PEER_SUMMARY[sym]
                    ? { ...QUOTE_SUMMARY, ...PEER_SUMMARY[sym] }
                    : QUOTE_SUMMARY
            );
        }
        if (p.endsWith('/fmp')) {
            const r = url.searchParams.get('resource');
            return json(Object.prototype.hasOwnProperty.call(FMP, r) ? FMP[r] : []);
        }
        if (p.endsWith('/recommendation'))
            return json([
                {
                    symbol: 'AAPL',
                    period: '2025-01-01',
                    strongBuy: 12,
                    buy: 18,
                    hold: 6,
                    sell: 1,
                    strongSell: 0,
                },
            ]);
        if (p.endsWith('/insider')) return json({ symbol: 'AAPL', data: [] });
        if (p.endsWith('/peers')) return json(['MSFT', 'GOOGL', 'AMZN', 'DELL']);
        if (p.endsWith('/websearch')) return json({ results: [] });
        if (p === '/ai/key')
            return json({ ok: true, provider: 'anthropic', configured: ['anthropic'] });
        // `insights` : charge utile du resume de portefeuille. Par defaut aucun
        // evenement, ce qui laisse l'app basculer sur son rendu de repli.
        if (p === '/ai/insights')
            return json({
                text: JSON.stringify(opts.insights || { summary: 'ok', portfolio: [] }),
            });
        if (p === '/ai/stock-analysis')
            return json({
                text: AI_ANALYSIS_TEXT,
                generatedAt: new Date().toISOString(),
                cached: false,
            });
        return json({});
    });

    // 3. Retire les attributs SRI du HTML : le stub Supabase servi ci-dessus ne peut
    //    pas satisfaire le hash `integrity` de la vraie lib CDN, le navigateur
    //    refuserait alors de l'exécuter.
    //
    //    Les en-têtes de la réponse d'origine sont conservés : la CSP du document
    //    vient de là et de nulle part ailleurs. Un `fulfill` qui ne repasse que
    //    le `content-type` livre une page sans aucune CSP — les tests valident
    //    alors une application plus permissive que celle mise en ligne.
    await page.route(/localhost:8788\/($|index\.html)/, async (route) => {
        const res = await route.fetch();
        const html = (await res.text())
            .replace(/\s+integrity="[^"]*"/g, '')
            .replace(/\s+crossorigin="anonymous"/g, '');
        const headers = { ...res.headers() };
        // Le corps a changé de taille et n'est plus compressé.
        delete headers['content-length'];
        delete headers['content-encoding'];
        headers['content-type'] = 'text/html; charset=utf-8';
        await route.fulfill({ status: res.status(), headers, body: html });
    });

    await page.goto('/');
    await page.locator('#appContainer').waitFor({ state: 'visible' });
    await page.locator('#appContainer:not(.app-loading)').waitFor();
}

/** Ouvre l'onglet Explorer et lance l'analyse d'un symbole via la recherche. */
export async function openResearch(page, symbol = 'AAPL', { deep = true } = {}) {
    await page.locator('button[data-tab="research"]:visible').first().click();
    await page.locator('#view-research').waitFor({ state: 'visible' });

    const input = page.locator('#researchSearchInput');
    await input.click();
    await input.fill(symbol);
    const row = page.locator(`#researchSuggest .rs-row[data-sym="${symbol}"]`);
    await row.first().click();

    await page.locator('#researchContent').waitFor({ state: 'visible' });
    await page.locator('#researchSymbol').filter({ hasText: symbol }).waitFor();

    // L'analyse approfondie (et ses appels FMP) est desormais a la demande :
    // la majorite des tests en a besoin, d'ou le clic par defaut.
    if (deep) await runDeepAnalysis(page);
}

/** Clique sur "Lancer l'analyse approfondie" si la carte d'appel est affichee. */
export async function runDeepAnalysis(page) {
    const card = page.locator('#researchDeepCard');
    if (!(await card.isVisible())) return;
    await page.locator('#researchDeepBtn').click();
    await card.waitFor({ state: 'hidden' });
}
