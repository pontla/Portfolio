/**
 * Moteur de portefeuille : conversion de devises, validation et normalisation
 * des transactions, P&L, allocations, rendements, config IA du compte.
 *
 * Le module est importe directement. Les seules dependances externes du moteur
 * sont injectees : le client Supabase via setSupabaseClient(), le stockage local
 * et fetch via globalThis (cf. core/platform.js).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PortfolioService } from './portfolio.js';
import { Utils } from './utils.js';
import { AI_PROVIDERS } from './config.js';
import { jwtIssuedAt, isJwtTimingError } from './auth.js';
import { setSupabaseClient } from './supabase.js';

// --- stockage local minimal, lu par core/platform.js -----------------------

const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
        store.set(k, String(v));
    },
    removeItem: (k) => {
        store.delete(k);
    },
    clear: () => {
        store.clear();
    },
    key: () => null,
    get length() {
        return store.size;
    },
});

// --- double du client Supabase --------------------------------------------

/**
 * @param {{ maybeSingle?: Function, upsert?: Function, session?: any }} [overrides]
 */
function supabaseStub(overrides = {}) {
    const chain = {
        from() {
            return chain;
        },
        select() {
            return chain;
        },
        insert() {
            return chain;
        },
        update() {
            return chain;
        },
        delete() {
            return chain;
        },
        upsert: overrides.upsert || (() => Promise.resolve({ data: null, error: null })),
        eq() {
            return chain;
        },
        order() {
            return Promise.resolve({ data: [], error: null });
        },
        single() {
            return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: overrides.maybeSingle || (() => Promise.resolve({ data: null, error: null })),
        then(resolve) {
            return Promise.resolve({ data: [], error: null }).then(resolve);
        },
    };
    return {
        from() {
            return chain;
        },
        auth: { getSession: async () => ({ data: { session: overrides.session || null } }) },
    };
}

const DEFAULT_FETCH = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
});

/**
 * Cable les doubles pour un test : client Supabase, fetch, et magasin local
 * vide. Remplace l'ancien `loadApp()` qui reevaluait app.js dans un realm `vm`.
 */
/**
 * @param {{ maybeSingle?: Function, upsert?: Function, session?: any, fetch?: any }} [opts]
 */
function harness({ maybeSingle, upsert, session, fetch } = {}) {
    setSupabaseClient(supabaseStub({ maybeSingle, upsert, session }));
    globalThis.fetch = fetch || DEFAULT_FETCH;
    return { store };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
    store.clear();
    harness();
});
afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('PortfolioService - etat initial', () => {
    it('valeurs par defaut', () => {
        const svc = new PortfolioService();
        expect(svc.activePortfolioId).toBe('GLOBAL');
        expect(svc.fxRate).toBe(1.08);
        expect(svc.trades).toEqual([]);
        expect(svc.portfolios).toEqual([]);
    });
});

describe('PortfolioService.convertCurrency', () => {
    let svc;
    beforeEach(() => {
        svc = new PortfolioService();
    });

    it('identite si meme devise', () => {
        expect(svc.convertCurrency(100, 'USD', 'USD')).toBe(100);
    });

    it('EUR -> USD multiplie par le taux', () => {
        expect(svc.convertCurrency(100, 'EUR', 'USD')).toBeCloseTo(108);
    });

    it('USD -> EUR divise par le taux', () => {
        expect(svc.convertCurrency(108, 'USD', 'EUR')).toBeCloseTo(100);
    });

    it('respecte fxRate modifie', () => {
        svc.fxRate = 1.25;
        expect(svc.convertCurrency(100, 'EUR', 'USD')).toBeCloseTo(125);
    });

    it('GBP/CAD convertis via fxRates par defaut', () => {
        expect(svc.convertCurrency(100, 'GBP', 'USD')).toBeCloseTo(127);
        expect(svc.convertCurrency(100, 'CAD', 'USD')).toBeCloseTo(73);
    });

    it('devise inconnue = valeur inchangee', () => {
        expect(svc.convertCurrency(100, 'XYZ', 'USD')).toBe(100);
    });
});

describe('PortfolioService - filtrage & tri des transactions', () => {
    let svc;
    beforeEach(() => {
        svc = new PortfolioService();
        svc.portfolios = [
            { id: 'p1', name: 'A' },
            { id: 'p2', name: 'B' },
        ];
        svc.trades = [
            {
                id: 't3',
                portfolioId: 'p2',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 10,
                amount: 10,
                fees: 0,
                date: '2026-03-01',
            },
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'MSFT',
                qty: 1,
                price: 20,
                amount: 20,
                fees: 0,
                date: '2026-01-01',
            },
            {
                id: 't2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'NVDA',
                qty: 1,
                price: 30,
                amount: 30,
                fees: 0,
                date: '2026-02-01',
            },
        ];
    });

    it('GLOBAL renvoie toutes les transactions triees par date croissante', () => {
        const sorted = svc.getSortedTrades();
        expect(sorted.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    });

    it('un portefeuille actif restreint le perimetre', () => {
        svc.activePortfolioId = 'p1';
        expect(
            svc
                .getFilteredTrades()
                .map((t) => t.id)
                .sort()
        ).toEqual(['t1', 't2']);
    });

    it('getFirstTradeDate = date de la transaction la plus ancienne', () => {
        expect(Utils.getDateString(svc.getFirstTradeDate())).toBe('2026-01-01');
    });

    it('getFirstTradeDate = null sans transaction', () => {
        expect(new PortfolioService().getFirstTradeDate()).toBeNull();
    });
});

describe('PortfolioService - portefeuille actif', () => {
    it('GLOBAL renvoie un pseudo-portefeuille', () => {
        const svc = new PortfolioService();
        expect(svc.getActivePortfolio().name).toMatch(/Global/);
    });

    it('renvoie le portefeuille correspondant a l id', () => {
        const svc = new PortfolioService();
        svc.portfolios = [
            { id: 'p1', name: 'Principal' },
            { id: 'p2', name: 'Perso' },
        ];
        svc.activePortfolioId = 'p2';
        expect(svc.getActivePortfolio().name).toBe('Perso');
    });

    it('id inconnu repli sur le premier portefeuille', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'Principal' }];
        svc.activePortfolioId = 'zzz';
        expect(svc.getActivePortfolio().name).toBe('Principal');
    });

    it('getPortfolioById inconnu = objet "Inconnu"', () => {
        expect(new PortfolioService().getPortfolioById('nope').name).toBe('Inconnu');
    });
});

describe('PortfolioService.normalizeTradeInput', () => {
    let svc;
    beforeEach(() => {
        svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
    });

    it('BUY : majuscule le symbole, calcule le montant, rattache un portefeuille', () => {
        const n = svc.normalizeTradeInput({
            type: 'buy',
            symbol: '  aapl ',
            qty: '2',
            price: '10.5',
        });
        expect(n).toMatchObject({
            type: 'BUY',
            symbol: 'AAPL',
            qty: 2,
            price: 10.5,
            amount: 21,
            portfolioId: 'p1',
        });
        expect(n.date).toBe(Utils.getDateString());
    });

    it('DEPOSIT : symbole force a $CASH, prix 1, qty = montant', () => {
        const n = svc.normalizeTradeInput({ type: 'deposit', amount: '500' });
        expect(n).toMatchObject({
            type: 'DEPOSIT',
            symbol: '$CASH',
            amount: 500,
            qty: 500,
            price: 1,
        });
    });

    it('DIVIDEND : conserve le symbole, qty 1, prix = montant', () => {
        const n = svc.normalizeTradeInput({ type: 'dividend', symbol: 'aapl', amount: '12.3' });
        expect(n).toMatchObject({
            type: 'DIVIDEND',
            symbol: 'AAPL',
            qty: 1,
            price: 12.3,
            amount: 12.3,
        });
    });

    it('FEE : symbole $FEE', () => {
        const n = svc.normalizeTradeInput({ type: 'fee', amount: '3' });
        expect(n).toMatchObject({ type: 'FEE', symbol: '$FEE', amount: 3 });
    });
});

describe('PortfolioService.validateTrade', () => {
    let svc;
    beforeEach(() => {
        svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'p1';
    });

    const norm = (t) => svc.normalizeTradeInput(t);

    it('accepte un achat valide', () => {
        expect(() =>
            svc.validateTrade(
                norm({ type: 'buy', symbol: 'AAPL', qty: 1, price: 10, date: '2020-01-01' })
            )
        ).not.toThrow();
    });

    it('refuse une date future', () => {
        const future = new Date(Date.now() + 3 * 864e5);
        expect(() =>
            svc.validateTrade(
                norm({ type: 'buy', symbol: 'AAPL', qty: 1, price: 10, date: future })
            )
        ).toThrow(/futur/);
    });

    it('refuse une quantite <= 0', () => {
        expect(() =>
            svc.validateTrade(
                norm({ type: 'buy', symbol: 'AAPL', qty: 0, price: 10, date: '2020-01-01' })
            )
        ).toThrow(/Quantit/);
    });

    it('refuse un prix <= 0', () => {
        expect(() =>
            svc.validateTrade(
                norm({ type: 'buy', symbol: 'AAPL', qty: 1, price: 0, date: '2020-01-01' })
            )
        ).toThrow(/Prix/);
    });

    it('refuse de vendre plus que la quantite detenue', () => {
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 3,
                price: 10,
                amount: 30,
                fees: 0,
                date: '2020-01-01',
            },
        ];
        expect(() =>
            svc.validateTrade(
                norm({ type: 'sell', symbol: 'AAPL', qty: 5, price: 12, date: '2021-01-01' })
            )
        ).toThrow(/supérieure|detenue|détenue/i);
    });

    it('autorise une vente couverte par les achats', () => {
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 3,
                price: 10,
                amount: 30,
                fees: 0,
                date: '2020-01-01',
            },
        ];
        expect(() =>
            svc.validateTrade(
                norm({ type: 'sell', symbol: 'AAPL', qty: 2, price: 12, date: '2021-01-01' })
            )
        ).not.toThrow();
    });

    it('refuse un montant <= 0 pour un mouvement de cash', () => {
        expect(() =>
            svc.validateTrade(norm({ type: 'deposit', amount: 0, date: '2020-01-01' }))
        ).toThrow(/Montant/);
    });
});

describe('PortfolioService.calculatePortfolio', () => {
    function cashOnlyService() {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            {
                id: 'd1',
                portfolioId: 'p1',
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 1000,
                price: 1,
                amount: 1000,
                fees: 0,
                date: '2026-01-01',
            },
            {
                id: 'w1',
                portfolioId: 'p1',
                type: 'WITHDRAWAL',
                symbol: '$CASH',
                qty: 200,
                price: 1,
                amount: 200,
                fees: 0,
                date: '2026-01-05',
            },
            {
                id: 'v1',
                portfolioId: 'p1',
                type: 'DIVIDEND',
                symbol: 'AAPL',
                qty: 1,
                price: 50,
                amount: 50,
                fees: 0,
                date: '2026-02-01',
            },
            {
                id: 'f1',
                portfolioId: 'p1',
                type: 'FEE',
                symbol: '$FEE',
                qty: 1,
                price: 10,
                amount: 10,
                fees: 0,
                date: '2026-02-02',
            },
        ];
        return svc;
    }

    it('agrege depots / retraits / dividendes / frais (USD)', () => {
        const s = cashOnlyService().calculatePortfolio('USD');
        expect(s.cash).toBeCloseTo(850); // 1000 - 200 + 50 ; le FEE autonome ne bouge pas le cash affiche
        expect(s.totalDeposits).toBeCloseTo(1000);
        expect(s.totalWithdrawals).toBeCloseTo(200);
        expect(s.totalDividends).toBeCloseTo(50);
        expect(s.holdings).toEqual([]);
        expect(s.totalValue).toBeCloseTo(850);
        expect(s.totalPnL).toBeCloseTo(40); // dividendes 50 - frais autonomes 10
    });

    it('convertit le resultat dans la devise cible', () => {
        const svc = cashOnlyService();
        svc.fxRate = 1.08;
        const s = svc.calculatePortfolio('EUR');
        expect(s.cash).toBeCloseTo(850 / 1.08);
        expect(s.targetCurrency).toBe('EUR');
    });

    it('valorise une position a partir de marketPrices', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 2,
                price: 100,
                amount: 200,
                fees: 0,
                date: '2026-01-02',
            },
        ];
        svc.marketPrices = { AAPL: 150 };

        const s = svc.calculatePortfolio('USD');
        expect(s.holdings).toHaveLength(1);
        const h = s.holdings[0];
        expect(h.symbol).toBe('AAPL');
        expect(h.qty).toBe(2);
        expect(h.avgPrice).toBeCloseTo(100);
        expect(h.currentPrice).toBe(150);
        expect(h.valueNative).toBeCloseTo(300);
        expect(h.gainNative).toBeCloseTo(100);
        expect(h.gainPercent).toBeCloseTo(50);
        expect(h.weightPercent).toBeCloseTo(100);
        expect(s.holdingsValue).toBeCloseTo(300);
        expect(s.holdingsCost).toBeCloseTo(200);
        expect(s.unrealizedPnL).toBeCloseTo(100);
        expect(s.totalReturnPercent).toBeCloseTo(50);
    });

    it('realise le P&L a la vente et retire la ligne soldee', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 2,
                price: 100,
                amount: 200,
                fees: 0,
                date: '2026-01-02',
            },
            {
                id: 's1',
                portfolioId: 'p1',
                type: 'SELL',
                symbol: 'AAPL',
                qty: 2,
                price: 130,
                amount: 260,
                fees: 0,
                date: '2026-03-02',
            },
        ];
        svc.marketPrices = { AAPL: 150 };

        const s = svc.calculatePortfolio('USD');
        expect(s.holdings).toEqual([]);
        expect(s.realizedPnL).toBeCloseTo(60); // (130 - 100) * 2
    });
});

describe('helpers JWT (garde-fou horloge desynchronisee)', () => {
    const mkToken = (payload) => {
        const b64 = (o) =>
            Buffer.from(JSON.stringify(o))
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
    };

    it('jwtIssuedAt extrait le claim iat', () => {
        expect(jwtIssuedAt(mkToken({ iat: 1787834113, sub: 'u' }))).toBe(1787834113);
    });

    it('jwtIssuedAt renvoie null si jeton illisible ou sans iat', () => {
        expect(jwtIssuedAt('pas-un-jwt')).toBeNull();
        expect(jwtIssuedAt(mkToken({ sub: 'u' }))).toBeNull();
    });

    it('isJwtTimingError reconnait les erreurs d horloge Supabase/PostgREST', () => {
        expect(isJwtTimingError({ message: 'JWT issued at future timestamp' })).toBe(true);
        expect(isJwtTimingError({ message: 'token used before issued' })).toBe(true);
        expect(isJwtTimingError(new Error('JWSError JWSInvalidSignature'))).toBe(false);
        expect(isJwtTimingError({ message: 'relation "trades" does not exist' })).toBe(false);
        expect(isJwtTimingError(null)).toBe(false);
    });
});

describe('PortfolioService - config IA liée au compte', () => {
    const SESSION = { access_token: 'jwt-abc', user: { id: 'u-1' } };

    it('_loadAiConfig adopte ai_provider + ai_providers_configured de la ligne du compte', async () => {
        const { store } = harness({
            maybeSingle: () =>
                Promise.resolve({
                    data: { ai_provider: 'groq', ai_providers_configured: ['groq', 'openai'] },
                    error: null,
                }),
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';
        store.set('portfolio_ai_provider', 'anthropic');

        await svc._loadAiConfig();

        expect(svc.aiProvider).toBe('groq');
        expect(svc.aiConfigured).toEqual(['groq', 'openai']);
        expect(store.get('portfolio_ai_provider')).toBe('groq');
    });

    it('_loadAiConfig sans ligne garde le fournisseur en cache et aiConfigured vide', async () => {
        const { store } = harness({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';
        store.set('portfolio_ai_provider', 'anthropic');

        await svc._loadAiConfig();

        expect(svc.aiProvider).toBe('anthropic');
        expect(svc.aiConfigured).toEqual([]);
    });

    it('_loadAiConfig retombe sur le cache local si la table est absente', async () => {
        const { store } = harness({
            maybeSingle: () =>
                Promise.resolve({
                    data: null,
                    error: { message: 'relation "user_settings" does not exist' },
                }),
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';
        store.set('portfolio_ai_provider', 'grok');

        await svc._loadAiConfig();

        expect(svc.aiProvider).toBe('grok');
        expect(svc.aiConfigured).toEqual([]);
    });

    it('setAiProvider écrit la sélection (cache + upsert), sans toucher aux clés', async () => {
        const calls = [];
        const { store } = harness({
            upsert: (payload, opts) => {
                calls.push({ payload, opts });
                return Promise.resolve({ data: null, error: null });
            },
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';

        await svc.setAiProvider('openai');

        expect(svc.aiProvider).toBe('openai');
        expect(store.get('portfolio_ai_provider')).toBe('openai');
        expect(calls).toHaveLength(1);
        expect(calls[0].payload).toMatchObject({ user_id: 'u-1', ai_provider: 'openai' });
        expect(calls[0].payload).not.toHaveProperty('ai_keys');
        expect(calls[0].opts).toEqual({ onConflict: 'user_id' });
    });

    it('saveAiKey POST /ai/key avec le JWT, ne stocke jamais la clé en clair', async () => {
        const reqs = [];
        const { store } = harness({
            session: SESSION,
            fetch: async (urlArg, opts) => {
                reqs.push({ url: String(urlArg), opts });
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        provider: 'anthropic',
                        configured: ['anthropic'],
                    }),
                };
            },
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';

        await svc.saveAiKey('anthropic', 'sk-ant-secret');

        expect(svc.aiConfigured).toEqual(['anthropic']);
        expect(svc.aiProvider).toBe('anthropic');
        expect(reqs).toHaveLength(1);
        expect(reqs[0].url).toMatch(/\/ai\/key$/);
        expect(reqs[0].opts.method).toBe('POST');
        expect(reqs[0].opts.headers.Authorization).toBe('Bearer jwt-abc');
        expect(JSON.parse(reqs[0].opts.body)).toEqual({
            provider: 'anthropic',
            key: 'sk-ant-secret',
        });
        // aucune trace de la clé dans le stockage local
        expect(JSON.stringify([...store.entries()])).not.toContain('sk-ant-secret');
    });

    it('removeAiKey appelle DELETE /ai/key?provider= et rafraîchit aiConfigured', async () => {
        const reqs = [];
        harness({
            session: SESSION,
            fetch: async (urlArg, opts) => {
                reqs.push({ url: String(urlArg), method: opts && opts.method });
                return { ok: true, status: 200, json: async () => ({ ok: true, configured: [] }) };
            },
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';
        svc.aiConfigured = ['anthropic'];

        await svc.removeAiKey('anthropic');

        expect(svc.aiConfigured).toEqual([]);
        expect(reqs[0].method).toBe('DELETE');
        expect(reqs[0].url).toMatch(/\/ai\/key\?provider=anthropic$/);
    });

    it('AI_PROVIDERS ne contient plus de fonction call (appel déplacé côté worker)', () => {
        for (const p of Object.keys(AI_PROVIDERS)) {
            expect(typeof AI_PROVIDERS[p].call).toBe('undefined');
            expect(typeof AI_PROVIDERS[p].label).toBe('string');
        }
    });
});

// ---------------------------------------------------------------------------
// Phase 1 — couche de donnees d'analyse de valeur (AnalysisService / AnalysisUtils)
// ---------------------------------------------------------------------------

describe('PortfolioService : badge de periode et rendement annuel', () => {
    const dayStr = (offset) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        return Utils.getDateString(d);
    };

    it('un achat au prix du marche ne cree pas de perte sur le badge', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            // 1 titre paye 100, qui vaut 150 depuis. Puis un 2e titre achete 150,
            // au prix du marche : la plus-value moyenne tombe de +50 % a +20 %
            // sans qu'aucune perte n'ait eu lieu.
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 100,
                amount: 100,
                fees: 0,
                date: dayStr(-6),
            },
            {
                id: 'b2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 150,
                amount: 150,
                fees: 0,
                date: dayStr(-3),
            },
        ];
        svc.marketPrices = { AAPL: 150 };
        const prices = {};
        for (let i = -6; i <= 0; i++) prices[dayStr(i)] = 150;
        svc.dailyPriceCache = { AAPL: prices };

        const tl = svc.getHistoricalTimeline('1M', 'PERF', 'USD');
        // La serie base-cout chute bien de 50 a 20 : c'est de la dilution.
        expect(tl.perfValues[0]).toBeCloseTo(50, 6);
        expect(tl.perfValues[tl.perfValues.length - 1]).toBeCloseTo(20, 6);
        // Le badge, lui, mesure le rendement reel : le cours n'a pas bouge.
        expect(tl.rangeStats['1M']).toBeCloseTo(0, 6);
    });

    it('le badge reflete la hausse reelle du cours, sans mouvement', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 100,
                amount: 100,
                fees: 0,
                date: dayStr(-6),
            },
        ];
        svc.marketPrices = { AAPL: 155 };
        const prices = {};
        for (let i = -6; i <= 0; i++) prices[dayStr(i)] = i <= -4 ? 150 : 155;
        svc.dailyPriceCache = { AAPL: prices };

        const tl = svc.getHistoricalTimeline('1M', 'PERF', 'USD');
        // 150 -> 155, soit +3,33 %, et non la difference +55 - +50 = 5 points.
        expect(tl.rangeStats['1M']).toBeCloseTo((155 / 150 - 1) * 100, 4);
    });

    it('le rendement annuel pondere les apports par leur duree de presence', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        const y = new Date().getFullYear();
        svc.trades = [
            {
                id: 'd1',
                portfolioId: 'p1',
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 1,
                price: 1,
                amount: 10000,
                fees: 0,
                date: `${y}-01-01`,
            },
            // Gros apport tardif : il ne doit presque pas peser au denominateur.
            {
                id: 'd2',
                portfolioId: 'p1',
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 1,
                price: 1,
                amount: 90000,
                fees: 0,
                date: dayStr(-2),
            },
            {
                id: 'v1',
                portfolioId: 'p1',
                type: 'DIVIDEND',
                symbol: 'AAPL',
                qty: 1,
                price: 5000,
                amount: 5000,
                fees: 0,
                date: dayStr(-1),
            },
        ];
        svc.marketPrices = {};
        svc.dailyPriceCache = {};

        const perf = svc.getYearlyPerformance('USD');
        expect(perf.ytd.profit).toBeCloseTo(5000, 6);
        // Avant correction : 5000 / 10000 = +50 %, l'apport de 90 000 etant ignore.
        // Le capital moyen mobilise est bien superieur a 10 000.
        expect(perf.ytd.percent).toBeLessThan(50);
        expect(perf.ytd.percent).toBeGreaterThan(0);
    });
});

describe('PortfolioService.computeProfitAsOf : devise du prix de repli', () => {
    it('une position en euros n est pas convertie deux fois', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.fxRate = 1.08;
        svc.fxRates = { EUR: 1.08 };
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AIR.PA',
                qty: 10,
                price: 100,
                amount: 1000,
                fees: 0,
                date: '2026-01-02',
            },
        ];
        // Ni historique ni prix live : `getPriceOnDate` retombe sur le prix passe
        // en repli, qui doit etre exprime en euros comme les cours de AIR.PA.
        svc.dailyPriceCache = {};
        svc.marketPrices = {};

        const out = svc.computeProfitAsOf('2026-01-10', 'USD');
        // Repli = PRU : la position vaut exactement son cout, donc zero latent.
        // Avant correction le PRU (stocke en USD) etait reconverti EUR -> USD :
        // 1 166,4 au lieu de 1 080, soit +86,4 USD de plus-value fantome.
        expect(out.totalPnL).toBeCloseTo(0, 6);
    });
});
