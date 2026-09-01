/**
 * Test de reference (« caracterisation ») de getHistoricalTimeline.
 *
 * La fonction est refondue pour des raisons de performance : d'un recalcul
 * complet a chaque jour vers une passe incrementale unique. Ce fichier fige la
 * sortie de la version d'origine sur des portefeuilles varies, pour que la
 * refonte soit prouvee equivalente et non seulement « plus rapide ».
 *
 * Il compare aussi la serie de plus-values a `computeProfitAsOf`, dont elle est
 * desormais deduite sans l'appeler : les deux chemins doivent rester d'accord.
 */
import { describe, it, expect } from 'vitest';
import { PortfolioService } from './portfolio.js';
import { Utils } from './utils.js';
import { setSupabaseClient } from './supabase.js';

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
setSupabaseClient(
    /** @type {any} */ ({
        from: () => ({}),
        auth: { getSession: async () => ({ data: { session: null } }) },
    })
);

const dayStr = (offset) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return Utils.getDateString(d);
};

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

/**
 * Historique de prix synthetique mais deterministe : une rampe, pour que la
 * valeur des positions bouge d'un jour a l'autre.
 */
function ramp(symbol, base, from = -40) {
    const out = {};
    for (let i = from; i <= 0; i++) {
        out[dayStr(i)] = base * (1 + (i + 40) / 200);
    }
    return { [symbol]: out };
}

function svcWith(trades, { prices = {}, history = {}, fxRate = 1.08 } = {}) {
    const svc = new PortfolioService();
    svc.portfolios = [
        { id: 'p1', name: 'A', color: '#111' },
        { id: 'p2', name: 'B', color: '#222' },
    ];
    svc.activePortfolioId = 'GLOBAL';
    svc.trades = trades;
    svc.marketPrices = prices;
    svc.dailyPriceCache = history;
    svc.fxRate = fxRate;
    return svc;
}

// --- portefeuilles de reference -------------------------------------------

/** @type {Record<string, () => PortfolioService>} */
const SCENARIOS = {
    'un seul achat': () =>
        svcWith([tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-30) })], {
            prices: { AAPL: 130 },
            history: ramp('AAPL', 100),
        }),

    'achats echelonnes sur le meme titre': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-30) }),
                tr({ type: 'BUY', qty: 5, price: 120, amount: 600, date: dayStr(-20) }),
                tr({ type: 'BUY', qty: 2, price: 140, amount: 280, date: dayStr(-5) }),
            ],
            { prices: { AAPL: 150 }, history: ramp('AAPL', 100) }
        ),

    'achat puis vente partielle': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, fees: 2, date: dayStr(-30) }),
                tr({ type: 'SELL', qty: 4, price: 130, amount: 520, fees: 1, date: dayStr(-10) }),
            ],
            { prices: { AAPL: 140 }, history: ramp('AAPL', 100) }
        ),

    'vente totale puis rachat': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-30) }),
                tr({ type: 'SELL', qty: 10, price: 130, amount: 1300, date: dayStr(-20) }),
                tr({ type: 'BUY', qty: 6, price: 110, amount: 660, date: dayStr(-8) }),
            ],
            { prices: { AAPL: 150 }, history: ramp('AAPL', 100) }
        ),

    'plusieurs devises': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-30) }),
                tr({
                    type: 'BUY',
                    symbol: 'MC.PA',
                    qty: 2,
                    price: 600,
                    amount: 1200,
                    date: dayStr(-25),
                }),
                tr({
                    type: 'BUY',
                    symbol: 'SHEL.L',
                    qty: 20,
                    price: 25,
                    amount: 500,
                    date: dayStr(-15),
                }),
            ],
            {
                prices: { AAPL: 130, 'MC.PA': 660, 'SHEL.L': 28 },
                history: {
                    ...ramp('AAPL', 100),
                    ...ramp('MC.PA', 600),
                    ...ramp('SHEL.L', 25),
                },
            }
        ),

    'tresorerie, dividendes et frais': () =>
        svcWith(
            [
                tr({
                    type: 'DEPOSIT',
                    symbol: '$CASH',
                    qty: 5000,
                    price: 1,
                    amount: 5000,
                    date: dayStr(-35),
                }),
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-30) }),
                tr({
                    type: 'DIVIDEND',
                    qty: 1,
                    price: 25,
                    amount: 25,
                    date: dayStr(-18),
                }),
                tr({
                    type: 'FEE',
                    symbol: '$FEE',
                    qty: 1,
                    price: 12,
                    amount: 12,
                    date: dayStr(-12),
                }),
                tr({
                    type: 'WITHDRAWAL',
                    symbol: '$CASH',
                    qty: 800,
                    price: 1,
                    amount: 800,
                    date: dayStr(-6),
                }),
            ],
            { prices: { AAPL: 140 }, history: ramp('AAPL', 100) }
        ),

    'plusieurs transactions le meme jour': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 5, price: 100, amount: 500, date: dayStr(-20) }),
                tr({ type: 'BUY', qty: 5, price: 105, amount: 525, date: dayStr(-20) }),
                tr({ type: 'SELL', qty: 3, price: 120, amount: 360, date: dayStr(-20) }),
            ],
            { prices: { AAPL: 130 }, history: ramp('AAPL', 100) }
        ),

    'vente sans position correspondante': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 4, price: 100, amount: 400, date: dayStr(-20) }),
                tr({ type: 'SELL', qty: 10, price: 120, amount: 1200, date: dayStr(-10) }),
                tr({
                    type: 'SELL',
                    symbol: 'MSFT',
                    qty: 3,
                    price: 300,
                    amount: 900,
                    date: dayStr(-8),
                }),
            ],
            { prices: { AAPL: 130 }, history: ramp('AAPL', 100) }
        ),

    'deux portefeuilles': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-30) }),
                tr({
                    portfolioId: 'p2',
                    type: 'BUY',
                    symbol: 'MSFT',
                    qty: 4,
                    price: 200,
                    amount: 800,
                    date: dayStr(-22),
                }),
            ],
            {
                prices: { AAPL: 130, MSFT: 260 },
                history: { ...ramp('AAPL', 100), ...ramp('MSFT', 200) },
            }
        ),

    'sans historique de prix (repli sur le PRU)': () =>
        svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-20) }),
                tr({
                    type: 'BUY',
                    symbol: 'MC.PA',
                    qty: 2,
                    price: 600,
                    amount: 1200,
                    date: dayStr(-15),
                }),
            ],
            { prices: {}, history: {} }
        ),

    'historique a trous (week-ends et jours feries)': () => {
        // Une cotation un jour sur trois : `getPriceOnDate` doit retomber sur la
        // derniere seance connue, et sur la plus ancienne quand la date demandee
        // precede tout l'historique.
        const sparse = {};
        for (let i = -25; i <= 0; i += 3) sparse[dayStr(i)] = 100 + (i + 25);
        return svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-40) }),
                tr({ type: 'BUY', qty: 5, price: 110, amount: 550, date: dayStr(-12) }),
                tr({ type: 'SELL', qty: 6, price: 120, amount: 720, date: dayStr(-4) }),
            ],
            { prices: {}, history: { AAPL: sparse } }
        );
    },

    'une seule cotation dans tout l historique': () =>
        svcWith([tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: dayStr(-20) })], {
            prices: {},
            history: { AAPL: { [dayStr(-10)]: 137 } },
        }),

    'aucune transaction': () => svcWith([]),
};

const RANGES = ['ALL', '1M', 'YTD', '3M'];
const CURRENCIES = ['USD', 'EUR'];

/** Arrondit toutes les series : on compare des montants, pas des bits. */
function round(tl) {
    const r = (arr) => arr.map((v) => +Number(v).toFixed(6));
    const rObj = (o) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +Number(v).toFixed(6)]));
    return {
        labels: tl.labels,
        rawDates: tl.rawDates,
        values: r(tl.values),
        perfValues: r(tl.perfValues),
        profitValues: r(tl.profitValues),
        rangeStats: rObj(tl.rangeStats),
        valueRangeStats: rObj(tl.valueRangeStats),
        profitRangeStats: rObj(tl.profitRangeStats),
    };
}

describe('getHistoricalTimeline : reference de non-regression', () => {
    for (const [name, build] of Object.entries(SCENARIOS)) {
        for (const currency of CURRENCIES) {
            it(`${name} — ${currency} : sortie stable sur toutes les plages`, () => {
                const svc = build();
                const snapshot = {};
                for (const range of RANGES) {
                    snapshot[range] = round(svc.getHistoricalTimeline(range, 'VALUE', currency));
                }
                expect(snapshot).toMatchSnapshot();
            });
        }
    }
});

describe('getHistoricalTimeline : accord avec computeProfitAsOf', () => {
    for (const [name, build] of Object.entries(SCENARIOS)) {
        it(`${name} : la serie de plus-values suit computeProfitAsOf jour par jour`, () => {
            const svc = build();
            const tl = svc.getHistoricalTimeline('ALL', 'VALUE', 'EUR');
            const expected = tl.rawDates.map(
                (d) => +svc.computeProfitAsOf(d, 'EUR').totalPnL.toFixed(6)
            );
            expect(tl.profitValues.map((v) => +v.toFixed(6))).toEqual(expected);
        });
    }
});

describe('getHistoricalTimeline : dates non canoniques', () => {
    // Les dates sont normalisees a l'ecriture (normalizeTradeInput), mais le tri
    // accepte plusieurs formats. Le curseur de la passe unique doit s'appuyer sur
    // les dates analysees : sur une comparaison de chaines il resterait bloque et
    // perdrait silencieusement toutes les transactions suivantes.
    const mixed = () => {
        const d = (offset) => {
            const x = new Date();
            x.setHours(0, 0, 0, 0);
            x.setDate(x.getDate() + offset);
            return x;
        };
        const pad = (n) => String(n).padStart(2, '0');
        const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
        // Meme jour, trois ecritures differentes.
        const nonPadded = (x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
        const slashes = (x) => `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`;

        return svcWith(
            [
                tr({ type: 'BUY', qty: 10, price: 100, amount: 1000, date: iso(d(-30)) }),
                tr({ type: 'BUY', qty: 5, price: 110, amount: 550, date: nonPadded(d(-20)) }),
                tr({ type: 'BUY', qty: 3, price: 120, amount: 360, date: slashes(d(-10)) }),
            ],
            { prices: { AAPL: 130 }, history: ramp('AAPL', 100) }
        );
    };

    it('les trois achats sont pris en compte, quel que soit le format de date', () => {
        const svc = mixed();
        const tl = svc.getHistoricalTimeline('ALL', 'VALUE', 'USD');
        const last = tl.values[tl.values.length - 1];
        // 18 titres au dernier cours de la rampe : rien ne doit manquer.
        const price = svc.getPriceOnDate('AAPL', tl.rawDates[tl.rawDates.length - 1], 100);
        expect(last).toBeCloseTo(18 * price, 6);
    });

    it('la serie reste d accord avec computeProfitAsOf', () => {
        const svc = mixed();
        const tl = svc.getHistoricalTimeline('ALL', 'VALUE', 'EUR');
        const expected = tl.rawDates.map(
            (d) => +svc.computeProfitAsOf(d, 'EUR').totalPnL.toFixed(6)
        );
        expect(tl.profitValues.map((v) => +v.toFixed(6))).toEqual(expected);
    });
});

describe('getHistoricalTimeline : invariants de structure', () => {
    for (const [name, build] of Object.entries(SCENARIOS)) {
        it(`${name} : toutes les series ont la meme longueur`, () => {
            const tl = build().getHistoricalTimeline('ALL', 'VALUE', 'USD');
            const n = tl.rawDates.length;
            expect(tl.labels).toHaveLength(n);
            expect(tl.values).toHaveLength(n);
            expect(tl.perfValues).toHaveLength(n);
            expect(tl.profitValues).toHaveLength(n);
            expect(n).toBeGreaterThan(0);
        });

        it(`${name} : aucune valeur NaN ni infinie`, () => {
            const tl = build().getHistoricalTimeline('ALL', 'VALUE', 'EUR');
            const all = [
                ...tl.values,
                ...tl.perfValues,
                ...tl.profitValues,
                ...Object.values(tl.rangeStats),
                ...Object.values(tl.valueRangeStats),
                ...Object.values(tl.profitRangeStats),
            ];
            expect(all.every((v) => Number.isFinite(v))).toBe(true);
        });

        it(`${name} : les dates sont croissantes et sans trou`, () => {
            const tl = build().getHistoricalTimeline('ALL', 'VALUE', 'USD');
            for (let i = 1; i < tl.rawDates.length; i++) {
                const prev = Utils.parseDate(tl.rawDates[i - 1]).getTime();
                const cur = Utils.parseDate(tl.rawDates[i]).getTime();
                expect(cur - prev).toBe(86400000);
            }
        });
    }
});
