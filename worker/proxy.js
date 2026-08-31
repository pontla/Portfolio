/**
 * Proxy Cloudflare Worker — donnees de marche reelles (Yahoo Finance) pour l'app Portfolio.
 *
 * Deploiement : Cloudflare dashboard -> Workers & Pages -> Create -> Create Worker
 * -> coller ce fichier dans l'editeur "Quick Edit" -> Deploy.
 * Recuperer ensuite l'URL *.workers.dev generee et la renseigner dans
 * CONFIG.PROXY_BASE_URL (js/app.js).
 *
 * Routes exposees :
 *   GET /quote?symbol=SYM                      -> { symbol, price, currency }
 *   GET /history?symbol=SYM&from=YYYY-MM-DD&to=YYYY-MM-DD -> { "YYYY-MM-DD": close, ... }
 *   GET /search?q=QUERY                        -> [{ displaySymbol, description, type }]
 *   GET /dividends?symbol=SYM&from=YYYY-MM-DD&to=YYYY-MM-DD -> [{ date, amountPerShare }]
 *   GET /sector?symbol=SYM -> { sector }  (via Finnhub, secret FINNHUB_API_KEY requis)
 *   GET /earnings?symbol=SYM -> { date, hour, epsEstimate, revenueEstimate } | { date: null } (Finnhub, actions US uniquement)
 *   GET /fundamentals?symbol=SYM -> { price, currency, 52W hi/lo, volume, name, exchange (Yahoo) + PER, BPA, rendement, beta, ROE... (Finnhub, actions US) }
 *   GET /websearch?q=QUERY -> { results: [{ title, url, content, publishedDate }] } (Tavily, secret TAVILY_API_KEY requis)
 */

const YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

// Seules ces origines (navigateur) peuvent consommer le proxy. Une requete sans
// en-tete Origin (appel serveur / cURL) passe le filtre CORS mais reste soumise
// au quota par IP ci-dessous.
const ALLOWED_ORIGINS = [
    'https://portfolio.jrichardeau-cloudflare.workers.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788'
];

// Quota journalier par IP, tous chemins confondus (defense en profondeur contre
// l'abus des cles Finnhub/Tavily si l'URL du worker fuite). Necessite WEBSEARCH_KV.
const RATE_LIMIT_PER_DAY = 3000;

// Retourne l'origine a renvoyer dans Access-Control-Allow-Origin, ou null si
// l'origine presente est interdite (-> 403).
function resolveOrigin(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return '*';
    return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function corsHeaders(origin = '*') {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

async function enforceRateLimit(request, env) {
    const kv = env && env.WEBSEARCH_KV;
    if (!kv) return;
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    const key = `rl:ip:${new Date().toISOString().slice(0, 10)}:${ip}`;
    const count = parseInt(await kv.get(key)) || 0;
    if (count >= RATE_LIMIT_PER_DAY) {
        const err = new Error('Quota quotidien atteint pour cette IP');
        err.statusCode = 429;
        throw err;
    }
    await kv.put(key, String(count + 1), { expirationTtl: 172800 });
}

function jsonResponse(data, status = 200, cacheSeconds = 0) {
    const headers = {
        'Content-Type': 'application/json',
        ...corsHeaders()
    };
    if (cacheSeconds > 0) {
        headers['Cache-Control'] = `public, s-maxage=${cacheSeconds}`;
    }
    return new Response(JSON.stringify(data), { status, headers });
}

function toUnixSeconds(dateStr, endOfDay = false) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const ms = Date.UTC(y, (m || 1) - 1, d || 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
    return Math.floor(ms / 1000);
}

async function fetchYahooChart(symbol, period1, period2) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div,splits`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
    const data = await res.json();
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) {
        const err = data && data.chart && data.chart.error;
        throw new Error(err ? `Yahoo error: ${err.description || err.code}` : 'Symbole introuvable');
    }
    return result;
}

async function handleQuote(symbol) {
    const now = Math.floor(Date.now() / 1000);
    const result = await fetchYahooChart(symbol, now - 5 * 24 * 3600, now + 24 * 3600);
    const meta = result.meta || {};
    let price = meta.regularMarketPrice;

    if (price === undefined || price === null) {
        const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
        for (let i = closes.length - 1; i >= 0; i--) {
            if (closes[i] !== null && closes[i] !== undefined) { price = closes[i]; break; }
        }
    }

    if (price === undefined || price === null) throw new Error('Prix indisponible');

    return jsonResponse({
        symbol: meta.symbol || symbol,
        price,
        currency: meta.currency || 'USD'
    }, 200, 60);
}

async function handleHistory(symbol, from, to) {
    const period1 = toUnixSeconds(from, false);
    const period2 = toUnixSeconds(to, true);
    const result = await fetchYahooChart(symbol, period1, period2);

    const timestamps = result.timestamp || [];
    const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];

    const daily = {};
    timestamps.forEach((ts, idx) => {
        const close = closes[idx];
        if (close === null || close === undefined) return;
        const d = new Date(ts * 1000);
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        daily[dateStr] = close;
    });

    return jsonResponse(daily, 200, 21600); // cache 6h
}

async function handleDividends(symbol, from, to) {
    const period1 = toUnixSeconds(from, false);
    const period2 = toUnixSeconds(to, true);
    const result = await fetchYahooChart(symbol, period1, period2);

    const dividends = (result.events && result.events.dividends) || {};
    const list = Object.values(dividends).map(ev => {
        const d = new Date(ev.date * 1000);
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        return { date: dateStr, amountPerShare: ev.amount };
    }).sort((a, b) => a.date.localeCompare(b.date));

    return jsonResponse(list, 200, 21600); // cache 6h
}

async function handleSector(symbol, apiKey) {
    if (!apiKey) throw new Error('FINNHUB_API_KEY non configuree');

    // Finnhub gratuit = actions US uniquement. Un ticker avec suffixe de place (ex: MC.PA) ou crypto
    // n'a pas d'equivalent fiable en enlevant juste le suffixe (match faux possible) -> pas de secteur.
    if (symbol.includes('.') || symbol.startsWith('$') || symbol.endsWith('-USD')) {
        return jsonResponse({ sector: null }, 200, 604800);
    }

    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const data = await res.json();
    return jsonResponse({ sector: data.finnhubIndustry || null }, 200, 604800); // cache 7j
}

const numOrNull = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

async function handleFundamentals(symbol, apiKey) {
    const now = Math.floor(Date.now() / 1000);
    const out = {
        symbol, name: null, currency: 'USD', price: null, previousClose: null,
        dayHigh: null, dayLow: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
        volume: null, exchange: null, marketCap: null, peTTM: null, pbAnnual: null,
        psTTM: null, epsTTM: null, dividendYield: null, beta: null, roeTTM: null,
        netMarginTTM: null, revenueGrowthTTM: null, industry: null, country: null,
        ipo: null, weburl: null, logo: null, fundamentalsSource: null
    };

    // Meta Yahoo : disponible pour tous les marches (US, Euronext, crypto...)
    try {
        const result = await fetchYahooChart(symbol, now - 7 * 24 * 3600, now + 24 * 3600);
        const meta = result.meta || {};
        out.price = numOrNull(meta.regularMarketPrice);
        out.currency = meta.currency || out.currency;
        out.previousClose = numOrNull(meta.chartPreviousClose ?? meta.previousClose);
        out.dayHigh = numOrNull(meta.regularMarketDayHigh);
        out.dayLow = numOrNull(meta.regularMarketDayLow);
        out.fiftyTwoWeekHigh = numOrNull(meta.fiftyTwoWeekHigh);
        out.fiftyTwoWeekLow = numOrNull(meta.fiftyTwoWeekLow);
        out.volume = numOrNull(meta.regularMarketVolume);
        out.exchange = meta.fullExchangeName || meta.exchangeName || null;
        out.name = meta.longName || meta.shortName || null;
    } catch (e) { /* pas de meta -> champs a null */ }

    // Ratios fondamentaux : Finnhub gratuit = actions US uniquement.
    const isUS = apiKey && !symbol.includes('.') && !symbol.startsWith('$') && !symbol.endsWith('-USD');
    if (isUS) {
        try {
            const [mRes, pRes] = await Promise.all([
                fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`),
                fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`)
            ]);
            if (mRes.ok) {
                const m = (await mRes.json()).metric || {};
                out.peTTM = numOrNull(m.peTTM ?? m.peBasicExclExtraTTM);
                out.pbAnnual = numOrNull(m.pbAnnual ?? m.pbQuarterly);
                out.psTTM = numOrNull(m.psTTM);
                out.epsTTM = numOrNull(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsInclExtraItemsTTM);
                out.dividendYield = numOrNull(m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM);
                out.beta = numOrNull(m.beta);
                out.roeTTM = numOrNull(m.roeTTM);
                out.netMarginTTM = numOrNull(m.netProfitMarginTTM);
                out.revenueGrowthTTM = numOrNull(m.revenueGrowthTTMYoy);
                if (out.fiftyTwoWeekHigh == null) out.fiftyTwoWeekHigh = numOrNull(m['52WeekHigh']);
                if (out.fiftyTwoWeekLow == null) out.fiftyTwoWeekLow = numOrNull(m['52WeekLow']);
                out.fundamentalsSource = 'finnhub';
            }
            if (pRes.ok) {
                const p = await pRes.json();
                if (typeof p.marketCapitalization === 'number') out.marketCap = p.marketCapitalization * 1e6;
                out.industry = p.finnhubIndustry || null;
                out.country = p.country || null;
                out.ipo = p.ipo || null;
                out.weburl = p.weburl || null;
                out.logo = p.logo || null;
                if (!out.name) out.name = p.name || null;
                if (!out.exchange) out.exchange = p.exchange || null;
            }
        } catch (e) { /* fondamentaux indisponibles */ }
    }

    return jsonResponse(out, 200, 3600); // cache 1h
}

async function handleEarnings(symbol, apiKey) {
    if (!apiKey) throw new Error('FINNHUB_API_KEY non configuree');

    // Meme limite que /sector : Finnhub gratuit = actions US uniquement.
    if (symbol.includes('.') || symbol.startsWith('$') || symbol.endsWith('-USD')) {
        return jsonResponse({ date: null }, 200, 21600);
    }

    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const data = await res.json();
    const list = (data && data.earningsCalendar) || [];
    const next = list.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!next) return jsonResponse({ date: null }, 200, 21600);

    return jsonResponse({
        date: next.date,
        hour: next.hour || null,
        epsEstimate: next.epsEstimate ?? null,
        revenueEstimate: next.revenueEstimate ?? null
    }, 200, 21600); // cache 6h
}

async function handleWebSearch(query, apiKey, kv) {
    if (!apiKey) throw new Error('TAVILY_API_KEY non configuree');

    const cacheKey = `q:${query.trim().toLowerCase()}`;
    if (kv) {
        const cached = await kv.get(cacheKey, 'json');
        if (cached) return jsonResponse({ results: cached }, 200, 1800);
    }

    if (kv) {
        const rlKey = `rl:${new Date().toISOString().slice(0, 10)}`;
        const count = parseInt(await kv.get(rlKey)) || 0;
        if (count >= 30) throw new Error('Limite quotidienne Tavily atteinte, reessayez demain');
        await kv.put(rlKey, String(count + 1), { expirationTtl: 172800 });
    }

    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: 'basic',
            topic: 'news',
            days: 30,
            max_results: 5,
            include_answer: false
        })
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    const results = (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        publishedDate: r.published_date || null
    }));

    if (kv) await kv.put(cacheKey, JSON.stringify(results), { expirationTtl: 1800 });

    return jsonResponse({ results }, 200, 1800); // cache 30min
}

async function handleSearch(query) {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`Yahoo search HTTP ${res.status}`);
    const data = await res.json();
    const quotes = (data && data.quotes) || [];

    const results = quotes
        .filter(q => q.symbol)
        .map(q => ({
            displaySymbol: q.symbol,
            description: q.shortname || q.longname || q.symbol,
            type: q.quoteType || 'EQUITY'
        }));

    return jsonResponse(results, 200, 3600); // cache 1h
}

async function route(url, env) {
    if (url.pathname === '/quote') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'symbol requis' }, 400);
        return await handleQuote(symbol);
    }

    if (url.pathname === '/history') {
        const symbol = url.searchParams.get('symbol');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (!symbol || !from || !to) return jsonResponse({ error: 'symbol, from, to requis' }, 400);
        return await handleHistory(symbol, from, to);
    }

    if (url.pathname === '/dividends') {
        const symbol = url.searchParams.get('symbol');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (!symbol || !from || !to) return jsonResponse({ error: 'symbol, from, to requis' }, 400);
        return await handleDividends(symbol, from, to);
    }

    if (url.pathname === '/sector') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'symbol requis' }, 400);
        return await handleSector(symbol, env.FINNHUB_API_KEY);
    }

    if (url.pathname === '/earnings') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'symbol requis' }, 400);
        return await handleEarnings(symbol, env.FINNHUB_API_KEY);
    }

    if (url.pathname === '/fundamentals') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'symbol requis' }, 400);
        return await handleFundamentals(symbol, env.FINNHUB_API_KEY);
    }

    if (url.pathname === '/search') {
        const q = url.searchParams.get('q');
        if (!q) return jsonResponse({ error: 'q requis' }, 400);
        return await handleSearch(q);
    }

    if (url.pathname === '/websearch') {
        const q = url.searchParams.get('q');
        if (!q) return jsonResponse({ error: 'q requis' }, 400);
        return await handleWebSearch(q, env.TAVILY_API_KEY, env.WEBSEARCH_KV);
    }

    return jsonResponse({ status: 'ok', routes: ['/quote?symbol=', '/history?symbol=&from=&to=', '/dividends?symbol=&from=&to=', '/sector?symbol=', '/earnings?symbol=', '/fundamentals?symbol=', '/search?q=', '/websearch?q='] });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = resolveOrigin(request);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders(origin) });
        }

        const cors = corsHeaders(origin);

        if (origin === null) {
            return new Response(JSON.stringify({ error: 'Origine non autorisee' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json', ...cors, 'Access-Control-Allow-Origin': '*' }
            });
        }

        let res;
        try {
            await enforceRateLimit(request, env);
            res = await route(url, env);
        } catch (e) {
            res = jsonResponse({ error: e.message || 'Erreur proxy' }, e.statusCode || 502);
        }

        // Re-applique l'origine autorisee sur la reponse produite par les handlers.
        const headers = new Headers(res.headers);
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
        return new Response(res.body, { status: res.status, headers });
    }
};
