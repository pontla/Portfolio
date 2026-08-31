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

function buildHistory(fromStr, toStr) {
    const out = {};
    const from = new Date(fromStr);
    const to = new Date(toStr);
    let price = 80;
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 7)) {
        price += Math.sin(d.getTime() / 6e9) * 4 + 1.5;
        out[d.toISOString().slice(0, 10)] = Math.round(price * 100) / 100;
    }
    return out;
}

const SUPABASE_STUB = `
window.supabase = {
  createClient: function () {
    var S = ${JSON.stringify(FAKE_SESSION)};
    var DATA = {
      portfolios: [{ id: 'e2e-pf', name: 'Portefeuille E2E', color: '#3b82f6', created_at: '2024-01-01T00:00:00Z' }],
      trades: [{
        id: 'e2e-t1', portfolio_id: 'e2e-pf', type: 'BUY', symbol: 'AAPL',
        qty: 10, price: 150, amount: 1500, fees: 0, fx_rate: null, date: '2024-02-01'
      }]
    };
    function builder(table) {
      var rows = DATA[table] || [];
      var b = {
        select: function () { return b; }, order: function () { return b; },
        eq: function () { return b; }, limit: function () { return b; },
        insert: function () { return b; }, update: function () { return b; }, delete: function () { return b; },
        single: function () { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then: function (res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); }
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
 */
export async function bootApp(page) {
    // 1. Remplace le SDK Supabase (CDN) par un stub local.
    await page.route(/@supabase\/supabase-js/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB })
    );

    // 2. Intercepte le worker proxy de données de marché.
    await page.route(/fragrant-band-1476\.[^/]*\.workers\.dev/, async (route) => {
        const url = new URL(route.request().url());
        const p = url.pathname;
        const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

        if (p.endsWith('/search')) {
            return json([{ displaySymbol: 'AAPL', symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }]);
        }
        if (p.endsWith('/fundamentals')) return json(FUNDAMENTALS);
        if (p.endsWith('/quote')) return json({ symbol: 'AAPL', price: 192.5, currency: 'USD' });
        if (p.endsWith('/history')) {
            return json(buildHistory(url.searchParams.get('from'), url.searchParams.get('to')));
        }
        if (p.endsWith('/dividends')) return json([]);
        if (p.endsWith('/sector')) return json({ sector: 'Technology' });
        if (p.endsWith('/earnings')) return json({});
        if (p.endsWith('/websearch')) return json({ results: [] });
        return json({});
    });

    // 3. Retire les attributs SRI du HTML : le stub Supabase servi ci-dessus ne peut
    //    pas satisfaire le hash `integrity` de la vraie lib CDN, le navigateur
    //    refuserait alors de l'exécuter.
    await page.route(/localhost:8788\/($|index\.html)/, async (route) => {
        const res = await route.fetch();
        const html = (await res.text())
            .replace(/\s+integrity="[^"]*"/g, '')
            .replace(/\s+crossorigin="anonymous"/g, '');
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });

    await page.goto('/');
    await page.locator('#appContainer').waitFor({ state: 'visible' });
    await page.locator('#appContainer:not(.app-loading)').waitFor();
}

/** Ouvre l'onglet Explorer et lance l'analyse d'un symbole via la recherche. */
export async function openResearch(page, symbol = 'AAPL') {
    await page.locator('button[data-tab="research"]:visible').first().click();
    await page.locator('#view-research').waitFor({ state: 'visible' });

    const input = page.locator('#researchSearchInput');
    await input.click();
    await input.fill(symbol);
    const row = page.locator(`#researchSuggest .rs-row[data-sym="${symbol}"]`);
    await row.first().click();

    await page.locator('#researchContent').waitFor({ state: 'visible' });
    await page.locator('#researchSymbol').filter({ hasText: symbol }).waitFor();
}
