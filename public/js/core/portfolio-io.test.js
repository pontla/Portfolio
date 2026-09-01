/**
 * Couche de persistance du moteur : chargement Supabase, CRUD des portefeuilles
 * et des transactions, rafraichissement des prix, synchronisation des
 * dividendes, import / export CSV.
 *
 * Tout ce qui touche au reseau est injecte : le client Supabase par
 * setSupabaseClient(), les appels marche en remplacant les methodes d'APIService.
 * Le double Supabase ci-dessous imite PostgREST d'assez pres pour que les
 * chainages du moteur (`insert().select().single()`, `update().eq()`) passent
 * tels quels, et il enregistre les appels pour qu'on puisse verifier ce qui est
 * reellement envoye au serveur.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PortfolioService } from './portfolio.js';
import { Utils } from './utils.js';
import { APIService } from './api.js';
import { CONFIG } from './config.js';
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

const SESSION = { access_token: 'header.payload.sig', user: { id: 'user-1' } };

/**
 * Construit un jeton dont l'iat vaut `iatSeconds` (le reste n'est pas lu).
 * @param {number} iatSeconds
 */
function tokenWithIat(iatSeconds) {
    const payload = Buffer.from(JSON.stringify({ iat: iatSeconds })).toString('base64');
    return `header.${payload}.sig`;
}

/**
 * @param {{
 *   portfolioRows?: any[], tradeRows?: any[], userSettings?: any,
 *   session?: any, errors?: Record<string, any>, failFetchOnce?: any,
 * }} [opts]
 */
function supabaseFake(opts = {}) {
    const {
        portfolioRows = [],
        tradeRows = [],
        userSettings = null,
        session = SESSION,
        errors = {},
        failFetchOnce = null,
    } = opts;

    /** @type {{ table: string, op: string, payload: any, filters: any }[]} */
    const calls = [];
    let seq = 0;
    let refreshed = 0;
    let selectsOnTrades = 0;

    function settle(state, shape) {
        calls.push({
            table: state.table,
            op: state.op,
            payload: state.payload,
            filters: { ...state.filters },
        });

        const forced = errors[`${state.table}:${state.op}`];
        if (forced) return Promise.resolve({ data: null, error: forced });

        // Un echec de lecture qui ne se produit qu'au premier appel, pour
        // exercer le rattrapage de jeton de load().
        if (state.op === 'select' && failFetchOnce && selectsOnTrades++ === 0) {
            return Promise.resolve({ data: null, error: failFetchOnce });
        }

        if (state.op === 'select') {
            if (state.table === 'portfolios') return resolveList(portfolioRows);
            if (state.table === 'trades') return resolveList(tradeRows);
            if (state.table === 'user_settings') {
                return Promise.resolve({ data: userSettings, error: null });
            }
            return resolveList([]);
        }

        if (state.op === 'insert') {
            const stamp = (row, i) => ({
                id: `${state.table}-${++seq}-${i}`,
                created_at: '2026-01-01T00:00:00Z',
                ...row,
            });
            const rows = Array.isArray(state.payload)
                ? state.payload.map(stamp)
                : [stamp(state.payload, 0)];
            return shape === 'single'
                ? Promise.resolve({ data: rows[0], error: null })
                : Promise.resolve({ data: rows, error: null });
        }

        if (state.op === 'update') {
            const row = { id: state.filters.id, ...state.payload };
            return shape === 'single'
                ? Promise.resolve({ data: row, error: null })
                : Promise.resolve({ data: [row], error: null });
        }

        return Promise.resolve({ data: null, error: null });

        function resolveList(rows) {
            return shape === 'single' || shape === 'maybeSingle'
                ? Promise.resolve({ data: rows[0] ?? null, error: null })
                : Promise.resolve({ data: rows, error: null });
        }
    }

    function makeChain(table) {
        const state = { table, op: '', payload: null, filters: {} };
        const chain = {
            select() {
                if (!state.op) state.op = 'select';
                return chain;
            },
            insert(p) {
                state.op = 'insert';
                state.payload = p;
                return chain;
            },
            update(p) {
                state.op = 'update';
                state.payload = p;
                return chain;
            },
            delete() {
                state.op = 'delete';
                return chain;
            },
            upsert(p) {
                state.op = 'upsert';
                state.payload = p;
                return chain;
            },
            eq(col, val) {
                state.filters[col] = val;
                return chain;
            },
            order() {
                return chain;
            },
            single() {
                return settle(state, 'single');
            },
            maybeSingle() {
                return settle(state, 'maybeSingle');
            },
            then(res, rej) {
                return settle(state, 'list').then(res, rej);
            },
        };
        return chain;
    }

    const client = {
        from: (table) => makeChain(table),
        auth: {
            getSession: async () => ({ data: { session } }),
            refreshSession: async () => {
                refreshed++;
                return { data: { session }, error: null };
            },
        },
    };

    return {
        client,
        calls,
        /** Appels enregistres pour une table et une operation donnees. */
        of: (table, op) => calls.filter((c) => c.table === table && c.op === op),
        refreshCount: () => refreshed,
    };
}

/** Injecte le double et renvoie son journal d'appels. */
function harness(opts = {}) {
    const fake = supabaseFake(opts);
    setSupabaseClient(/** @type {any} */ (fake.client));
    return fake;
}

// --- doubles des appels marche --------------------------------------------

const realApi = {
    getCurrentPrice: APIService.getCurrentPrice,
    getExchangeRates: APIService.getExchangeRates,
    getDailyHistory: APIService.getDailyHistory,
    getDividends: APIService.getDividends,
};

/** Prix et taux inertes : refreshPrices est declenche par presque tout le CRUD. */
function stubMarket({ prices = {}, rates = { USD: 1, EUR: 1.08 }, history = {} } = {}) {
    const seen = { history: [] };
    APIService.getCurrentPrice = async (sym) => prices[sym] ?? 0;
    APIService.getExchangeRates = async () => rates;
    APIService.getDailyHistory = async (sym, start, end, anchor, current) => {
        seen.history.push({ sym, anchor, current });
        return history[sym] || {};
    };
    return seen;
}

/** Date decalee de `days` jours, au format YYYY-MM-DD. */
function dayOffset(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return Utils.getDateString(d);
}

beforeEach(() => {
    store.clear();
    stubMarket();
    harness();
});
afterEach(() => {
    Object.assign(APIService, realApi);
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('PortfolioService.load', () => {
    it('sans session : erreur explicite', async () => {
        harness({ session: null });
        await expect(new PortfolioService().load()).rejects.toThrow('Pas de session active');
    });

    it('mappe les colonnes snake_case et convertit les nombres', async () => {
        harness({
            portfolioRows: [
                { id: 'p1', name: 'Principal', color: '#111', created_at: '2026-01-01' },
            ],
            tradeRows: [
                {
                    id: 't1',
                    portfolio_id: 'p1',
                    type: 'BUY',
                    symbol: 'AAPL',
                    qty: '10',
                    price: '150.5',
                    amount: '1505',
                    fees: '1.2',
                    fx_rate: '1',
                    date: '2026-02-01',
                },
            ],
        });
        const svc = new PortfolioService();
        await svc.load();

        expect(svc.userId).toBe('user-1');
        expect(svc.portfolios).toEqual([
            { id: 'p1', name: 'Principal', color: '#111', createdAt: '2026-01-01' },
        ]);
        expect(svc.trades[0]).toEqual({
            id: 't1',
            portfolioId: 'p1',
            type: 'BUY',
            symbol: 'AAPL',
            qty: 10,
            price: 150.5,
            amount: 1505,
            fees: 1.2,
            fxRate: 1,
            date: '2026-02-01',
        });
    });

    it('fees et fx_rate absents : 0 et null plutot que NaN', async () => {
        harness({
            portfolioRows: [{ id: 'p1', name: 'P', color: '#111' }],
            tradeRows: [
                {
                    id: 't1',
                    portfolio_id: 'p1',
                    type: 'BUY',
                    symbol: 'AAPL',
                    qty: 1,
                    price: 10,
                    amount: 10,
                    fees: null,
                    fx_rate: null,
                    date: '2026-02-01',
                },
            ],
        });
        const svc = new PortfolioService();
        await svc.load();
        expect(svc.trades[0].fees).toBe(0);
        expect(svc.trades[0].fxRate).toBeNull();
    });

    it('compte vierge : cree un portefeuille par defaut', async () => {
        const fake = harness({ portfolioRows: [] });
        const svc = new PortfolioService();
        await svc.load();

        expect(svc.portfolios).toHaveLength(1);
        expect(svc.portfolios[0].name).toBe('Portefeuille Principal');
        expect(fake.of('portfolios', 'insert')[0].payload).toMatchObject({
            user_id: 'user-1',
            name: 'Portefeuille Principal',
            color: '#3b82f6',
        });
    });

    it('reprend le portefeuille actif memorise localement', async () => {
        harness({
            portfolioRows: [
                { id: 'p1', name: 'A', color: '#111' },
                { id: 'p2', name: 'B', color: '#222' },
            ],
        });
        store.set(CONFIG.ACTIVE_PORTFOLIO_STORAGE, 'p2');
        const svc = new PortfolioService();
        await svc.load();
        expect(svc.activePortfolioId).toBe('p2');
    });

    it('portefeuille memorise disparu : repli sur le premier', async () => {
        harness({ portfolioRows: [{ id: 'p1', name: 'A', color: '#111' }] });
        store.set(CONFIG.ACTIVE_PORTFOLIO_STORAGE, 'p-supprime');
        const svc = new PortfolioService();
        await svc.load();
        expect(svc.activePortfolioId).toBe('p1');
    });

    it('la vue consolidee memorisee est conservee', async () => {
        harness({ portfolioRows: [{ id: 'p1', name: 'A', color: '#111' }] });
        store.set(CONFIG.ACTIVE_PORTFOLIO_STORAGE, 'GLOBAL');
        const svc = new PortfolioService();
        await svc.load();
        expect(svc.activePortfolioId).toBe('GLOBAL');
    });

    it('jeton emis dans le futur : rafraichi avant la lecture', async () => {
        const future = Math.floor(Date.now() / 1000) + 600;
        const fake = harness({
            session: { access_token: tokenWithIat(future), user: { id: 'user-1' } },
            portfolioRows: [{ id: 'p1', name: 'A', color: '#111' }],
        });
        await new PortfolioService().load();
        expect(fake.refreshCount()).toBe(1);
    });

    it('jeton dans le passe : aucun rafraichissement', async () => {
        const past = Math.floor(Date.now() / 1000) - 600;
        const fake = harness({
            session: { access_token: tokenWithIat(past), user: { id: 'user-1' } },
            portfolioRows: [{ id: 'p1', name: 'A', color: '#111' }],
        });
        await new PortfolioService().load();
        expect(fake.refreshCount()).toBe(0);
    });

    it('erreur d horodatage du jeton : rafraichit, attend, puis reessaie', async () => {
        vi.useFakeTimers();
        const fake = harness({
            portfolioRows: [{ id: 'p1', name: 'A', color: '#111' }],
            failFetchOnce: { message: 'JWT issued at future date' },
        });
        const svc = new PortfolioService();
        const done = svc.load();
        await vi.advanceTimersByTimeAsync(3000);
        await done;

        expect(fake.refreshCount()).toBe(1);
        expect(svc.portfolios).toHaveLength(1);
        // Deux tentatives de lecture des portefeuilles : l'echouee et la reussie.
        expect(fake.of('portfolios', 'select')).toHaveLength(2);
    });

    it('erreur de lecture sans rapport avec le jeton : propagee telle quelle', async () => {
        harness({ errors: { 'portfolios:select': { message: 'permission denied' } } });
        await expect(new PortfolioService().load()).rejects.toMatchObject({
            message: 'permission denied',
        });
    });

    it('charge la config IA du compte', async () => {
        harness({
            portfolioRows: [{ id: 'p1', name: 'A', color: '#111' }],
            userSettings: { ai_provider: 'anthropic', ai_providers_configured: ['anthropic'] },
        });
        const svc = new PortfolioService();
        await svc.load();
        expect(svc.aiProvider).toBe('anthropic');
        expect(svc.aiConfigured).toEqual(['anthropic']);
    });
});

describe('PortfolioService - CRUD des portefeuilles', () => {
    /** @type {PortfolioService} */
    let svc;
    let fake;

    beforeEach(() => {
        fake = harness();
        svc = new PortfolioService();
        svc.userId = 'user-1';
        svc.portfolios = [{ id: 'p1', name: 'Principal', color: '#111' }];
        svc.activePortfolioId = 'p1';
    });

    it('createPortfolio : nom vide refuse', async () => {
        await expect(svc.createPortfolio('   ')).rejects.toThrow('Nom de portefeuille requis');
        expect(fake.of('portfolios', 'insert')).toHaveLength(0);
    });

    it('createPortfolio : doublon refuse sans tenir compte de la casse', async () => {
        await expect(svc.createPortfolio('principal')).rejects.toThrow('existe déjà');
        expect(fake.of('portfolios', 'insert')).toHaveLength(0);
    });

    it('createPortfolio : insere, ajoute localement et rend actif', async () => {
        const created = await svc.createPortfolio('  Crypto  ', '#abc');
        expect(fake.of('portfolios', 'insert')[0].payload).toMatchObject({
            user_id: 'user-1',
            name: 'Crypto',
            color: '#abc',
        });
        expect(svc.portfolios).toHaveLength(2);
        expect(svc.activePortfolioId).toBe(created.id);
        expect(store.get(CONFIG.ACTIVE_PORTFOLIO_STORAGE)).toBe(created.id);
    });

    it('createPortfolio : couleur par defaut si absente', async () => {
        await svc.createPortfolio('Crypto');
        expect(fake.of('portfolios', 'insert')[0].payload.color).toBe('#3b82f6');
    });

    it('createPortfolio : erreur serveur propagee', async () => {
        fake = harness({ errors: { 'portfolios:insert': { message: 'RLS' } } });
        await expect(svc.createPortfolio('Crypto')).rejects.toMatchObject({ message: 'RLS' });
    });

    it('renamePortfolio : nom vide refuse', async () => {
        await expect(svc.renamePortfolio('p1', ' ')).rejects.toThrow('Nom de portefeuille requis');
    });

    it('renamePortfolio : collision avec un autre portefeuille refusee', async () => {
        svc.portfolios.push({ id: 'p2', name: 'Crypto', color: '#222' });
        await expect(svc.renamePortfolio('p1', 'CRYPTO')).rejects.toThrow('existe déjà');
    });

    it('renamePortfolio : garder son propre nom est autorise', async () => {
        await expect(svc.renamePortfolio('p1', 'Principal', '#999')).resolves.toBeUndefined();
        expect(svc.portfolios[0].color).toBe('#999');
    });

    it('renamePortfolio : met a jour le nom localement, couleur inchangee sans argument', async () => {
        await svc.renamePortfolio('p1', 'Long terme');
        expect(svc.portfolios[0]).toMatchObject({ name: 'Long terme', color: '#111' });
        expect(fake.of('portfolios', 'update')[0]).toMatchObject({
            payload: { name: 'Long terme' },
            filters: { id: 'p1' },
        });
    });

    it('deletePortfolio : refus silencieux quand il n en reste qu un', async () => {
        await expect(svc.deletePortfolio('p1')).resolves.toBe(false);
        expect(fake.of('portfolios', 'delete')).toHaveLength(0);
        expect(svc.portfolios).toHaveLength(1);
    });

    it('deletePortfolio : supprime le portefeuille et ses transactions locales', async () => {
        svc.portfolios.push({ id: 'p2', name: 'Crypto', color: '#222' });
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 1,
                amount: 1,
                date: '2026-01-01',
            },
            {
                id: 't2',
                portfolioId: 'p2',
                type: 'BUY',
                symbol: 'BTC-USD',
                qty: 1,
                price: 1,
                amount: 1,
                date: '2026-01-01',
            },
        ];
        await expect(svc.deletePortfolio('p2')).resolves.toBe(true);
        expect(svc.portfolios.map((p) => p.id)).toEqual(['p1']);
        expect(svc.trades.map((t) => t.id)).toEqual(['t1']);
        expect(fake.of('portfolios', 'delete')[0].filters).toEqual({ id: 'p2' });
    });

    it('deletePortfolio : bascule sur le premier restant si l actif est supprime', async () => {
        svc.portfolios.push({ id: 'p2', name: 'Crypto', color: '#222' });
        svc.activePortfolioId = 'p2';
        await svc.deletePortfolio('p2');
        expect(svc.activePortfolioId).toBe('p1');
    });

    it('setActivePortfolio : memorise le choix localement', () => {
        svc.setActivePortfolio('GLOBAL');
        expect(svc.activePortfolioId).toBe('GLOBAL');
        expect(store.get(CONFIG.ACTIVE_PORTFOLIO_STORAGE)).toBe('GLOBAL');
    });
});

describe('PortfolioService - CRUD des transactions', () => {
    /** @type {PortfolioService} */
    let svc;
    let fake;

    beforeEach(() => {
        fake = harness();
        svc = new PortfolioService();
        svc.userId = 'user-1';
        svc.portfolios = [{ id: 'p1', name: 'Principal', color: '#111' }];
        svc.activePortfolioId = 'p1';
    });

    it('addTrade : envoie une ligne snake_case et ajoute le retour serveur', async () => {
        const created = await svc.addTrade({
            type: 'buy',
            symbol: ' aapl ',
            qty: '10',
            price: '150',
            date: dayOffset(-1),
        });

        expect(fake.of('trades', 'insert')[0].payload).toMatchObject({
            user_id: 'user-1',
            portfolio_id: 'p1',
            type: 'BUY',
            symbol: 'AAPL',
            qty: 10,
            price: 150,
            amount: 1500,
            fees: 0,
        });
        expect(svc.trades).toHaveLength(1);
        expect(svc.trades[0]).toBe(created);
        expect(created.id).toMatch(/^trades-/);
    });

    it('addTrade : une transaction invalide n atteint pas le serveur', async () => {
        await expect(
            svc.addTrade({ type: 'BUY', symbol: 'AAPL', qty: 1, price: 10, date: dayOffset(3) })
        ).rejects.toThrow('futur');
        expect(fake.of('trades', 'insert')).toHaveLength(0);
        expect(svc.trades).toHaveLength(0);
    });

    it('addTrade : vente superieure a la quantite detenue refusee', async () => {
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 5,
                price: 100,
                amount: 500,
                fees: 0,
                date: dayOffset(-10),
            },
        ];
        await expect(
            svc.addTrade({ type: 'SELL', symbol: 'AAPL', qty: 9, price: 120, date: dayOffset(-1) })
        ).rejects.toThrow('supérieure à la quantité détenue');
        expect(fake.of('trades', 'insert')).toHaveLength(0);
    });

    it('addTrade : erreur serveur propagee, rien n est ajoute localement', async () => {
        fake = harness({ errors: { 'trades:insert': { message: 'RLS' } } });
        await expect(
            svc.addTrade({ type: 'BUY', symbol: 'AAPL', qty: 1, price: 10, date: dayOffset(-1) })
        ).rejects.toMatchObject({ message: 'RLS' });
        expect(svc.trades).toHaveLength(0);
    });

    it('updateTrade : remplace la ligne en place, a son index', async () => {
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 5,
                price: 100,
                amount: 500,
                fees: 0,
                date: dayOffset(-10),
            },
            {
                id: 't2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'MSFT',
                qty: 2,
                price: 200,
                amount: 400,
                fees: 0,
                date: dayOffset(-5),
            },
        ];
        const updated = await svc.updateTrade('t1', {
            type: 'BUY',
            symbol: 'AAPL',
            qty: 8,
            price: 110,
            date: dayOffset(-9),
        });

        expect(fake.of('trades', 'update')[0].filters).toEqual({ id: 't1' });
        expect(svc.trades.map((t) => t.id)).toEqual(['t1', 't2']);
        expect(svc.trades[0]).toBe(updated);
        expect(svc.trades[0].qty).toBe(8);
        expect(svc.trades[0].amount).toBe(880);
    });

    it('updateTrade : une vente peut etre reduite sans se heurter a elle-meme', async () => {
        // La ligne editee est exclue du calcul de la quantite detenue : sans ce
        // filtre, corriger une vente de 5 en 4 serait refuse.
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 5,
                price: 100,
                amount: 500,
                fees: 0,
                date: dayOffset(-10),
            },
            {
                id: 't2',
                portfolioId: 'p1',
                type: 'SELL',
                symbol: 'AAPL',
                qty: 5,
                price: 120,
                amount: 600,
                fees: 0,
                date: dayOffset(-2),
            },
        ];
        await expect(
            svc.updateTrade('t2', {
                type: 'SELL',
                symbol: 'AAPL',
                qty: 4,
                price: 120,
                date: dayOffset(-2),
            })
        ).resolves.toMatchObject({ qty: 4 });
    });

    it('removeTrade : supprime cote serveur et localement', async () => {
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 1,
                amount: 1,
                date: '2026-01-01',
            },
            {
                id: 't2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'MSFT',
                qty: 1,
                price: 1,
                amount: 1,
                date: '2026-01-01',
            },
        ];
        await svc.removeTrade('t1');
        expect(fake.of('trades', 'delete')[0].filters).toEqual({ id: 't1' });
        expect(svc.trades.map((t) => t.id)).toEqual(['t2']);
    });

    it('removeTrade : erreur serveur propagee, rien n est retire localement', async () => {
        fake = harness({ errors: { 'trades:delete': { message: 'RLS' } } });
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 1,
                amount: 1,
                date: '2026-01-01',
            },
        ];
        await expect(svc.removeTrade('t1')).rejects.toMatchObject({ message: 'RLS' });
        expect(svc.trades).toHaveLength(1);
    });

    it('addTradesBulk : une seule insertion pour tout le lot', async () => {
        const added = await svc.addTradesBulk([
            { type: 'BUY', symbol: 'AAPL', qty: 1, price: 10, date: dayOffset(-3) },
            { type: 'DEPOSIT', amount: 500, date: dayOffset(-2) },
        ]);

        expect(added).toBe(2);
        const inserts = fake.of('trades', 'insert');
        expect(inserts).toHaveLength(1);
        expect(inserts[0].payload).toHaveLength(2);
        expect(inserts[0].payload[1]).toMatchObject({
            type: 'DEPOSIT',
            symbol: '$CASH',
            amount: 500,
        });
        expect(svc.trades).toHaveLength(2);
    });
});

describe('PortfolioService.refreshPrices', () => {
    /** @type {PortfolioService} */
    let svc;

    beforeEach(() => {
        harness();
        svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'P', color: '#111' }];
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                fees: 0,
                date: '2026-01-10',
            },
            {
                id: 't2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 5,
                price: 200,
                amount: 1000,
                fees: 0,
                date: '2026-02-10',
            },
            {
                id: 't3',
                portfolioId: 'p1',
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 500,
                price: 1,
                amount: 500,
                fees: 0,
                date: '2026-01-01',
            },
            {
                id: 't4',
                portfolioId: 'p1',
                type: 'FEE',
                symbol: '$FEE',
                qty: 1,
                price: 5,
                amount: 5,
                fees: 0,
                date: '2026-01-05',
            },
        ];
    });

    it('interroge les seuls symboles de marche, pas les lignes de tresorerie', async () => {
        const asked = [];
        APIService.getCurrentPrice = async (sym) => {
            asked.push(sym);
            return 250;
        };
        await svc.refreshPrices();
        expect(asked).toEqual(['AAPL']);
        expect(svc.marketPrices).toEqual({ AAPL: 250 });
    });

    it('met a jour les taux de change et fxRate depuis EUR', async () => {
        APIService.getExchangeRates = async () => ({ USD: 1, EUR: 1.15, GBP: 1.3 });
        await svc.refreshPrices();
        expect(svc.fxRates.EUR).toBe(1.15);
        expect(svc.fxRate).toBe(1.15);
    });

    it('taux EUR absent : repli sur 1,08', async () => {
        APIService.getExchangeRates = async () => ({ USD: 1 });
        await svc.refreshPrices();
        expect(svc.fxRate).toBe(1.08);
    });

    it('ancre l historique sur le prix du premier achat et sur le prix courant', async () => {
        const seen = stubMarket({ prices: { AAPL: 250 } });
        await svc.refreshPrices();
        expect(seen.history).toEqual([{ sym: 'AAPL', anchor: 100, current: 250 }]);
    });

    it('sans prix courant : l ancre sert aussi de prix courant', async () => {
        const seen = stubMarket({ prices: {} });
        await svc.refreshPrices();
        expect(seen.history[0]).toMatchObject({ anchor: 100, current: 100 });
    });

    it('remplit le cache quotidien par symbole', async () => {
        stubMarket({ prices: { AAPL: 250 }, history: { AAPL: { '2026-01-10': 100 } } });
        await svc.refreshPrices();
        expect(svc.dailyPriceCache.AAPL).toEqual({ '2026-01-10': 100 });
    });
});

describe('PortfolioService.syncDividends', () => {
    /** @type {PortfolioService} */
    let svc;
    let fake;

    beforeEach(() => {
        fake = harness();
        svc = new PortfolioService();
        svc.userId = 'user-1';
        svc.portfolios = [{ id: 'p1', name: 'P', color: '#111' }];
        svc.activePortfolioId = 'p1';
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                fees: 0,
                date: dayOffset(-100),
            },
        ];
    });

    it('cree un dividende par evenement, au prorata de la quantite detenue', async () => {
        APIService.getDividends = async () => [{ date: dayOffset(-50), amountPerShare: 0.25 }];
        const added = await svc.syncDividends();

        expect(added).toBe(1);
        expect(fake.of('trades', 'insert')[0].payload).toMatchObject({
            type: 'DIVIDEND',
            symbol: 'AAPL',
            amount: 2.5, // 10 titres x 0,25
            portfolio_id: 'p1',
            date: dayOffset(-50),
        });
    });

    it('ignore un evenement anterieur a l achat', async () => {
        APIService.getDividends = async () => [{ date: dayOffset(-200), amountPerShare: 1 }];
        expect(await svc.syncDividends()).toBe(0);
        expect(fake.of('trades', 'insert')).toHaveLength(0);
    });

    it('ignore un dividende deja enregistre pour ce couple symbole / date', async () => {
        const paid = dayOffset(-50);
        svc.trades.push({
            id: 't2',
            portfolioId: 'p1',
            type: 'DIVIDEND',
            symbol: 'AAPL',
            qty: 1,
            price: 2.5,
            amount: 2.5,
            fees: 0,
            date: paid,
        });
        APIService.getDividends = async () => [{ date: paid, amountPerShare: 0.25 }];
        expect(await svc.syncDividends()).toBe(0);
        expect(fake.of('trades', 'insert')).toHaveLength(0);
    });

    it('quantite revendue entre-temps : aucun dividende', async () => {
        svc.trades.push({
            id: 't2',
            portfolioId: 'p1',
            type: 'SELL',
            symbol: 'AAPL',
            qty: 10,
            price: 120,
            amount: 1200,
            fees: 0,
            date: dayOffset(-80),
        });
        APIService.getDividends = async () => [{ date: dayOffset(-50), amountPerShare: 1 }];
        expect(await svc.syncDividends()).toBe(0);
    });

    it('plusieurs evenements : le compteur suit les creations', async () => {
        APIService.getDividends = async () => [
            { date: dayOffset(-70), amountPerShare: 0.2 },
            { date: dayOffset(-40), amountPerShare: 0.2 },
        ];
        expect(await svc.syncDividends()).toBe(2);
        expect(fake.of('trades', 'insert')).toHaveLength(2);
    });

    it('plusieurs achats : la periode interrogee part du plus ancien', async () => {
        svc.trades.push({
            id: 't2',
            portfolioId: 'p1',
            type: 'BUY',
            symbol: 'AAPL',
            qty: 5,
            price: 120,
            amount: 600,
            fees: 0,
            date: dayOffset(-20),
        });
        let askedFrom = null;
        APIService.getDividends = async (_symbol, from) => {
            askedFrom = from;
            return [];
        };
        await svc.syncDividends();
        expect(askedFrom).toBe(dayOffset(-100));
    });
});

describe('PortfolioService.exportToCSV', () => {
    /** @type {PortfolioService} */
    let svc;

    beforeEach(() => {
        svc = new PortfolioService();
        svc.portfolios = [
            { id: 'p1', name: 'Principal', color: '#111' },
            { id: 'p2', name: 'Crypto', color: '#222' },
        ];
    });

    it('en-tete attendu, separateur point-virgule', () => {
        svc.trades = [];
        expect(svc.exportToCSV()).toBe('date;type;symbol;qty;price;currency;fees;amount;portfolio');
    });

    it('trie par date croissante et nomme le portefeuille', () => {
        svc.trades = [
            {
                id: 't2',
                portfolioId: 'p2',
                type: 'BUY',
                symbol: 'BTC-USD',
                qty: 0.5,
                price: 40000,
                amount: 20000,
                fees: 0,
                date: '2026-03-01',
            },
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 150,
                amount: 1500,
                fees: 1,
                date: '2026-01-15',
            },
        ];
        const lines = svc.exportToCSV().split('\n');
        expect(lines[1]).toBe('2026-01-15;BUY;AAPL;10;150;USD;1;1500;Principal');
        expect(lines[2]).toBe('2026-03-01;BUY;BTC-USD;0,5;40000;USD;0;20000;Crypto');
    });

    it('nombres au format FR (virgule decimale)', () => {
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1.5,
                price: 150.75,
                amount: 226.125,
                fees: 0.99,
                date: '2026-01-15',
            },
        ];
        const cells = svc.exportToCSV().split('\n')[1].split(';');
        expect(cells[3]).toBe('1,5');
        expect(cells[4]).toBe('150,75');
        expect(cells[6]).toBe('0,99');
    });

    it('devise native deduite du suffixe du symbole', () => {
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'MC.PA',
                qty: 1,
                price: 600,
                amount: 600,
                fees: 0,
                date: '2026-01-15',
            },
        ];
        expect(svc.exportToCSV().split('\n')[1].split(';')[5]).toBe('EUR');
    });

    it('portefeuille disparu : la ligne sort quand meme, marquee Inconnu', () => {
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p-supprime',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 10,
                amount: 10,
                fees: 0,
                date: '2026-01-15',
            },
        ];
        expect(svc.exportToCSV().split('\n')[1]).toContain('Inconnu');
    });

    it('un nom contenant le separateur est protege par des guillemets', () => {
        svc.portfolios = [{ id: 'p1', name: 'Actions; ETF', color: '#111' }];
        svc.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 10,
                amount: 10,
                fees: 0,
                date: '2026-01-15',
            },
        ];
        expect(svc.exportToCSV().split('\n')[1]).toContain('"Actions; ETF"');
    });
});

describe('PortfolioService.importFromCSV', () => {
    /** @type {PortfolioService} */
    let svc;
    let fake;

    beforeEach(() => {
        fake = harness();
        svc = new PortfolioService();
        svc.userId = 'user-1';
        svc.portfolios = [{ id: 'p1', name: 'Principal', color: '#111' }];
        svc.activePortfolioId = 'p1';
    });

    const HEADER = 'date;type;symbol;qty;price;currency;fees;amount;portfolio';

    it('fichier vide : refus explicite', async () => {
        expect(await svc.importFromCSV('')).toEqual({
            added: 0,
            errors: ['Fichier CSV vide'],
        });
    });

    it('importe les lignes valides et compte les ajouts', async () => {
        const csv = [
            HEADER,
            `${dayOffset(-10)};BUY;AAPL;10;150;USD;1;1500;Principal`,
            `${dayOffset(-5)};DEPOSIT;;;;;;500;Principal`,
        ].join('\n');
        const res = await svc.importFromCSV(csv);
        expect(res).toEqual({ added: 2, errors: [] });
        expect(fake.of('trades', 'insert')[0].payload).toHaveLength(2);
    });

    it('numerote les erreurs sur les lignes du fichier, en-tete compris', async () => {
        const csv = [
            HEADER,
            `${dayOffset(-10)};BUY;AAPL;10;150;USD;0;1500;Principal`, // ligne 2, valide
            `;BUY;AAPL;1;10;USD;0;10;Principal`, // ligne 3, date manquante
            `${dayOffset(5)};BUY;AAPL;1;10;USD;0;10;Principal`, // ligne 4, date future
        ].join('\n');
        const res = await svc.importFromCSV(csv);
        expect(res.added).toBe(1);
        expect(res.errors).toHaveLength(2);
        expect(res.errors[0]).toMatch(/^Ligne 3 : /);
        expect(res.errors[1]).toMatch(/^Ligne 4 : /);
    });

    it('aucune ligne exploitable : rien n est envoye', async () => {
        const csv = [HEADER, `;;;;;;;;`].join('\n');
        const res = await svc.importFromCSV(csv);
        expect(res.added).toBe(0);
        expect(res.errors).toHaveLength(1);
        expect(fake.of('trades', 'insert')).toHaveLength(0);
    });

    it('cree les portefeuilles nommes qui n existent pas encore', async () => {
        const csv = [HEADER, `${dayOffset(-10)};BUY;AAPL;1;10;USD;0;10;Crypto`].join('\n');
        await svc.importFromCSV(csv);
        expect(fake.of('portfolios', 'insert')[0].payload).toMatchObject({ name: 'Crypto' });
        expect(svc.portfolios.map((p) => p.name)).toEqual(['Principal', 'Crypto']);
    });

    it('colonne portfolio vide : rattache au portefeuille actif', async () => {
        svc.portfolios.push({ id: 'p2', name: 'Crypto', color: '#222' });
        svc.activePortfolioId = 'p2';
        const csv = [HEADER, `${dayOffset(-10)};BUY;AAPL;1;10;USD;0;10;`].join('\n');
        await svc.importFromCSV(csv);
        expect(fake.of('trades', 'insert')[0].payload[0].portfolio_id).toBe('p2');
    });

    it('devise de saisie differente de la devise native : prix converti', async () => {
        // MC.PA cote en EUR. Un prix saisi en USD doit etre ramene en EUR.
        svc.fxRate = 1.1;
        const csv = [HEADER, `${dayOffset(-10)};BUY;MC.PA;2;660;USD;11;1320;Principal`].join('\n');
        await svc.importFromCSV(csv);
        const row = fake.of('trades', 'insert')[0].payload[0];
        expect(row.price).toBeCloseTo(600); // 660 USD / 1,10
        expect(row.fees).toBeCloseTo(10);
    });

    it('devise de saisie egale a la devise native : prix inchange', async () => {
        const csv = [HEADER, `${dayOffset(-10)};BUY;MC.PA;2;600;EUR;10;1200;Principal`].join('\n');
        await svc.importFromCSV(csv);
        expect(fake.of('trades', 'insert')[0].payload[0].price).toBe(600);
    });

    it('nombres au format FR acceptes', async () => {
        const csv = [
            HEADER,
            `${dayOffset(-10)};BUY;AAPL;1,5;150,75;USD;0,99;226,125;Principal`,
        ].join('\n');
        await svc.importFromCSV(csv);
        const row = fake.of('trades', 'insert')[0].payload[0];
        expect(row.qty).toBe(1.5);
        expect(row.price).toBe(150.75);
        expect(row.fees).toBe(0.99);
    });

    it('aller-retour : ce qui sort de exportToCSV rentre sans erreur', async () => {
        const source = new PortfolioService();
        source.portfolios = [{ id: 'p1', name: 'Principal', color: '#111' }];
        source.trades = [
            {
                id: 't1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1.5,
                price: 150.75,
                amount: 226.125,
                fees: 0.99,
                date: dayOffset(-20),
            },
            {
                id: 't2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'MC.PA',
                qty: 2,
                price: 600,
                amount: 1200,
                fees: 0,
                date: dayOffset(-10),
            },
            {
                id: 't3',
                portfolioId: 'p1',
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 500,
                price: 1,
                amount: 500,
                fees: 0,
                date: dayOffset(-30),
            },
        ];

        const res = await svc.importFromCSV(source.exportToCSV());
        expect(res.errors).toEqual([]);
        expect(res.added).toBe(3);

        const rows = fake.of('trades', 'insert')[0].payload;
        expect(rows.map((r) => r.symbol)).toEqual(['$CASH', 'AAPL', 'MC.PA']);
        expect(rows[1]).toMatchObject({ qty: 1.5, price: 150.75, fees: 0.99 });
        expect(rows[2].price).toBe(600); // EUR natif, EUR en colonne : pas de conversion
    });
});
