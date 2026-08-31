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
