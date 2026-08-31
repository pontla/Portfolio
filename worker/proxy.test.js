import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from './proxy.js';

function jsonFetchResponse(body, ok = true, status = 200) {
    return { ok, status, json: async () => body };
}

function chartResult({ symbol = 'AAPL', regularMarketPrice, currency = 'USD', timestamps = [], closes = [], dividends } = {}) {
    return {
        chart: {
            result: [{
                meta: { symbol, regularMarketPrice, currency },
                timestamp: timestamps,
                indicators: { quote: [{ close: closes }] },
                events: dividends ? { dividends } : undefined
            }]
        }
    };
}

async function call(path, env = {}, method = 'GET') {
    const req = new Request(`https://proxy.test${path}`, { method });
    return worker.fetch(req, env);
}

let fetchMock;

beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('routing', () => {
    it('repond aux requetes OPTIONS avec les headers CORS', async () => {
        const res = await call('/quote', {}, 'OPTIONS');
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('liste les routes disponibles sur un chemin inconnu', async () => {
        const res = await call('/');
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.routes).toContain('/websearch?q=');
    });

    it('renvoie 502 si une dependance leve une erreur', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({}, false, 500));
        const res = await call('/quote?symbol=AAPL');
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toMatch(/Yahoo chart HTTP 500/);
    });
});

describe('securite : origine & quota', () => {
    const callWith = (path, headers, env = {}) =>
        worker.fetch(new Request(`https://proxy.test${path}`, { headers }), env);

    it('refuse (403) une origine navigateur non autorisee', async () => {
        const res = await callWith('/quote?symbol=AAPL', { Origin: 'https://evil.example' });
        expect(res.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reflete une origine autorisee dans Access-Control-Allow-Origin', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(
            chartResult({ regularMarketPrice: 10 })
        ));
        const allowed = 'https://portfolio.jrichardeau-cloudflare.workers.dev';
        const res = await callWith('/quote?symbol=AAPL', { Origin: allowed });
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(allowed);
        expect(res.headers.get('Vary')).toBe('Origin');
    });

    it('laisse passer une requete sans en-tete Origin (appel serveur)', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(
            chartResult({ regularMarketPrice: 10 })
        ));
        const res = await callWith('/quote?symbol=AAPL', {});
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('renvoie 429 quand le quota KV par IP est atteint', async () => {
        const store = new Map([['rl:ip:', '5000']]);
        const kv = {
            get: vi.fn(async (k) => {
                for (const [key, val] of store) if (k.startsWith(key)) return val;
                return null;
            }),
            put: vi.fn(async () => {})
        };
        const res = await callWith('/quote?symbol=AAPL', {}, { WEBSEARCH_KV: kv });
        expect(res.status).toBe(429);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('incremente le compteur KV a chaque appel autorise', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(chartResult({ regularMarketPrice: 10 })));
        const kv = { get: vi.fn(async () => '0'), put: vi.fn(async () => {}) };
        await callWith('/quote?symbol=AAPL', {}, { WEBSEARCH_KV: kv });
        expect(kv.put).toHaveBeenCalledWith(expect.stringMatching(/^rl:ip:/), '1', expect.objectContaining({ expirationTtl: expect.any(Number) }));
    });
});

describe('/ai/* : cles IA jamais exposees au navigateur', () => {
    const ENC_KEY = Buffer.alloc(32, 9).toString('base64');
    const AI_ENV = () => ({
        SUPABASE_URL: 'https://proj.supabase.co',
        SUPABASE_ANON_KEY: 'anon-pub',
        AI_ENC_KEY: ENC_KEY,
        WEBSEARCH_KV: fakeKV()
    });

    function fakeKV(initial = {}) {
        const m = new Map(Object.entries(initial));
        return {
            _map: m,
            get: async (k) => (m.has(k) ? m.get(k) : null),
            put: async (k, v) => { m.set(k, String(v)); },
            delete: async (k) => { m.delete(k); },
            list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) })
        };
    }

    function routeFetch(handlers) {
        return async (url, opts) => {
            const u = String(url);
            for (const [frag, fn] of handlers) if (u.includes(frag)) return fn(u, opts);
            throw new Error('fetch inattendu: ' + u);
        };
    }

    const aiCall = (path, { method = 'POST', env, headers = {}, body } = {}) =>
        worker.fetch(new Request(`https://proxy.test${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        }), env);

    it('refuse (401) sans en-tete Authorization', async () => {
        const res = await aiCall('/ai/key', { env: AI_ENV(), body: { provider: 'anthropic', key: 'sk-ant-1234567' } });
        expect(res.status).toBe(401);
    });

    it('POST /ai/key : verifie le JWT, chiffre la cle, ne la stocke jamais en clair', async () => {
        const env = AI_ENV();
        fetchMock.mockImplementation(routeFetch([
            ['/auth/v1/user', () => ({ ok: true, json: async () => ({ id: 'user-42' }) })],
            ['/rest/v1/user_settings', () => ({ ok: true, json: async () => ([]) })]
        ]));

        const res = await aiCall('/ai/key', {
            env, headers: { Authorization: 'Bearer jwt-xyz' },
            body: { provider: 'anthropic', key: 'sk-ant-SECRET-KEY' }
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.configured).toEqual(['anthropic']);
        const stored = env.WEBSEARCH_KV._map.get('aikey:user-42:anthropic');
        expect(stored).toBeTruthy();
        expect(stored).not.toContain('sk-ant-SECRET-KEY');
        // le JWT a bien ete presente a Supabase
        expect(fetchMock).toHaveBeenCalledWith('https://proj.supabase.co/auth/v1/user', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer jwt-xyz', apikey: 'anon-pub' })
        }));
    });

    it('POST /ai/insights : dechiffre la cle cote worker et appelle le fournisseur', async () => {
        const env = AI_ENV();
        let sentKey = null;
        fetchMock.mockImplementation(routeFetch([
            ['/auth/v1/user', () => ({ ok: true, json: async () => ({ id: 'user-42' }) })],
            ['/rest/v1/user_settings', () => ({ ok: true, json: async () => ([]) })],
            ['api.anthropic.com', (_u, opts) => {
                sentKey = opts.headers['x-api-key'];
                return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'RESUME IA' }] }) };
            }]
        ]));

        await aiCall('/ai/key', {
            env, headers: { Authorization: 'Bearer jwt-xyz' },
            body: { provider: 'anthropic', key: 'sk-ant-SECRET-KEY' }
        });
        const res = await aiCall('/ai/insights', {
            env, headers: { Authorization: 'Bearer jwt-xyz' },
            body: { provider: 'anthropic', prompt: 'analyse', liveSearch: true }
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.text).toBe('RESUME IA');
        expect(sentKey).toBe('sk-ant-SECRET-KEY');
    });

    it('POST /ai/insights : 400 si aucune cle enregistree pour le fournisseur', async () => {
        const env = AI_ENV();
        fetchMock.mockImplementation(routeFetch([
            ['/auth/v1/user', () => ({ ok: true, json: async () => ({ id: 'user-42' }) })]
        ]));
        const res = await aiCall('/ai/insights', {
            env, headers: { Authorization: 'Bearer jwt-xyz' },
            body: { provider: 'anthropic', prompt: 'analyse' }
        });
        expect(res.status).toBe(400);
    });

    it('DELETE /ai/key : retire la cle stockee', async () => {
        const env = AI_ENV();
        env.WEBSEARCH_KV._map.set('aikey:user-42:anthropic', 'chiffre');
        fetchMock.mockImplementation(routeFetch([
            ['/auth/v1/user', () => ({ ok: true, json: async () => ({ id: 'user-42' }) })],
            ['/rest/v1/user_settings', () => ({ ok: true, json: async () => ([]) })]
        ]));

        const res = await aiCall('/ai/key?provider=anthropic', {
            method: 'DELETE', env, headers: { Authorization: 'Bearer jwt-xyz' }, body: undefined
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.configured).toEqual([]);
        expect(env.WEBSEARCH_KV._map.has('aikey:user-42:anthropic')).toBe(false);
    });

    it('401 si le JWT est rejete par Supabase', async () => {
        fetchMock.mockImplementation(routeFetch([
            ['/auth/v1/user', () => ({ ok: false, status: 401, json: async () => ({}) })]
        ]));
        const res = await aiCall('/ai/insights', {
            env: AI_ENV(), headers: { Authorization: 'Bearer bad' }, body: { provider: 'anthropic', prompt: 'x' }
        });
        expect(res.status).toBe(401);
    });

    it('POST /ai/key : 502 explicite si l ecriture user_settings echoue (RLS / schema)', async () => {
        const env = AI_ENV();
        fetchMock.mockImplementation(routeFetch([
            ['/auth/v1/user', () => ({ ok: true, json: async () => ({ id: 'user-42' }) })],
            ['/rest/v1/user_settings', (_u, opts) => (opts.method === 'GET'
                ? { ok: true, json: async () => ([]) }
                : { ok: false, status: 400, text: async () => '{"code":"42703","message":"column ... does not exist"}' })]
        ]));

        const res = await aiCall('/ai/key', {
            env, headers: { Authorization: 'Bearer jwt-xyz' },
            body: { provider: 'anthropic', key: 'sk-ant-SECRET-KEY' }
        });
        const data = await res.json();

        expect(res.status).toBe(502);
        expect(data.error).toMatch(/42703|HTTP 400/);
    });
});

describe('/quote', () => {
    it('renvoie 400 si symbol manquant', async () => {
        const res = await call('/quote');
        expect(res.status).toBe(400);
    });

    it('renvoie le prix courant depuis regularMarketPrice', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(chartResult({ symbol: 'AAPL', regularMarketPrice: 225.5, currency: 'USD' })));
        const res = await call('/quote?symbol=AAPL');
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=60');
        expect(await res.json()).toEqual({ symbol: 'AAPL', price: 225.5, currency: 'USD' });
    });

    it('retombe sur le dernier close valide si regularMarketPrice absent', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(chartResult({ closes: [100, null, 108.2] })));
        const res = await call('/quote?symbol=AAPL');
        expect((await res.json()).price).toBe(108.2);
    });

    it('renvoie 502 si le symbole est introuvable', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({ chart: { result: null, error: { description: 'No data found' } } }));
        const res = await call('/quote?symbol=NOPE');
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/No data found/);
    });
});

describe('/history', () => {
    it('renvoie 400 si un parametre manque', async () => {
        const res = await call('/history?symbol=AAPL&from=2026-01-01');
        expect(res.status).toBe(400);
    });

    it('mappe les timestamps sur des dates en ignorant les closes nulles', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(chartResult({
            timestamps: [1735689600, 1735776000],
            closes: [190.1, null]
        })));
        const res = await call('/history?symbol=AAPL&from=2025-01-01&to=2025-01-02');
        const body = await res.json();
        expect(body).toEqual({ '2025-01-01': 190.1 });
    });
});

describe('/dividends', () => {
    it('trie les dividendes par date croissante', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse(chartResult({
            dividends: {
                a: { date: 1750000000, amount: 0.25 },
                b: { date: 1700000000, amount: 0.24 }
            }
        })));
        const res = await call('/dividends?symbol=AAPL&from=2023-01-01&to=2026-01-01');
        const body = await res.json();
        expect(body.map(d => d.amountPerShare)).toEqual([0.24, 0.25]);
        expect(body[0].date < body[1].date).toBe(true);
    });
});

describe('/sector', () => {
    it('renvoie 502 sans FINNHUB_API_KEY', async () => {
        const res = await call('/sector?symbol=AAPL');
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/FINNHUB_API_KEY/);
    });

    it('ne consulte pas Finnhub pour un symbole non-US (place ou crypto)', async () => {
        const res = await call('/sector?symbol=MC.PA', { FINNHUB_API_KEY: 'key' });
        expect(await res.json()).toEqual({ sector: null });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renvoie le secteur Finnhub pour un symbole US', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({ finnhubIndustry: 'Technology' }));
        const res = await call('/sector?symbol=AAPL', { FINNHUB_API_KEY: 'key' });
        expect(await res.json()).toEqual({ sector: 'Technology' });
    });
});

describe('/earnings', () => {
    it('renvoie la prochaine publication triee par date', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({
            earningsCalendar: [
                { date: '2026-10-28', hour: 'amc', epsEstimate: 2.02, revenueEstimate: 9e10 },
                { date: '2026-08-01', hour: 'bmo', epsEstimate: 1.5, revenueEstimate: 8e10 }
            ]
        }));
        const res = await call('/earnings?symbol=AAPL', { FINNHUB_API_KEY: 'key' });
        expect(await res.json()).toEqual({ date: '2026-08-01', hour: 'bmo', epsEstimate: 1.5, revenueEstimate: 8e10 });
    });

    it('renvoie date null si aucune publication a venir', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({ earningsCalendar: [] }));
        const res = await call('/earnings?symbol=AAPL', { FINNHUB_API_KEY: 'key' });
        expect(await res.json()).toEqual({ date: null });
    });

    it('ne consulte pas Finnhub pour un symbole non-US (place ou crypto)', async () => {
        const res = await call('/earnings?symbol=MC.PA', { FINNHUB_API_KEY: 'key' });
        expect(await res.json()).toEqual({ date: null });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('/search', () => {
    it('filtre les resultats sans symbole et normalise les champs', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({
            quotes: [
                { symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY' },
                { longname: 'Sans symbole' }
            ]
        }));
        const res = await call('/search?q=apple');
        expect(await res.json()).toEqual([{ displaySymbol: 'AAPL', description: 'Apple Inc.', type: 'EQUITY' }]);
    });
});

describe('/websearch', () => {
    it('renvoie 400 si q manquant', async () => {
        const res = await call('/websearch');
        expect(res.status).toBe(400);
    });

    it('renvoie 502 sans TAVILY_API_KEY', async () => {
        const res = await call('/websearch?q=AAPL');
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/TAVILY_API_KEY/);
    });

    it('interroge Tavily et normalise les resultats', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({
            results: [
                { title: 'Apple Q3', url: 'https://example.com', content: 'Resultats records', published_date: '2026-07-31' },
                { title: 'Sans date', url: 'https://example.com/2', content: 'Autre actu' }
            ]
        }));
        const res = await call('/websearch?q=AAPL%20actualite', { TAVILY_API_KEY: 'tvly-key' });

        expect(fetchMock).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({ method: 'POST' }));
        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sentBody).toMatchObject({ api_key: 'tvly-key', query: 'AAPL actualite', topic: 'news' });

        expect(await res.json()).toEqual({
            results: [
                { title: 'Apple Q3', url: 'https://example.com', content: 'Resultats records', publishedDate: '2026-07-31' },
                { title: 'Sans date', url: 'https://example.com/2', content: 'Autre actu', publishedDate: null }
            ]
        });
    });

    function kvMock(store = {}) {
        return {
            get: vi.fn(async (key, type) => {
                const v = store[key];
                if (v === undefined) return null;
                return type === 'json' ? JSON.parse(v) : v;
            }),
            put: vi.fn(async (key, value) => { store[key] = value; })
        };
    }

    it('sert le resultat en cache sans rappeler Tavily', async () => {
        const results = [{ title: 'Cached', url: 'https://example.com', content: 'x', publishedDate: null }];
        const kv = kvMock({ 'q:aapl': JSON.stringify(results) });
        const res = await call('/websearch?q=AAPL', { TAVILY_API_KEY: 'tvly-key', WEBSEARCH_KV: kv });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.json()).toEqual({ results });
    });

    it('renvoie 502 quand la limite quotidienne est atteinte', async () => {
        const kv = kvMock({ [`rl:${new Date().toISOString().slice(0, 10)}`]: '30' });
        const res = await call('/websearch?q=AAPL', { TAVILY_API_KEY: 'tvly-key', WEBSEARCH_KV: kv });
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/Limite quotidienne/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('incremente le compteur quotidien et met le resultat en cache lors d\'un appel Tavily reel', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({ results: [] }));
        const kv = kvMock();
        await call('/websearch?q=AAPL', { TAVILY_API_KEY: 'tvly-key', WEBSEARCH_KV: kv });

        const rlKey = `rl:${new Date().toISOString().slice(0, 10)}`;
        expect(kv.put).toHaveBeenCalledWith(rlKey, '1', { expirationTtl: 172800 });
        expect(kv.put).toHaveBeenCalledWith('q:aapl', JSON.stringify([]), { expirationTtl: 1800 });
    });
});

describe('/quoteSummary', () => {
    it('renvoie 400 si symbol manquant', async () => {
        const res = await call('/quoteSummary');
        expect(res.status).toBe(400);
    });

    it('normalise la reponse Yahoo v10 (raw extrait, champs a plat)', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({
            quoteSummary: {
                result: [{
                    price: { longName: 'Microsoft', currency: 'USD', regularMarketPrice: { raw: 420.5 }, regularMarketPreviousClose: { raw: 415 }, marketCap: { raw: 3.1e12 } },
                    defaultKeyStatistics: { forwardPE: { raw: 32 }, pegRatio: { raw: 2.1 }, enterpriseToEbitda: { raw: 24 }, heldPercentInstitutions: { raw: 0.73 }, shortPercentOfFloat: { raw: 0.006 } },
                    financialData: { targetMeanPrice: { raw: 480 }, numberOfAnalystOpinions: { raw: 45 }, grossMargins: { raw: 0.68 }, recommendationKey: 'buy' },
                    summaryDetail: { dividendYield: { raw: 0.0072 }, payoutRatio: { raw: 0.25 }, fiftyTwoWeekHigh: { raw: 470 }, averageVolume: { raw: 22000000 }, exDividendDate: { raw: 1755129600 } },
                    recommendationTrend: { trend: [{ period: '0m', strongBuy: 20, buy: 15, hold: 8, sell: 1, strongSell: 0 }] },
                    earningsTrend: { trend: [{ period: '+1q', endDate: '2025-09-30', earningsEstimate: { avg: { raw: 3.1 }, numberOfAnalysts: { raw: 30 } }, revenueEstimate: { avg: { raw: 64000 } } }] },
                    assetProfile: { sector: 'Technology', industry: 'Software', country: 'United States', website: 'https://microsoft.com', longBusinessSummary: 'MSFT.', overallRisk: 1, auditRisk: 4, boardRisk: 1, compensationRisk: 8, shareHolderRightsRisk: 1 }
                }]
            }
        }));
        const res = await call('/quoteSummary?symbol=MSFT');
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body).toMatchObject({
            symbol: 'MSFT', source: 'yahoo-quoteSummary', name: 'Microsoft',
            price: 420.5, previousClose: 415, peForward: 32, pegRatio: 2.1,
            enterpriseToEbitda: 24, heldPercentInstitutions: 0.73, shortPercentOfFloat: 0.006,
            targetMeanPrice: 480, numberOfAnalystOpinions: 45, grossMargins: 0.68,
            payoutRatio: 0.25, sector: 'Technology', recommendationKey: 'buy',
            averageVolume: 22000000,
            exDividendDate: '2025-08-14',
            governance: { overall: 1, audit: 4, board: 1, compensation: 8, shareholderRights: 1 }
        });
        expect(body.recommendationTrend).toEqual({ strongBuy: 20, buy: 15, hold: 8, sell: 1, strongSell: 0 });
        expect(body.estimates[0]).toMatchObject({ period: '+1q', epsAvg: 3.1, revenueAvg: 64000, analysts: 30 });
        expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=3600/);
    });

    it('renvoie 502 si Yahoo repond en erreur', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({}, false, 500));
        const res = await call('/quoteSummary?symbol=MSFT');
        expect(res.status).toBe(502);
    });
});

describe('/fmp', () => {
    it('renvoie 400 si resource ou symbol manquant', async () => {
        expect((await call('/fmp?symbol=MSFT')).status).toBe(400);
        expect((await call('/fmp?resource=ratios')).status).toBe(400);
    });

    it('renvoie 400 pour une ressource hors whitelist', async () => {
        const res = await call('/fmp?symbol=MSFT&resource=../secrets', { FMP_API_KEY: 'k' });
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('appelle le bon endpoint FMP et met en cache 24h', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse([{ calendarYear: '2023', priceEarningsRatio: 34 }]));
        const res = await call('/fmp?symbol=msft&resource=ratios', { FMP_API_KEY: 'secret' });
        expect(res.status).toBe(200);
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('https://financialmodelingprep.com/api/v3/ratios/MSFT?period=annual&limit=6');
        expect(url).toContain('&apikey=secret');
        expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=86400/);
    });

    it('signale une ressource non couverte par le plan (Error Message -> unavailable)', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse({ 'Error Message': 'Exclusive Endpoint' }));
        const res = await call('/fmp?symbol=MSFT&resource=dcf', { FMP_API_KEY: 'secret' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ unavailable: true });
    });

    it('renvoie 502 sans FMP_API_KEY', async () => {
        const res = await call('/fmp?symbol=MSFT&resource=ratios');
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/FMP_API_KEY/);
    });
});

describe('/recommendation /insider /peers (Finnhub)', () => {
    it('renvoie 502 sans FINNHUB_API_KEY', async () => {
        const res = await call('/recommendation?symbol=AAPL');
        expect(res.status).toBe(502);
    });

    it('court-circuite les tickers non-US avec unavailable', async () => {
        const res = await call('/peers?symbol=MC.PA', { FINNHUB_API_KEY: 'key' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ unavailable: true, data: null });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('transmet la reponse Finnhub pour /recommendation', async () => {
        fetchMock.mockResolvedValue(jsonFetchResponse([{ strongBuy: 22, buy: 14, hold: 7, sell: 1, strongSell: 0, period: '2025-01-01' }]));
        const res = await call('/recommendation?symbol=AAPL', { FINNHUB_API_KEY: 'key' });
        expect(res.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toContain('finnhub.io/api/v1/stock/recommendation?symbol=AAPL&token=key');
        expect((await res.json())[0].strongBuy).toBe(22);
    });
});
