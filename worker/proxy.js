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
 *   POST /ai/key            { provider, key }  (Bearer JWT Supabase) -> chiffre + stocke la cle IA de l'utilisateur (KV), jamais renvoyee
 *   DELETE /ai/key?provider=P                  (Bearer JWT Supabase) -> supprime la cle stockee
 *   POST /ai/insights       { provider, prompt, liveSearch }  (Bearer JWT Supabase) -> { text }  (appel au fournisseur cote worker)
 *
 * Vars publiques (wrangler.proxy.toml [vars]) : SUPABASE_URL, SUPABASE_ANON_KEY.
 * Secret requis pour /ai/* : AI_ENC_KEY (32 octets base64) -> `wrangler secret put AI_ENC_KEY -c wrangler.proxy.toml`.
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
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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

/* ======================= RESUME IA (cles jamais exposees au navigateur) =======================
 * La cle API du fournisseur IA de l'utilisateur est stockee chiffree (AES-GCM) dans
 * WEBSEARCH_KV sous `aikey:<userId>:<provider>`. Le navigateur n'envoie sa cle qu'une
 * fois (POST /ai/key) et ne la recupere jamais. /ai/insights execute l'appel au
 * fournisseur cote worker. L'identite vient du JWT Supabase (verifie via /auth/v1/user).
 */

async function httpErr(name, res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) { /* corps illisible */ }
    const err = new Error(`${name} API HTTP ${res.status}${detail ? ' : ' + detail : ''}`);
    err.statusCode = 502;
    return err;
}

const AI_PROVIDERS = {
    anthropic: {
        async call(apiKey, prompt, liveSearch) {
            const body = { model: 'claude-sonnet-4-5', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] };
            if (liveSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw await httpErr('Anthropic', res);
            const data = await res.json();
            return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        }
    },
    openai: {
        async call(apiKey, prompt, liveSearch) {
            const body = { model: 'gpt-4.1', input: prompt };
            if (liveSearch) body.tools = [{ type: 'web_search_preview' }];
            const res = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw await httpErr('OpenAI', res);
            const data = await res.json();
            const msg = (data.output || []).find(o => o.type === 'message');
            const block = msg && (msg.content || []).find(c => c.type === 'output_text');
            return (block && block.text) || '';
        }
    },
    gemini: {
        async call(apiKey, prompt) {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            if (!res.ok) throw await httpErr('Gemini', res);
            const data = await res.json();
            const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
            return parts.map(p => p.text || '').join('\n').trim();
        }
    },
    grok: {
        async call(apiKey, prompt, liveSearch) {
            const res = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'grok-4-latest',
                    messages: [{ role: 'user', content: prompt }],
                    search_parameters: { mode: liveSearch ? 'auto' : 'off' }
                })
            });
            if (!res.ok) throw await httpErr('Grok', res);
            const data = await res.json();
            return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        }
    },
    groq: {
        async call(apiKey, prompt) {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3
                })
            });
            if (!res.ok) throw await httpErr('Groq', res);
            const data = await res.json();
            return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        }
    }
};

function authError(msg) {
    const err = new Error(msg);
    err.statusCode = 401;
    return err;
}

async function verifySupabaseJwt(request, env) {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        throw authError('Authentification requise');
    }
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth }
    });
    if (!res.ok) throw authError('Session invalide');
    const user = await res.json().catch(() => null);
    if (!user || !user.id) throw authError('Session invalide');
    return user.id;
}

async function importEncKey(env) {
    const raw = Uint8Array.from(atob(env.AI_ENC_KEY), c => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSecret(env, text) {
    const key = await importEncKey(env);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    const blob = new Uint8Array(iv.length + ct.length);
    blob.set(iv);
    blob.set(ct, iv.length);
    return btoa(String.fromCharCode(...blob));
}

async function decryptSecret(env, b64) {
    const key = await importEncKey(env);
    const blob = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, key, blob.slice(12));
    return new TextDecoder().decode(pt);
}

async function listConfiguredProviders(env, userId) {
    if (!env.WEBSEARCH_KV) return [];
    const list = await env.WEBSEARCH_KV.list({ prefix: `aikey:${userId}:` });
    return list.keys.map(k => k.name.split(':').pop());
}

// Reporte l'etat non secret (fournisseurs configures + selection) dans user_settings,
// pour que le navigateur le lise via RLS. Best-effort.
async function syncAiConfigToSupabase(request, env, userId, configured, selectedProvider) {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return;
    const body = { user_id: userId, ai_providers_configured: configured };
    if (selectedProvider) body.ai_provider = selectedProvider;
    else if (!configured.length) body.ai_provider = null;
    await fetch(`${env.SUPABASE_URL}/rest/v1/user_settings`, {
        method: 'POST',
        headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: request.headers.get('Authorization'),
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(body)
    }).catch(() => { /* best-effort */ });
}

async function enforceUserAiQuota(env, userId) {
    const kv = env && env.WEBSEARCH_KV;
    if (!kv) return;
    const key = `airl:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const count = parseInt(await kv.get(key)) || 0;
    if (count >= 50) {
        const err = new Error('Quota quotidien de resumes IA atteint');
        err.statusCode = 429;
        throw err;
    }
    await kv.put(key, String(count + 1), { expirationTtl: 172800 });
}

async function handleAiKeySet(request, env) {
    const userId = await verifySupabaseJwt(request, env);
    if (!env.AI_ENC_KEY || !env.WEBSEARCH_KV) return jsonResponse({ error: 'Stockage des cles IA non configure' }, 501);
    const { provider, key } = await request.json().catch(() => ({}));
    if (!AI_PROVIDERS[provider]) return jsonResponse({ error: 'Fournisseur IA inconnu' }, 400);
    if (typeof key !== 'string' || key.trim().length < 8) return jsonResponse({ error: 'Cle API invalide' }, 400);
    await env.WEBSEARCH_KV.put(`aikey:${userId}:${provider}`, await encryptSecret(env, key.trim()));
    const configured = await listConfiguredProviders(env, userId);
    await syncAiConfigToSupabase(request, env, userId, configured, provider);
    return jsonResponse({ ok: true, provider, configured });
}

async function handleAiKeyDelete(request, env, url) {
    const userId = await verifySupabaseJwt(request, env);
    const provider = url.searchParams.get('provider');
    if (!AI_PROVIDERS[provider]) return jsonResponse({ error: 'Fournisseur IA inconnu' }, 400);
    if (env.WEBSEARCH_KV) await env.WEBSEARCH_KV.delete(`aikey:${userId}:${provider}`);
    const configured = await listConfiguredProviders(env, userId);
    await syncAiConfigToSupabase(request, env, userId, configured, null);
    return jsonResponse({ ok: true, configured });
}

async function handleAiInsights(request, env) {
    const userId = await verifySupabaseJwt(request, env);
    if (!env.WEBSEARCH_KV || !env.AI_ENC_KEY) return jsonResponse({ error: 'Stockage des cles IA non configure' }, 501);
    const { provider, prompt, liveSearch } = await request.json().catch(() => ({}));
    if (!AI_PROVIDERS[provider]) return jsonResponse({ error: 'Fournisseur IA inconnu' }, 400);
    if (typeof prompt !== 'string' || !prompt.trim()) return jsonResponse({ error: 'prompt requis' }, 400);
    const enc = await env.WEBSEARCH_KV.get(`aikey:${userId}:${provider}`);
    if (!enc) return jsonResponse({ error: 'Aucune cle enregistree pour ce fournisseur' }, 400);
    await enforceUserAiQuota(env, userId);
    const apiKey = await decryptSecret(env, enc);
    const text = await AI_PROVIDERS[provider].call(apiKey, prompt, !!liveSearch);
    return jsonResponse({ text });
}

async function route(request, url, env) {
    if (url.pathname === '/ai/key') {
        if (request.method === 'POST') return await handleAiKeySet(request, env);
        if (request.method === 'DELETE') return await handleAiKeyDelete(request, env, url);
        return jsonResponse({ error: 'Methode non supportee' }, 405);
    }

    if (url.pathname === '/ai/insights') {
        if (request.method !== 'POST') return jsonResponse({ error: 'Methode non supportee' }, 405);
        return await handleAiInsights(request, env);
    }

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

    return jsonResponse({ status: 'ok', routes: ['/quote?symbol=', '/history?symbol=&from=&to=', '/dividends?symbol=&from=&to=', '/sector?symbol=', '/earnings?symbol=', '/fundamentals?symbol=', '/search?q=', '/websearch?q=', 'POST /ai/key', 'DELETE /ai/key?provider=', 'POST /ai/insights'] });
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
            res = await route(request, url, env);
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
