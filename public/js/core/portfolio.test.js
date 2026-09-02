/**
 * Moteur de portefeuille : conversion de devises, validation et normalisation
 * des transactions, P&L, allocations, rendements, config IA du compte.
 *
 * Le module est importe directement. Les seules dependances externes du moteur
 * sont injectees : le client Supabase via setSupabaseClient(), le stockage local
 * et fetch via globalThis (cf. core/platform.js).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('date absente : refus explicite', () => {
        // normalizeTradeInput met toujours une date ; ce garde-fou protege les
        // appels directs (import CSV, re-validation d'une ligne existante).
        expect(() =>
            svc.validateTrade({ type: 'BUY', symbol: 'AAPL', qty: 1, price: 10, date: '' })
        ).toThrow('Date manquante');
    });

    it('type inconnu : refus explicite', () => {
        expect(() =>
            svc.validateTrade({
                type: 'TRANSFERT',
                symbol: 'AAPL',
                qty: 1,
                price: 10,
                amount: 10,
                date: '2020-01-01',
            })
        ).toThrow('Type de transaction inconnu');
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

    it('date passee non canonique : pas de refus « date dans le futur »', () => {
        // normalizeTradeInput normalise la date, mais validateTrade est aussi
        // appele directement (import CSV, re-validation d'une ligne existante).
        // En texte, '2026-1-5' est superieur a toute date du mois 09 ou 10.
        expect(() =>
            svc.validateTrade({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 10,
                amount: 10,
                date: '2026-1-5',
            })
        ).not.toThrow();
    });

    it('date future non canonique : refus quand meme', () => {
        const d = new Date(Date.now() + 3 * 864e5);
        const nonPadded = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        expect(() =>
            svc.validateTrade({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 1,
                price: 10,
                amount: 10,
                date: nonPadded,
            })
        ).toThrow(/futur/);
    });

    it('vente : la quantite detenue tient compte des dates non canoniques', () => {
        // L'achat du 5 janvier precede la vente du 15. Compare en texte,
        // '2026-1-5' passait pour posterieur : la quantite detenue tombait a 0
        // et une vente parfaitement couverte etait refusee.
        for (const achat of ['2026-1-5', '05/01/2026']) {
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
                    date: achat,
                },
            ];
            expect(
                () =>
                    svc.validateTrade(
                        norm({
                            type: 'sell',
                            symbol: 'AAPL',
                            qty: 2,
                            price: 12,
                            date: '2026-01-15',
                        })
                    ),
                achat
            ).not.toThrow();
            // Et la borne haute reste gardee : 4 titres pour 3 detenus.
            expect(
                () =>
                    svc.validateTrade(
                        norm({
                            type: 'sell',
                            symbol: 'AAPL',
                            qty: 4,
                            price: 12,
                            date: '2026-01-15',
                        })
                    ),
                achat
            ).toThrow(/sup|detenue|détenue/i);
        }
    });

    it('vente anterieure a un achat non canonique : refus', () => {
        // Miroir du precedent : l'achat du 15 janvier ne couvre pas une vente
        // du 5, quelle que soit l'ecriture des dates.
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
                date: '2026-01-15',
            },
        ];
        expect(() =>
            svc.validateTrade(
                norm({ type: 'sell', symbol: 'AAPL', qty: 2, price: 12, date: '2026-1-5' })
            )
        ).toThrow(/sup|detenue|détenue/i);
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

describe('PortfolioService.calculatePortfolio : cours indisponible', () => {
    function svcWith(prices) {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            {
                id: 'b1',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                fees: 0,
                date: '2026-01-02',
            },
            {
                id: 'b2',
                portfolioId: 'p1',
                type: 'BUY',
                symbol: 'MSFT',
                qty: 5,
                price: 200,
                amount: 1000,
                fees: 0,
                date: '2026-01-03',
            },
        ];
        svc.marketPrices = prices;
        svc.dailyPriceCache = {};
        return svc;
    }

    it('sans cours, la position est valorisee a son prix de revient', () => {
        // Le repli d'avant renvoyait un cours code en dur de 2024 : la position
        // affichait une plus-value entierement fabriquee. Valoriser au cout donne
        // une plus-value nulle, ce qui est faux aussi — d'ou le drapeau.
        const stats = svcWith({}).calculatePortfolio('USD');
        const aapl = stats.holdings.find((h) => h.symbol === 'AAPL');
        expect(aapl.currentPrice).toBe(100);
        expect(aapl.gainNative).toBe(0);
        expect(aapl.priceUnavailable).toBe(true);
    });

    it('les symboles concernes sont listes dans le resultat', () => {
        const stats = svcWith({ MSFT: 260 }).calculatePortfolio('USD');
        expect(stats.unavailablePrices).toEqual(['AAPL']);
        expect(stats.holdings.find((h) => h.symbol === 'MSFT').priceUnavailable).toBe(false);
    });

    it('tous les cours disponibles : aucun signalement', () => {
        const stats = svcWith({ AAPL: 130, MSFT: 260 }).calculatePortfolio('USD');
        expect(stats.unavailablePrices).toEqual([]);
        expect(stats.holdings.every((h) => h.priceUnavailable === false)).toBe(true);
    });

    it('un cours nul ou negatif compte comme indisponible', () => {
        const stats = svcWith({ AAPL: 0, MSFT: -5 }).calculatePortfolio('USD');
        expect(stats.unavailablePrices).toEqual(['AAPL', 'MSFT']);
    });

    it('la plus-value latente totale n integre aucun montant invente', () => {
        const stats = svcWith({ MSFT: 260 }).calculatePortfolio('USD');
        // Seul MSFT contribue : 5 x (260 - 200) = 300.
        expect(stats.unrealizedPnL).toBeCloseTo(300);
    });

    it('ne signale que les devises effectivement detenues', () => {
        const svc = svcWith({ AAPL: 130, MSFT: 260 });
        svc.estimatedFxCurrencies = ['EUR', 'CAD'];
        // Le portefeuille n'a que des titres en USD : rien a signaler.
        expect(svc.calculatePortfolio('USD').estimatedFxCurrencies).toEqual([]);

        svc.trades.push({
            id: 'b3',
            portfolioId: 'p1',
            type: 'BUY',
            symbol: 'MC.PA',
            qty: 1,
            price: 600,
            amount: 600,
            fees: 0,
            date: '2026-01-04',
        });
        svc.marketPrices['MC.PA'] = 660;
        expect(svc.calculatePortfolio('USD').estimatedFxCurrencies).toEqual(['EUR']);
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

describe('PortfolioService : rendement annuel et dates non canoniques', () => {
    // Horloge figee : la fenetre annuelle depend du jour courant, et le piege
    // teste ('2026-3-1' > '2026-09-01' en texte) suppose mars deja passe.
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-01T12:00:00'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    /** @param {string} apport date du gros apport de milieu d'annee */
    const service = (apport) => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
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
                date: '2026-01-02',
            },
            {
                id: 'd2',
                portfolioId: 'p1',
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 1,
                price: 1,
                amount: 90000,
                fees: 0,
                date: apport,
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
                date: '2026-08-01',
            },
        ];
        svc.marketPrices = {};
        svc.dailyPriceCache = {};
        return svc;
    };

    it('un apport ecrit sans zero de tete pese autant qu ecrit en canonique', () => {
        // Le denominateur du rendement (Dietz modifie) pondere chaque apport par
        // sa duree de presence. Compare en texte, '2026-3-1' passe pour
        // posterieur a aujourd'hui : l'apport de 90 000 etait purement ignore et
        // le rendement affiche gonfle d'autant.
        const canonique = service('2026-03-01').getYearlyPerformance('USD');
        const nonPadde = service('2026-3-1').getYearlyPerformance('USD');

        expect(nonPadde.ytd.percent).toBeCloseTo(canonique.ytd.percent, 9);
        expect(nonPadde.years[0].percent).toBeCloseTo(canonique.years[0].percent, 9);
        // Garde-fou : l'apport pese reellement, sinon le test ne prouverait rien.
        const sansApport = service('2026-12-31').getYearlyPerformance('USD');
        expect(sansApport.ytd.percent).toBeGreaterThan(canonique.ytd.percent + 1);
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

// ---------------------------------------------------------------------------
// P&L a une date donnee : c'est la fonction qui alimente la serie « plus-values »
// du graphe. Un seul de ses six types de transaction etait couvert.
// ---------------------------------------------------------------------------

describe('PortfolioService.computeProfitAsOf : tous les types de transaction', () => {
    /** Service avec un portefeuille, sans historique de prix (repli sur le PRU). */
    function svcWith(trades) {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = trades;
        svc.marketPrices = {};
        svc.dailyPriceCache = {};
        return svc;
    }

    /** @param {Partial<any>} over */
    function tr(over) {
        return {
            id: Math.random().toString(36).slice(2),
            portfolioId: 'p1',
            symbol: '$CASH',
            qty: 0,
            price: 0,
            amount: 0,
            fees: 0,
            fxRate: null,
            ...over,
        };
    }

    it('un retrait diminue les apports courants sans baisser le pic', () => {
        // netInvested retient le pic des apports nets : retirer 400 apres avoir
        // verse 1000 ne fait pas croire a un investissement de 600.
        const svc = svcWith([
            tr({ type: 'DEPOSIT', amount: 1000, date: '2026-01-01' }),
            tr({ type: 'WITHDRAWAL', amount: 400, date: '2026-01-05' }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').netInvested).toBeCloseTo(1000);
    });

    it('un apport posterieur a un retrait ne redescend pas le pic', () => {
        // 1000 verses, 400 retires, 200 reverses : les apports courants valent 800
        // mais le capital reellement engage a culmine a 1000. C'est ce pic qui
        // sert de base au rendement, sinon un retrait le gonflerait artificiellement.
        const svc = svcWith([
            tr({ type: 'DEPOSIT', amount: 1000, date: '2026-01-01' }),
            tr({ type: 'WITHDRAWAL', amount: 400, date: '2026-01-05' }),
            tr({ type: 'DEPOSIT', amount: 200, date: '2026-01-08' }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').netInvested).toBeCloseTo(1000);
    });

    it('sans apport, les apports se deduisent du montant achete frais compris', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                fees: 5,
                date: '2026-01-02',
            }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').netInvested).toBeCloseTo(1005);
    });

    it('une vente realise la plus-value au prix de revient moyen', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({
                type: 'SELL',
                symbol: 'AAPL',
                qty: 4,
                price: 150,
                amount: 600,
                date: '2026-01-05',
            }),
        ]);
        // 4 titres vendus 150 pour un PRU de 100 : +200 realises. Les 6 restants
        // sont valorises a leur PRU (aucun historique) : zero latent.
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(200);
    });

    it('une vente totale ne laisse aucune plus-value latente', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({
                type: 'SELL',
                symbol: 'AAPL',
                qty: 10,
                price: 120,
                amount: 1200,
                date: '2026-01-05',
            }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(200);
    });

    it('les frais d une vente sont retranches du resultat', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({
                type: 'SELL',
                symbol: 'AAPL',
                qty: 10,
                price: 120,
                amount: 1200,
                fees: 7,
                date: '2026-01-05',
            }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(193);
    });

    it('une vente sans position correspondante ne cree pas de plus-value', () => {
        // Symbole jamais achete : la quantite vendue est ramenee a zero, sinon
        // le resultat serait credite d'un gain integral fantome.
        const svc = svcWith([
            tr({
                type: 'SELL',
                symbol: 'AAPL',
                qty: 5,
                price: 150,
                amount: 750,
                date: '2026-01-05',
            }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(0);
    });

    it('une vente superieure a la position est ecretee a la quantite detenue', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 3,
                price: 100,
                amount: 300,
                date: '2026-01-02',
            }),
            tr({
                type: 'SELL',
                symbol: 'AAPL',
                qty: 10,
                price: 150,
                amount: 1500,
                date: '2026-01-05',
            }),
        ]);
        // 3 titres seulement peuvent etre vendus : +150, pas +500.
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(150);
    });

    it('un dividende augmente le resultat', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({
                type: 'DIVIDEND',
                symbol: 'AAPL',
                qty: 1,
                price: 25,
                amount: 25,
                date: '2026-01-05',
            }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(25);
    });

    it('des frais isoles diminuent le resultat', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({ type: 'FEE', symbol: '$FEE', qty: 1, price: 12, amount: 12, date: '2026-01-05' }),
        ]);
        expect(svc.computeProfitAsOf('2026-01-10', 'USD').totalPnL).toBeCloseTo(-12);
    });

    it('les transactions posterieures a la date sont ignorees', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({
                type: 'DIVIDEND',
                symbol: 'AAPL',
                qty: 1,
                price: 50,
                amount: 50,
                date: '2026-03-01',
            }),
        ]);
        expect(svc.computeProfitAsOf('2026-02-01', 'USD').totalPnL).toBeCloseTo(0);
        expect(svc.computeProfitAsOf('2026-03-01', 'USD').totalPnL).toBeCloseTo(50);
    });

    it('le resultat est converti dans la devise demandee', () => {
        const svc = svcWith([
            tr({
                type: 'BUY',
                symbol: 'AAPL',
                qty: 10,
                price: 100,
                amount: 1000,
                date: '2026-01-02',
            }),
            tr({
                type: 'DIVIDEND',
                symbol: 'AAPL',
                qty: 1,
                price: 108,
                amount: 108,
                date: '2026-01-05',
            }),
        ]);
        svc.fxRate = 1.08;
        expect(svc.computeProfitAsOf('2026-01-10', 'EUR').totalPnL).toBeCloseTo(100);
    });

    it('aucune transaction : resultat et apports nuls', () => {
        const out = svcWith([]).computeProfitAsOf('2026-01-10', 'USD');
        expect(out).toEqual({ totalPnL: 0, netInvested: 0 });
    });
});

// ---------------------------------------------------------------------------

describe('PortfolioService.resolveRangeStart', () => {
    const today = new Date(2026, 5, 15, 14, 30); // 15 juin 2026, apres-midi
    const first = new Date(2024, 0, 20);

    /** Nombre de jours entiers entre la borne calculee et la date de reference. */
    function daysBack(range, firstTradeDate = first) {
        const ref = new Date(2026, 5, 15);
        ref.setHours(0, 0, 0, 0);
        const start = new PortfolioService().resolveRangeStart(range, ref, firstTradeDate);
        return Math.round((ref.getTime() - start.getTime()) / 86400000);
    }

    it('ALL part de la premiere transaction', () => {
        const start = new PortfolioService().resolveRangeStart('ALL', today, first);
        expect(Utils.getDateString(start)).toBe('2024-01-20');
    });

    it('ALL sans transaction part de 30 jours en arriere', () => {
        const start = new PortfolioService().resolveRangeStart('ALL', new Date(2026, 5, 15), null);
        expect(Utils.getDateString(start)).toBe('2026-05-16');
    });

    it('YTD part du 1er janvier', () => {
        const start = new PortfolioService().resolveRangeStart('YTD', today, first);
        expect(Utils.getDateString(start)).toBe('2026-01-01');
    });

    it('les plages glissantes reculent du bon nombre de jours', () => {
        expect(daysBack('1M')).toBe(30);
        expect(daysBack('3M')).toBe(90);
        expect(daysBack('6M')).toBe(180);
        expect(daysBack('1Y')).toBe(365);
    });

    it('plage inconnue : repli sur 90 jours', () => {
        expect(daysBack('ZZZ')).toBe(90);
    });

    it('la borne est ramenee a minuit', () => {
        const start = new PortfolioService().resolveRangeStart('1M', today, first);
        expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    });
});

// ---------------------------------------------------------------------------

describe('PortfolioService.getHistoricalTimeline : ventes et flux du jour', () => {
    const dayStr = (offset) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        return Utils.getDateString(d);
    };

    /** Prix constant sur toute la fenetre, pour isoler l'effet des transactions. */
    function priceSeries(price, from = -6) {
        const out = {};
        for (let i = from; i <= 0; i++) out[dayStr(i)] = price;
        return out;
    }

    function svcWith(trades, { price = 100 } = {}) {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = trades;
        svc.marketPrices = { AAPL: price };
        svc.dailyPriceCache = { AAPL: priceSeries(price) };
        return svc;
    }

    /** @param {Partial<any>} over */
    const tr = (over) => ({
        id: Math.random().toString(36).slice(2),
        portfolioId: 'p1',
        symbol: 'AAPL',
        qty: 0,
        price: 0,
        amount: 0,
        fees: 0,
        fxRate: null,
        ...over,
    });

    it('une vente retire la valeur de la position des jours suivants', () => {
        const svc = svcWith([
            tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-6) }),
            tr({ type: 'SELL', qty: 4, price: 100, amount: 400, date: dayStr(-3) }),
        ]);
        const tl = svc.getHistoricalTimeline('ALL', 'VALUE', 'USD');
        expect(tl.values[0]).toBeCloseTo(1000);
        expect(tl.values[tl.values.length - 1]).toBeCloseTo(600);
    });

    it('une vente totale ramene la valeur a zero', () => {
        const svc = svcWith([
            tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-6) }),
            tr({ type: 'SELL', qty: 10, price: 100, amount: 1000, date: dayStr(-3) }),
        ]);
        const tl = svc.getHistoricalTimeline('ALL', 'VALUE', 'USD');
        expect(tl.values[tl.values.length - 1]).toBeCloseTo(0);
        // Plus de cout en portefeuille : la serie base-cout retombe a 0, pas a -100 %.
        expect(tl.perfValues[tl.perfValues.length - 1]).toBeCloseTo(0);
    });

    it('vendre au prix du marche ne cree pas de rendement sur le badge', () => {
        // Les flux du jour neutralisent la sortie : le cours n'a pas bouge, donc
        // le badge de performance doit rester a zero.
        const svc = svcWith([
            tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-6) }),
            tr({ type: 'SELL', qty: 5, price: 100, amount: 500, date: dayStr(-3) }),
        ]);
        expect(svc.getHistoricalTimeline('ALL', 'PERF', 'USD').rangeStats.ALL).toBeCloseTo(0, 6);
    });

    it('les apports et les frais ne comptent pas dans les flux de positions', () => {
        // Un depot le meme jour qu'un achat ne doit pas etre compte deux fois
        // dans le flux : seul l'achat entre dans les positions.
        const withCash = svcWith([
            tr({
                type: 'DEPOSIT',
                symbol: '$CASH',
                qty: 5000,
                price: 1,
                amount: 5000,
                date: dayStr(-6),
            }),
            tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-6) }),
            tr({ type: 'FEE', symbol: '$FEE', qty: 1, price: 20, amount: 20, date: dayStr(-3) }),
        ]);
        const plain = svcWith([
            tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-6) }),
        ]);

        expect(withCash.getHistoricalTimeline('ALL', 'PERF', 'USD').rangeStats.ALL).toBeCloseTo(
            plain.getHistoricalTimeline('ALL', 'PERF', 'USD').rangeStats.ALL,
            6
        );
    });

    it('une vente sur un symbole jamais achete est sans effet', () => {
        const svc = svcWith([
            tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-6) }),
            tr({ type: 'SELL', symbol: 'MSFT', qty: 3, price: 300, amount: 900, date: dayStr(-3) }),
        ]);
        const tl = svc.getHistoricalTimeline('ALL', 'VALUE', 'USD');
        expect(tl.values[tl.values.length - 1]).toBeCloseTo(1000);
    });
});

// --- FINANCEMENT DES ACHATS ET SOLDE DE CASH -------------------------------
//
// Ce n'est pas un compte-titres : une action peut avoir ete acquise en direct,
// sans depot prealable. Elle entre alors dans le portefeuille sans creuser le
// cash, qui ne peut jamais devenir negatif.

describe('PortfolioService : financement des achats et cash', () => {
    /** @param {any[]} trades */
    function svcWith(trades) {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = trades;
        return svc;
    }

    /** @param {Partial<any>} over */
    const tr = (over) => ({
        id: Math.random().toString(36).slice(2),
        portfolioId: 'p1',
        symbol: 'AAPL',
        qty: 0,
        price: 0,
        amount: 0,
        fees: 0,
        cashSource: null,
        ...over,
    });

    const deposit = (amount, date) =>
        tr({ type: 'DEPOSIT', symbol: '$CASH', qty: amount, price: 1, amount, date });

    it('un achat direct laisse le cash intact et entre quand meme au portefeuille', () => {
        const svc = svcWith([
            deposit(1000, '2026-01-01'),
            tr({
                type: 'BUY',
                qty: 10,
                price: 50,
                cashSource: 'DIRECT',
                date: '2026-01-02',
            }),
        ]);
        svc.marketPrices = { AAPL: 60 };
        const s = svc.calculatePortfolio('USD');
        expect(s.cash).toBeCloseTo(1000);
        expect(s.holdingsValue).toBeCloseTo(600);
        expect(s.totalValue).toBeCloseTo(1600);
    });

    it('un achat sur le cash preleve le solde, frais compris', () => {
        const svc = svcWith([
            deposit(1000, '2026-01-01'),
            tr({
                type: 'BUY',
                qty: 10,
                price: 50,
                fees: 5,
                cashSource: 'CASH',
                date: '2026-01-02',
            }),
        ]);
        svc.marketPrices = { AAPL: 60 };
        const s = svc.calculatePortfolio('USD');
        expect(s.cash).toBeCloseTo(495); // 1000 - 500 - 5
        expect(s.totalValue).toBeCloseTo(1095); // 495 + 600
    });

    it('le cash ne devient jamais negatif : le surplus est finance en direct', () => {
        const svc = svcWith([
            deposit(300, '2026-01-01'),
            // Ligne anterieure a la colonne (cashSource null) : relue comme un
            // achat sur le cash, ecrete au solde reellement disponible.
            tr({ type: 'BUY', qty: 10, price: 50, date: '2026-01-02' }),
        ]);
        svc.marketPrices = { AAPL: 50 };
        const s = svc.calculatePortfolio('USD');
        expect(s.cash).toBe(0);
        expect(s.holdingsValue).toBeCloseTo(500);
        expect(s.totalValue).toBeCloseTo(500);
    });

    it('la vente alimente le cash meme si le titre avait ete achete en direct', () => {
        const svc = svcWith([
            tr({ type: 'BUY', qty: 10, price: 50, cashSource: 'DIRECT', date: '2026-01-02' }),
            tr({ type: 'SELL', qty: 4, price: 60, fees: 2, date: '2026-02-01' }),
        ]);
        svc.marketPrices = { AAPL: 60 };
        const s = svc.calculatePortfolio('USD');
        expect(s.cash).toBeCloseTo(238); // 4 x 60 - 2
        expect(s.holdingsValue).toBeCloseTo(360); // 6 titres restants
        expect(s.totalValue).toBeCloseTo(598);
    });

    it('une vente sans position ne credite aucun cash', () => {
        const svc = svcWith([tr({ type: 'SELL', qty: 5, price: 100, date: '2026-01-02' })]);
        expect(svc.calculatePortfolio('USD').cash).toBe(0);
    });

    it('getCashAvailableOnDate suit le solde dans le temps', () => {
        const svc = svcWith([
            deposit(1000, '2026-01-01'),
            tr({ type: 'BUY', qty: 5, price: 100, cashSource: 'CASH', date: '2026-01-10' }),
            deposit(200, '2026-02-01'),
        ]);
        expect(svc.getCashAvailableOnDate('2026-01-05')).toBeCloseTo(1000);
        expect(svc.getCashAvailableOnDate('2026-01-15')).toBeCloseTo(500);
        expect(svc.getCashAvailableOnDate('2026-02-05')).toBeCloseTo(700);
    });

    it('financement non precise : deduit du cash disponible a la date', () => {
        const svc = svcWith([deposit(1000, '2026-01-01')]);
        const surCash = svc.normalizeTradeInput({
            type: 'BUY',
            symbol: 'AAPL',
            qty: 5,
            price: 100,
            date: '2026-01-02',
            portfolioId: 'p1',
        });
        expect(surCash.cashSource).toBe('CASH');

        const horsCash = svc.normalizeTradeInput({
            type: 'BUY',
            symbol: 'AAPL',
            qty: 50,
            price: 100,
            date: '2026-01-02',
            portfolioId: 'p1',
        });
        expect(horsCash.cashSource).toBe('DIRECT');
    });

    it('seul un achat porte une origine de financement', () => {
        const svc = svcWith([]);
        const sell = svc.normalizeTradeInput({
            type: 'SELL',
            symbol: 'AAPL',
            qty: 1,
            price: 10,
            cashSource: 'CASH',
            portfolioId: 'p1',
        });
        expect(sell.cashSource).toBeNull();
    });

    it('refuse un achat sur cash superieur au solde disponible', () => {
        const svc = svcWith([deposit(300, '2026-01-01')]);
        svc.activePortfolioId = 'p1';
        expect(() =>
            svc.validateTrade(
                svc.normalizeTradeInput({
                    type: 'BUY',
                    symbol: 'AAPL',
                    qty: 10,
                    price: 50,
                    cashSource: 'CASH',
                    date: '2026-01-02',
                    portfolioId: 'p1',
                })
            )
        ).toThrow(/Cash insuffisant/);
    });

    it('accepte le meme achat en direct', () => {
        const svc = svcWith([deposit(300, '2026-01-01')]);
        svc.activePortfolioId = 'p1';
        expect(() =>
            svc.validateTrade(
                svc.normalizeTradeInput({
                    type: 'BUY',
                    symbol: 'AAPL',
                    qty: 10,
                    price: 50,
                    cashSource: 'DIRECT',
                    date: '2026-01-02',
                    portfolioId: 'p1',
                })
            )
        ).not.toThrow();
    });

    it('refuse un retrait superieur au cash disponible', () => {
        const svc = svcWith([deposit(300, '2026-01-01')]);
        svc.activePortfolioId = 'p1';
        expect(() =>
            svc.validateTrade(
                svc.normalizeTradeInput({
                    type: 'WITHDRAWAL',
                    amount: 500,
                    date: '2026-01-02',
                    portfolioId: 'p1',
                })
            )
        ).toThrow(/Retrait supérieur/);
    });

    it('« Valeur du portefeuille » vaut toujours positions + cash', () => {
        const svc = svcWith([
            deposit(2000, '2026-01-01'),
            tr({ type: 'BUY', qty: 10, price: 50, cashSource: 'CASH', date: '2026-01-02' }),
            tr({
                symbol: 'MSFT',
                type: 'BUY',
                qty: 4,
                price: 300,
                cashSource: 'DIRECT',
                date: '2026-01-03',
            }),
            tr({
                type: 'DIVIDEND',
                symbol: 'AAPL',
                qty: 1,
                price: 25,
                amount: 25,
                date: '2026-02-01',
            }),
        ]);
        svc.marketPrices = { AAPL: 55, MSFT: 320 };
        const s = svc.calculatePortfolio('USD');
        expect(s.cash).toBeCloseTo(1525); // 2000 - 500 + 25
        expect(s.holdingsValue).toBeCloseTo(550 + 1280);
        expect(s.totalValue).toBeCloseTo(s.holdingsValue + s.cash);
    });
});
