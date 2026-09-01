/**
 * Tests du controleur UI (public/js/app.js). Le moteur financier est teste a
 * part, par import direct de public/js/core/*.js — ici on ne garde que ce qui
 * touche reellement au DOM et a Chart.js.
 *
 * app.js est un module ES : on installe les globales du navigateur dont il a
 * besoin, puis on l'importe dynamiquement (l'import statique serait hisse avant
 * l'installation des stubs).
 */
import { describe, it, expect } from 'vitest';

// --- stubs de navigateur ---------------------------------------------------

function makeEl() {
    const el = {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
        appendChild(c) { return c; }, removeChild() {}, append() {},
        addEventListener() {}, removeEventListener() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        insertAdjacentHTML() {}, getContext() { return {}; },
        click() {}, focus() {}, blur() {}, remove() {}, scrollIntoView() {},
        getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
        textContent: '', innerHTML: '', hidden: false,
    };
    return el;
}

const documentStub = {
    createElement: () => makeEl(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
};

const store = new Map();
const windowStub = /** @type {any} */ ({
    supabase: { createClient: () => ({
        from: () => ({}),
        auth: { getSession: async () => ({ data: { session: null } }) },
    }) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    location: { href: 'https://test.local/', origin: 'https://test.local', pathname: '/', reload() {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
windowStub.window = windowStub;

Object.assign(globalThis, {
    window: windowStub,
    document: documentStub,
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
    },
    matchMedia: windowStub.matchMedia,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    cancelAnimationFrame: windowStub.cancelAnimationFrame,
    getComputedStyle: windowStub.getComputedStyle,
    alert: () => {},
    confirm: () => true,
    Chart: class { constructor() {} update() {} destroy() {} resize() {} },
});
globalThis.fetch = /** @type {any} */ (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));

// Import apres l'installation des globales : app.js cree le client Supabase et
// pose ses ecouteurs au chargement du module.
const mod = await import('./app.js');
const { APIService, Utils, PortfolioService, CONFIG } = mod;
// Les tests ci-dessous remplacent des morceaux du controleur par des doubles
// partiels : on relache le type sur cette reference-la uniquement.
const App = /** @type {any} */ (mod.App);

// ---------------------------------------------------------------------------

describe('chargement du module', () => {
    it('expose le controleur et le moteur', () => {
        expect(typeof Utils).toBe('object');
        expect(typeof PortfolioService).toBe('function');
        expect(CONFIG.SUPABASE_URL).toMatch(/^https:\/\//);
        expect(App).toBeTruthy();
        expect(APIService).toBeTruthy();
    });

    it('publie le controleur sur window pour les tests e2e', () => {
        expect(windowStub.App).toBe(App);
    });
});

describe('App.renderResearchChart - fenetre de dates & options du graphe', () => {
    let captured, lastChartConfig;

    function setup(range, { holdings = [], researchSymbol = 'AAPL', canvas = true } = {}) {
        captured = undefined;
        lastChartConfig = null;
        App.chartState = { researchRange: range, currency: 'EUR' };
        App.researchSymbol = researchSymbol;
        App.researchChart = null;
        App.service = { calculatePortfolio: () => ({ holdings }) };
        App.chartInk = () => ({ tick: '#111', grid: '#222' });
        APIService.getDailyHistory = (sym, start, end, avg, cur) => {
            captured = { sym, start, end, avg, cur };
            return Promise.resolve({ '2026-01-02': 10, '2026-01-03': 12 });
        };
        /** @type {any} */ (globalThis).Chart = class {
            constructor(ctx, config) { lastChartConfig = config; }
            update() {} destroy() {}
        };
        documentStub.getElementById = /** @type {any} */ ((id) =>
            (canvas && id === 'researchChart' ? { getContext: () => ({}) } : null));
    }

    it("MAX : date de debut = 50 ans avant aujourd'hui (meme mois/jour)", async () => {
        setup('MAX');
        const ref = new Date();
        await App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setFullYear(exp.getFullYear() - 50);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('1Y : date de debut = 12 mois avant', async () => {
        setup('1Y');
        const ref = new Date();
        await App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 12);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('1M : date de debut = 1 mois avant', async () => {
        setup('1M');
        const ref = new Date();
        await App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 1);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('5Y : date de debut = 60 mois avant', async () => {
        setup('5Y');
        const ref = new Date();
        await App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 60);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('plage inconnue : repli sur 12 mois', async () => {
        setup('ZZZ');
        const ref = new Date();
        await App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 12);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it("date de fin = aujourd'hui", async () => {
        setup('MAX');
        const ref = new Date();
        await App.renderResearchChart('AAPL');
        expect(captured.end.getFullYear()).toBe(ref.getFullYear());
        expect(captured.end.getMonth()).toBe(ref.getMonth());
        expect(captured.end.getDate()).toBe(ref.getDate());
    });

    it('transmet avgPrice / currentPrice du holding correspondant', async () => {
        setup('1Y', { holdings: [{ symbol: 'AAPL', avgPrice: 42, currentPrice: 55 }] });
        await App.renderResearchChart('AAPL');
        expect(captured.avg).toBe(42);
        expect(captured.cur).toBe(55);
    });

    it('sans holding correspondant : avg / current = undefined', async () => {
        setup('1Y', { holdings: [{ symbol: 'MSFT', avgPrice: 1, currentPrice: 2 }] });
        await App.renderResearchChart('AAPL');
        expect(captured.avg).toBeUndefined();
        expect(captured.cur).toBeUndefined();
    });

    it('options : interaction et tooltip en mode index', async () => {
        setup('1Y');
        await App.renderResearchChart('AAPL');
        expect(lastChartConfig.options.interaction).toEqual({ mode: 'index', axis: 'x', intersect: false });
        expect(lastChartConfig.options.plugins.tooltip.mode).toBe('index');
        expect(lastChartConfig.options.plugins.tooltip.intersect).toBe(false);
    });

    it('canvas absent : aucun appel reseau', async () => {
        setup('1Y', { canvas: false });
        await App.renderResearchChart('AAPL');
        expect(captured).toBeUndefined();
    });

    it('symbole obsolete apres fetch : pas de creation de graphe', async () => {
        setup('1Y', { researchSymbol: 'OTHER' });
        await App.renderResearchChart('AAPL');
        expect(captured).toBeDefined();
        expect(lastChartConfig).toBeNull();
    });

    it('graphe existant : mise a jour des donnees sans recreation', async () => {
        setup('1Y');
        const existing = {
            data: { labels: [], datasets: [{}] },
            options: { plugins: { tooltip: { callbacks: {} } }, scales: { y: { ticks: {} } } },
            update() { this._updated = true; },
        };
        App.researchChart = existing;
        await App.renderResearchChart('AAPL');
        expect(lastChartConfig).toBeNull();
        expect(existing._updated).toBe(true);
        expect(existing.data.datasets[0].data).toEqual([10, 12]);
        expect(existing.data.labels).toHaveLength(2);
    });
});
