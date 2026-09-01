/**
 * Agregations du moteur derivees de calculatePortfolio : variations du jour et
 * du mois, quantite detenue a une date, dividendes et resultats a venir.
 *
 * Ces methodes alimentent directement des chiffres affiches a l'utilisateur et
 * n'avaient aucun test. Elles sont pures au sens ou leurs seules entrees sont
 * `trades`, les caches de prix et APIService — qu'on remplace ici.
 *
 * Separe de portfolio.test.js (calculs de P&L) et de portfolio-io.test.js
 * (persistance et CSV) pour garder chaque fichier lisible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PortfolioService } from './portfolio.js';
import { Utils } from './utils.js';
import { APIService } from './api.js';
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

// Aucune de ces methodes ne parle a Supabase, mais le constructeur et
// setActivePortfolio peuvent le faire : on injecte un client inerte.
setSupabaseClient(
    /** @type {any} */ ({
        from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        }),
        auth: { getSession: async () => ({ data: { session: null } }) },
    })
);

// --- utilitaires de dates --------------------------------------------------

/** Date decalee de `days` jours par rapport a aujourd'hui, au format YYYY-MM-DD. */
function dayOffset(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return Utils.getDateString(d);
}

/** Service pret a l'emploi : un portefeuille, des achats, des prix courants. */
function serviceWith({ trades = [], prices = {}, history = {} } = {}) {
    const svc = new PortfolioService();
    svc.portfolios = [{ id: 'p1', name: 'Principal', color: '#000' }];
    svc.activePortfolioId = 'GLOBAL';
    svc.trades = trades;
    svc.marketPrices = prices;
    svc.dailyPriceCache = history;
    return svc;
}

/** Achat minimal valide, deja normalise (on court-circuite la validation). */
function buy(symbol, qty, price, date, portfolioId = 'p1') {
    return {
        id: `${symbol}-${date}`,
        portfolioId,
        type: 'BUY',
        symbol,
        qty,
        price,
        amount: qty * price,
        fees: 0,
        fxRate: null,
        date,
    };
}

// --- restauration des methodes remplacees ---------------------------------

const realApi = {
    getDividends: APIService.getDividends,
    getEarnings: APIService.getEarnings,
};
beforeEach(() => {
    store.clear();
});
afterEach(() => {
    APIService.getDividends = realApi.getDividends;
    APIService.getEarnings = realApi.getEarnings;
});

// ---------------------------------------------------------------------------

describe('PortfolioService.getQtyHeldOnDate', () => {
    it('somme les achats et retranche les ventes jusqu a la date incluse', () => {
        const svc = serviceWith({
            trades: [
                buy('AAPL', 10, 100, '2026-01-10'),
                { ...buy('AAPL', 4, 120, '2026-02-10'), type: 'SELL' },
                buy('AAPL', 3, 130, '2026-03-10'),
            ],
        });
        expect(svc.getQtyHeldOnDate('AAPL', '2026-01-10')).toBe(10);
        expect(svc.getQtyHeldOnDate('AAPL', '2026-02-10')).toBe(6);
        expect(svc.getQtyHeldOnDate('AAPL', '2026-03-10')).toBe(9);
    });

    it('une date anterieure au premier achat donne 0', () => {
        const svc = serviceWith({ trades: [buy('AAPL', 10, 100, '2026-01-10')] });
        expect(svc.getQtyHeldOnDate('AAPL', '2026-01-09')).toBe(0);
    });

    it('ignore les types autres que BUY et SELL', () => {
        const svc = serviceWith({
            trades: [
                buy('AAPL', 10, 100, '2026-01-10'),
                {
                    ...buy('AAPL', 1, 50, '2026-01-11'),
                    type: 'DIVIDEND',
                    qty: 1,
                    price: 50,
                    amount: 50,
                },
                { ...buy('$CASH', 500, 1, '2026-01-12'), type: 'DEPOSIT' },
            ],
        });
        expect(svc.getQtyHeldOnDate('AAPL', '2026-12-31')).toBe(10);
    });

    it('symbole inconnu : 0', () => {
        const svc = serviceWith({ trades: [buy('AAPL', 10, 100, '2026-01-10')] });
        expect(svc.getQtyHeldOnDate('MSFT', '2026-12-31')).toBe(0);
    });

    it('compte toutes les transactions, sans filtre de portefeuille actif', () => {
        // syncDividends s'appuie sur ce comportement : un dividende est verse sur
        // la position reelle, pas sur celle du portefeuille affiche.
        const svc = serviceWith({
            trades: [
                buy('AAPL', 10, 100, '2026-01-10', 'p1'),
                buy('AAPL', 5, 100, '2026-01-11', 'p2'),
            ],
        });
        svc.activePortfolioId = 'p1';
        expect(svc.getQtyHeldOnDate('AAPL', '2026-12-31')).toBe(15);
    });
});

describe('PortfolioService.getDailyMovers', () => {
    // Quatre hausses et quatre baisses, avec une cloture de la veille connue :
    // le plafond a 3 doit reellement couper.
    const RISERS = { AAA: 110, BBB: 105, CCC: 102, FFF: 101 };
    const FALLERS = { DDD: 90, EEE: 95, HHH: 98, GGG: 99 };

    function setup() {
        const yesterday = dayOffset(-1);
        const prices = { ...RISERS, ...FALLERS };
        const symbols = Object.keys(prices);
        return serviceWith({
            trades: symbols.map((s) => buy(s, 10, 100, '2026-01-02')),
            prices,
            history: Object.fromEntries(symbols.map((s) => [s, { [yesterday]: 100 }])),
        });
    }

    it('classe les hausses par ordre decroissant et plafonne a 3', () => {
        const { gainers } = setup().getDailyMovers('USD');
        // FFF (+1 %) est la 4e hausse : elle doit tomber.
        expect(gainers.map((g) => g.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
        expect(gainers[0].dayChangePercent).toBeCloseTo(10);
        expect(gainers[2].dayChangePercent).toBeCloseTo(2);
    });

    it('classe les baisses de la plus forte a la plus faible et plafonne a 3', () => {
        const { losers } = setup().getDailyMovers('USD');
        // GGG (-1 %) est la 4e baisse : elle doit tomber.
        expect(losers.map((l) => l.symbol)).toEqual(['DDD', 'EEE', 'HHH']);
        expect(losers[0].dayChangePercent).toBeCloseTo(-10);
    });

    it('expose le prix courant et la devise native', () => {
        const yesterday = dayOffset(-1);
        const svc = serviceWith({
            trades: [buy('MC.PA', 5, 600, '2026-01-02')],
            prices: { 'MC.PA': 660 },
            history: { 'MC.PA': { [yesterday]: 600 } },
        });
        const { gainers } = svc.getDailyMovers('EUR');
        expect(gainers[0]).toMatchObject({ symbol: 'MC.PA', currency: 'EUR', currentPrice: 660 });
        expect(gainers[0].dayChangePercent).toBeCloseTo(10);
    });

    it('ecarte les titres dont l historique est simule', () => {
        const yesterday = dayOffset(-1);
        const synthetic = APIService.markSyntheticHistory({ [yesterday]: 100 });
        const svc = serviceWith({
            trades: [buy('AAA', 10, 100, '2026-01-02'), buy('BBB', 10, 100, '2026-01-02')],
            prices: { AAA: 110, BBB: 130 },
            history: { AAA: { [yesterday]: 100 }, BBB: synthetic },
        });
        const { gainers } = svc.getDailyMovers('USD');
        // BBB varie plus fort mais sa serie est inventee : l'annoncer serait un
        // fait de marche fabrique.
        expect(gainers.map((g) => g.symbol)).toEqual(['AAA']);
    });

    it('ecarte les variations sous le seuil de 0,001 %', () => {
        const yesterday = dayOffset(-1);
        const svc = serviceWith({
            trades: [buy('FLAT', 10, 100, '2026-01-02')],
            prices: { FLAT: 100 },
            history: { FLAT: { [yesterday]: 100 } },
        });
        expect(svc.getDailyMovers('USD')).toEqual({ gainers: [], losers: [] });
    });

    it('aucune position : deux listes vides', () => {
        expect(serviceWith().getDailyMovers('USD')).toEqual({ gainers: [], losers: [] });
    });
});

describe('PortfolioService.getMonthlyPerformanceSummary', () => {
    function setup() {
        const monthAgo = dayOffset(-30);
        const prices = {
            AAA: 140,
            BBB: 130,
            CCC: 120,
            DDD: 110,
            EEE: 90,
            FFF: 80,
            GGG: 70,
            HHH: 60,
        };
        const symbols = Object.keys(prices);
        return serviceWith({
            trades: symbols.map((s) => buy(s, 10, 100, '2026-01-02')),
            prices,
            history: Object.fromEntries(symbols.map((s) => [s, { [monthAgo]: 100 }])),
        });
    }

    it('separe hausses et baisses sur 30 jours, avec le poids de la position', () => {
        const res = setup().getMonthlyPerformanceSummary('USD');
        // DDD (+10 %) et EEE (-10 %) sont les 4es de chaque liste : plafond a 3.
        expect(res.topGainers.map((g) => g.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
        expect(res.topLosers.map((l) => l.symbol)).toEqual(['HHH', 'GGG', 'FFF']);
        expect(res.topGainers[0].changePercent).toBeCloseTo(40);
        expect(res.topGainers[0].weightPercent).toBeGreaterThan(0);
    });

    it('ecarte les titres dont l historique est simule', () => {
        const monthAgo = dayOffset(-30);
        const svc = serviceWith({
            trades: [buy('AAA', 10, 100, '2026-01-02'), buy('SYN', 10, 100, '2026-01-02')],
            prices: { AAA: 120, SYN: 200 },
            history: {
                AAA: { [monthAgo]: 100 },
                SYN: APIService.markSyntheticHistory({ [monthAgo]: 100 }),
            },
        });
        const res = svc.getMonthlyPerformanceSummary('USD');
        expect(res.topGainers.map((g) => g.symbol)).toEqual(['AAA']);
    });

    it('portfolioPercent vient du badge 1M de la serie complete', () => {
        const svc = setup();
        svc.getHistoricalTimeline = /** @type {any} */ (() => ({ rangeStats: { '1M': 12.5 } }));
        expect(svc.getMonthlyPerformanceSummary('USD').portfolioPercent).toBe(12.5);
    });

    it('portfolioPercent = 0 si le badge est absent', () => {
        const svc = setup();
        svc.getHistoricalTimeline = /** @type {any} */ (() => ({ rangeStats: {} }));
        expect(svc.getMonthlyPerformanceSummary('USD').portfolioPercent).toBe(0);
    });
});

describe('PortfolioService.getUpcomingDividends', () => {
    function svcWithHolding(symbol = 'AAPL', qty = 10, price = 100) {
        return serviceWith({
            trades: [buy(symbol, qty, price, '2026-01-02')],
            prices: { [symbol]: price },
        });
    }

    it('deux versements connus : intervalle mesure et projete', async () => {
        // Deux dividendes espaces de 90 jours, le dernier il y a 80 jours :
        // prochaine echeance estimee dans 10 jours, donc dans la fenetre.
        APIService.getDividends = async () => [
            { date: dayOffset(-170), amountPerShare: 0.5 },
            { date: dayOffset(-80), amountPerShare: 0.6 },
        ];
        const res = await svcWithHolding().getUpcomingDividends('USD');
        expect(res).toHaveLength(1);
        expect(res[0].estimatedDate).toBe(dayOffset(10));
        expect(res[0].amount).toBeCloseTo(6); // 10 titres x 0,60
        expect(res[0].yieldPercent).toBeCloseTo(0.6); // 0,60 / 100
    });

    it('un seul versement connu : repli sur un trimestre (91 jours)', async () => {
        APIService.getDividends = async () => [{ date: dayOffset(-60), amountPerShare: 1 }];
        const res = await svcWithHolding().getUpcomingDividends('USD');
        expect(res).toHaveLength(1);
        expect(res[0].estimatedDate).toBe(dayOffset(31));
    });

    it('echeance au dela de 45 jours : exclue', async () => {
        APIService.getDividends = async () => [{ date: dayOffset(-10), amountPerShare: 1 }];
        const res = await svcWithHolding().getUpcomingDividends('USD');
        expect(res).toEqual([]);
    });

    it('echeance deja passee : exclue', async () => {
        APIService.getDividends = async () => [
            { date: dayOffset(-200), amountPerShare: 1 },
            { date: dayOffset(-190), amountPerShare: 1 },
        ];
        const res = await svcWithHolding().getUpcomingDividends('USD');
        expect(res).toEqual([]);
    });

    it('aucun historique de dividende : rien', async () => {
        APIService.getDividends = async () => [];
        expect(await svcWithHolding().getUpcomingDividends('USD')).toEqual([]);
    });

    it('convertit le montant dans la devise demandee', async () => {
        APIService.getDividends = async () => [{ date: dayOffset(-60), amountPerShare: 1 }];
        const svc = serviceWith({
            trades: [buy('MC.PA', 10, 600, '2026-01-02')],
            prices: { 'MC.PA': 600 },
        });
        svc.fxRate = 1.1;
        const res = await svc.getUpcomingDividends('USD');
        // 10 titres x 1 EUR, converti a 1,10 USD/EUR
        expect(res[0].amount).toBeCloseTo(11);
    });

    it('resultats tries par date estimee croissante', async () => {
        APIService.getDividends = async (symbol) =>
            symbol === 'AAA'
                ? [{ date: dayOffset(-70), amountPerShare: 1 }] // estimee dans 21 j
                : [{ date: dayOffset(-85), amountPerShare: 1 }]; // estimee dans 6 j
        const svc = serviceWith({
            trades: [buy('AAA', 1, 100, '2026-01-02'), buy('BBB', 1, 100, '2026-01-02')],
            prices: { AAA: 100, BBB: 100 },
        });
        const res = await svc.getUpcomingDividends('USD');
        expect(res.map((r) => r.symbol)).toEqual(['BBB', 'AAA']);
    });

    it('les lignes de tresorerie sont ignorees', async () => {
        let asked = 0;
        APIService.getDividends = async () => {
            asked++;
            return [];
        };
        const svc = serviceWith({
            trades: [{ ...buy('$CASH', 1000, 1, '2026-01-02'), type: 'DEPOSIT', amount: 1000 }],
        });
        await svc.getUpcomingDividends('USD');
        expect(asked).toBe(0);
    });
});

describe('PortfolioService.getUpcomingEarnings', () => {
    it('agrege les publications connues et les trie par date', async () => {
        const bySymbol = {
            AAA: { date: dayOffset(40), hour: 'amc', epsEstimate: 1.2, revenueEstimate: 1000 },
            BBB: { date: dayOffset(10), hour: 'bmo', epsEstimate: 0.4, revenueEstimate: 500 },
        };
        APIService.getEarnings = async (symbol) => bySymbol[symbol] || null;
        const svc = serviceWith({
            trades: [buy('AAA', 1, 100, '2026-01-02'), buy('BBB', 1, 100, '2026-01-02')],
            prices: { AAA: 100, BBB: 100 },
        });
        const res = await svc.getUpcomingEarnings();
        expect(res.map((r) => r.symbol)).toEqual(['BBB', 'AAA']);
        expect(res[0]).toMatchObject({ hour: 'bmo', epsEstimate: 0.4, revenueEstimate: 500 });
    });

    it('un symbole sans calendrier est simplement absent', async () => {
        APIService.getEarnings = async (symbol) =>
            symbol === 'AAA' ? { date: dayOffset(5), hour: null } : null;
        const svc = serviceWith({
            trades: [buy('AAA', 1, 100, '2026-01-02'), buy('MC.PA', 1, 600, '2026-01-02')],
            prices: { AAA: 100, 'MC.PA': 600 },
        });
        const res = await svc.getUpcomingEarnings();
        expect(res.map((r) => r.symbol)).toEqual(['AAA']);
    });

    it('aucune position : liste vide', async () => {
        APIService.getEarnings = async () => null;
        expect(await serviceWith().getUpcomingEarnings()).toEqual([]);
    });
});
