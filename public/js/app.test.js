/**
 * Tests globaux du moteur financier cote client (public/js/app.js).
 *
 * app.js est un script navigateur (pas de module/export). On l'evalue ici dans
 * un contexte vm avec des stubs minimalistes (window/document/localStorage/Chart...),
 * puis on expose CONFIG / Utils / PortfolioService pour tester la logique pure :
 * formatage FR, helpers de date, classification d'actifs, conversion de devises,
 * normalisation/validation des transactions et calcul de portefeuille.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');

// --- fabrique de contexte : stubs navigateur ---------------------------------

function escapeHtmlLike(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeEl() {
    const el = {
        _text: '',
        _html: '',
        style: {},
        dataset: {},
        attributes: {},
        children: [],
        hidden: false,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        appendChild(c) { this.children.push(c); return c; },
        removeChild() {},
        append() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        insertAdjacentHTML() {},
        getContext() { return {}; },
        click() {}, focus() {}, blur() {}, remove() {}, scrollIntoView() {},
        getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
    };
    Object.defineProperty(el, 'textContent', {
        get() { return el._text; },
        set(v) { el._text = String(v); el._html = escapeHtmlLike(v); },
    });
    Object.defineProperty(el, 'innerHTML', {
        get() { return el._html; },
        set(v) { el._html = String(v); },
    });
    return el;
}

function supabaseStub(overrides = {}) {
    const chain = {
        from() { return chain; },
        select() { return chain; },
        insert() { return chain; },
        update() { return chain; },
        delete() { return chain; },
        upsert: overrides.upsert || (() => Promise.resolve({ data: null, error: null })),
        eq() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        single() { return Promise.resolve({ data: null, error: null }); },
        maybeSingle: overrides.maybeSingle || (() => Promise.resolve({ data: null, error: null })),
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return {
        from() { return chain; },
        auth: { getSession: async () => ({ data: { session: overrides.session || null } }) },
    };
}

function loadApp(supabaseOverrides = {}) {
    const store = new Map();
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
    };

    const win = {
        supabase: { createClient: () => supabaseStub(supabaseOverrides) },
        localStorage,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
        location: { href: 'https://test.local/', reload() {} },
        requestAnimationFrame() { return 0; },
        cancelAnimationFrame() {},
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
        Chart: class Chart { constructor() {} update() {} destroy() {} resize() {} static getChart() { return null; } },
        lucide: { createIcons() {} },
    };
    win.window = win;

    const doc = {
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

    const sandbox = {
        window: win,
        document: doc,
        localStorage,
        navigator: { userAgent: 'node', onLine: true, language: 'fr-FR' },
        fetch: supabaseOverrides.fetch || (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })),
        console,
        Intl,
        Date,
        Math,
        JSON,
        setTimeout,
        clearTimeout,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        atob: (b) => Buffer.from(b, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        Chart: win.Chart,
        lucide: win.lucide,
        requestAnimationFrame: win.requestAnimationFrame,
        cancelAnimationFrame: win.cancelAnimationFrame,
        getComputedStyle: win.getComputedStyle,
        CustomEvent: win.CustomEvent,
        alert: () => {},
        confirm: () => true,
        prompt: () => null,
    };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    vm.createContext(sandbox);
    const wrapped = SOURCE +
        '\n;globalThis.__APP__ = { CONFIG, AI_PROVIDERS, AuthService, Utils, APIService, AnalysisUtils, AnalysisService, PortfolioService, App, jwtIssuedAt, isJwtTimingError };\n';
    new vm.Script(wrapped, { filename: 'app.js' }).runInContext(sandbox);
    return { ...sandbox.__APP__, localStorage, store, document: doc, sandbox };
}

// On charge une seule fois : le code teste est sans effet de bord au chargement.
const app = loadApp();
const { Utils, PortfolioService, CONFIG } = app;

// helper : normalise les espaces insecables produits par Intl fr-FR
const sp = (s) => s.replace(/[  ]/g, " ");

// ---------------------------------------------------------------------------

describe('chargement du module', () => {
    it('expose les symboles principaux', () => {
        expect(typeof Utils).toBe('object');
        expect(typeof PortfolioService).toBe('function');
        expect(CONFIG.SUPABASE_URL).toMatch(/^https:\/\//);
        expect(app.App).toBeTruthy();
        expect(app.APIService).toBeTruthy();
    });
});

describe('Utils.formatCurrency', () => {
    it('prefixe le symbole $ pour USD', () => {
        expect(sp(Utils.formatCurrency(1234.5, 'USD'))).toBe('$1 234,50');
    });

    it('suffixe le symbole € pour EUR', () => {
        expect(sp(Utils.formatCurrency(1234.5, 'EUR'))).toBe('1 234,50 €');
    });

    it('utilise le signe moins typographique U+2212 pour les negatifs', () => {
        expect(Utils.formatCurrency(-5, 'USD').startsWith('−$')).toBe(true);
        expect(Utils.formatCurrency(-5, 'EUR').startsWith('−')).toBe(true);
        expect(Utils.formatCurrency(-5, 'USD')).not.toContain('-');
    });

    it('traite null / undefined / NaN comme 0', () => {
        expect(sp(Utils.formatCurrency(null, 'USD'))).toBe('$0,00');
        expect(sp(Utils.formatCurrency(undefined, 'EUR'))).toBe('0,00 €');
        expect(sp(Utils.formatCurrency(NaN, 'USD'))).toBe('$0,00');
    });

    it('defaut = USD ; GBP/CAD formates ; devise inconnue repli sur USD', () => {
        expect(Utils.formatCurrency(10)).toContain('$');
        expect(Utils.formatCurrency(10, 'GBP')).toContain('£');
        expect(Utils.formatCurrency(10, 'CAD')).toContain('CA$');
        expect(Utils.formatCurrency(10, 'XYZ')).toContain('$');
    });

    it('toujours 2 decimales', () => {
        expect(sp(Utils.formatCurrency(1000, 'EUR'))).toBe('1 000,00 €');
        expect(sp(Utils.formatCurrency(0.1, 'USD'))).toBe('$0,10');
    });
});

describe('Utils.formatPercent', () => {
    it('ajoute + pour les positifs quand withSign (defaut)', () => {
        expect(sp(Utils.formatPercent(3.2))).toBe('+3,20 %');
    });

    it('omet le + quand withSign = false', () => {
        expect(sp(Utils.formatPercent(3.2, false))).toBe('3,20 %');
    });

    it('signe moins typographique pour les negatifs', () => {
        expect(sp(Utils.formatPercent(-3.2))).toBe('−3,20 %');
    });

    it('0 sans signe', () => {
        expect(sp(Utils.formatPercent(0))).toBe('0,00 %');
    });

    it('renvoie "0,00 %" pour une valeur non numerique', () => {
        expect(sp(Utils.formatPercent(null))).toBe('0,00 %');
        expect(sp(Utils.formatPercent(NaN))).toBe('0,00 %');
    });
});

describe('Utils - helpers de date', () => {
    it('parseDate lit une chaine ISO comme date locale a minuit', () => {
        const d = Utils.parseDate('2026-08-27');
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(7);
        expect(d.getDate()).toBe(27);
        expect(d.getHours()).toBe(0);
    });

    it('parseDate lit le format FR jj/mm/aaaa', () => {
        const d = Utils.parseDate('05/02/2026');
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(1);
        expect(d.getDate()).toBe(5);
    });

    it('parseDate sans argument = aujourd hui a minuit', () => {
        const d = Utils.parseDate();
        const now = new Date();
        expect(d.getFullYear()).toBe(now.getFullYear());
        expect(d.getHours()).toBe(0);
    });

    it('getDateString formatte en AAAA-MM-JJ', () => {
        expect(Utils.getDateString(new Date(2026, 7, 5))).toBe('2026-08-05');
        expect(Utils.getDateString('2026-01-09')).toBe('2026-01-09');
    });

    it('formatDateDisplay formatte en JJ/MM/AAAA', () => {
        expect(Utils.formatDateDisplay('2026-08-27')).toBe('27/08/2026');
        expect(Utils.formatDateDisplay('')).toBe('');
    });

    it('daysBetween compte les jours entiers dans les deux sens', () => {
        expect(Utils.daysBetween('2026-01-01', '2026-01-11')).toBe(10);
        expect(Utils.daysBetween('2026-01-11', '2026-01-01')).toBe(10);
    });
});

describe('Utils - classification symbole', () => {
    it('getExchangeName', () => {
        expect(Utils.getExchangeName('')).toBe('US');
        expect(Utils.getExchangeName('$CASH')).toBe('Trésorerie');
        expect(Utils.getExchangeName('AAPL')).toBe('NASDAQ/NYSE');
        expect(Utils.getExchangeName('MC.PA')).toBe('Euronext Paris');
        expect(Utils.getExchangeName('FOO.ZZ')).toBe('ZZ');
    });

    it('getCurrency deduit la devise du suffixe de place', () => {
        expect(Utils.getCurrency('AAPL')).toBe('USD');
        expect(Utils.getCurrency('$CASH')).toBe('USD');
        expect(Utils.getCurrency('MC.PA')).toBe('EUR');
        expect(Utils.getCurrency('SAP.DE')).toBe('EUR');
        expect(Utils.getCurrency('VOD.L')).toBe('GBP');
        expect(Utils.getCurrency('SHOP.TO')).toBe('CAD');
        expect(Utils.getCurrency('7203.T')).toBe('USD');
    });

    it('getAssetClass distingue tresorerie / crypto / actions', () => {
        expect(Utils.getAssetClass('$CASH')).toBe('Trésorerie');
        expect(Utils.getAssetClass('BTC-USD')).toBe('Crypto');
        expect(Utils.getAssetClass('ETH')).toBe('Crypto');
        expect(Utils.getAssetClass('AAPL')).toBe('Actions & ETF');
        expect(Utils.getAssetClass('')).toBe('Actions & ETF');
    });
});

describe('Utils - CSV', () => {
    it('csvCell entoure de guillemets si separateur / retour ligne / guillemet', () => {
        expect(Utils.csvCell('simple')).toBe('simple');
        expect(Utils.csvCell('a;b')).toBe('"a;b"');
        expect(Utils.csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
        expect(Utils.csvCell(null)).toBe('');
    });

    it('csvNumber ecrit la virgule decimale FR', () => {
        expect(Utils.csvNumber(10.5)).toBe('10,5');
        expect(Utils.csvNumber(42)).toBe('42');
        expect(Utils.csvNumber('')).toBe('');
        expect(Utils.csvNumber('abc')).toBe('');
    });

    it('parseCSVNumber accepte virgule ou point', () => {
        expect(Utils.parseCSVNumber('10,5')).toBe(10.5);
        expect(Utils.parseCSVNumber('10.5')).toBe(10.5);
        expect(Utils.parseCSVNumber('')).toBe(0);
        expect(Utils.parseCSVNumber('   ')).toBe(0);
    });

    it('parseCSV utilise ; comme separateur et minusculise les entetes', () => {
        const rows = Utils.parseCSV('Date;Type;Symbol\n2026-01-01;BUY;AAPL\n2026-01-02;SELL;AAPL');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ date: '2026-01-01', type: 'BUY', symbol: 'AAPL' });
        expect(rows[1].type).toBe('SELL');
    });

    it('parseCSV gere les champs entre guillemets contenant un separateur', () => {
        const rows = Utils.parseCSV('name;note\n"Fonds A";"vendu ; solde"');
        expect(rows[0].note).toBe('vendu ; solde');
    });
});

describe('Utils.escapeHtml', () => {
    it('neutralise les caracteres HTML', () => {
        expect(Utils.escapeHtml('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; "y"');
    });
});

// ---------------------------------------------------------------------------

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
    beforeEach(() => { svc = new PortfolioService(); });

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
        svc.portfolios = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
        svc.trades = [
            { id: 't3', portfolioId: 'p2', type: 'BUY', symbol: 'AAPL', qty: 1, price: 10, amount: 10, fees: 0, date: '2026-03-01' },
            { id: 't1', portfolioId: 'p1', type: 'BUY', symbol: 'MSFT', qty: 1, price: 20, amount: 20, fees: 0, date: '2026-01-01' },
            { id: 't2', portfolioId: 'p1', type: 'BUY', symbol: 'NVDA', qty: 1, price: 30, amount: 30, fees: 0, date: '2026-02-01' },
        ];
    });

    it('GLOBAL renvoie toutes les transactions triees par date croissante', () => {
        const sorted = svc.getSortedTrades();
        expect(sorted.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    });

    it('un portefeuille actif restreint le perimetre', () => {
        svc.activePortfolioId = 'p1';
        expect(svc.getFilteredTrades().map((t) => t.id).sort()).toEqual(['t1', 't2']);
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
        svc.portfolios = [{ id: 'p1', name: 'Principal' }, { id: 'p2', name: 'Perso' }];
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
        const n = svc.normalizeTradeInput({ type: 'buy', symbol: '  aapl ', qty: '2', price: '10.5' });
        expect(n).toMatchObject({ type: 'BUY', symbol: 'AAPL', qty: 2, price: 10.5, amount: 21, portfolioId: 'p1' });
        expect(n.date).toBe(Utils.getDateString());
    });

    it('DEPOSIT : symbole force a $CASH, prix 1, qty = montant', () => {
        const n = svc.normalizeTradeInput({ type: 'deposit', amount: '500' });
        expect(n).toMatchObject({ type: 'DEPOSIT', symbol: '$CASH', amount: 500, qty: 500, price: 1 });
    });

    it('DIVIDEND : conserve le symbole, qty 1, prix = montant', () => {
        const n = svc.normalizeTradeInput({ type: 'dividend', symbol: 'aapl', amount: '12.3' });
        expect(n).toMatchObject({ type: 'DIVIDEND', symbol: 'AAPL', qty: 1, price: 12.3, amount: 12.3 });
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
        expect(() => svc.validateTrade(norm({ type: 'buy', symbol: 'AAPL', qty: 1, price: 10, date: '2020-01-01' }))).not.toThrow();
    });

    it('refuse une date future', () => {
        const future = new Date(Date.now() + 3 * 864e5);
        expect(() => svc.validateTrade(norm({ type: 'buy', symbol: 'AAPL', qty: 1, price: 10, date: future })))
            .toThrow(/futur/);
    });

    it('refuse une quantite <= 0', () => {
        expect(() => svc.validateTrade(norm({ type: 'buy', symbol: 'AAPL', qty: 0, price: 10, date: '2020-01-01' })))
            .toThrow(/Quantit/);
    });

    it('refuse un prix <= 0', () => {
        expect(() => svc.validateTrade(norm({ type: 'buy', symbol: 'AAPL', qty: 1, price: 0, date: '2020-01-01' })))
            .toThrow(/Prix/);
    });

    it('refuse de vendre plus que la quantite detenue', () => {
        svc.trades = [{ id: 'b1', portfolioId: 'p1', type: 'BUY', symbol: 'AAPL', qty: 3, price: 10, amount: 30, fees: 0, date: '2020-01-01' }];
        expect(() => svc.validateTrade(norm({ type: 'sell', symbol: 'AAPL', qty: 5, price: 12, date: '2021-01-01' })))
            .toThrow(/supérieure|detenue|détenue/i);
    });

    it('autorise une vente couverte par les achats', () => {
        svc.trades = [{ id: 'b1', portfolioId: 'p1', type: 'BUY', symbol: 'AAPL', qty: 3, price: 10, amount: 30, fees: 0, date: '2020-01-01' }];
        expect(() => svc.validateTrade(norm({ type: 'sell', symbol: 'AAPL', qty: 2, price: 12, date: '2021-01-01' })))
            .not.toThrow();
    });

    it('refuse un montant <= 0 pour un mouvement de cash', () => {
        expect(() => svc.validateTrade(norm({ type: 'deposit', amount: 0, date: '2020-01-01' })))
            .toThrow(/Montant/);
    });
});

describe('PortfolioService.calculatePortfolio', () => {
    function cashOnlyService() {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.trades = [
            { id: 'd1', portfolioId: 'p1', type: 'DEPOSIT', symbol: '$CASH', qty: 1000, price: 1, amount: 1000, fees: 0, date: '2026-01-01' },
            { id: 'w1', portfolioId: 'p1', type: 'WITHDRAWAL', symbol: '$CASH', qty: 200, price: 1, amount: 200, fees: 0, date: '2026-01-05' },
            { id: 'v1', portfolioId: 'p1', type: 'DIVIDEND', symbol: 'AAPL', qty: 1, price: 50, amount: 50, fees: 0, date: '2026-02-01' },
            { id: 'f1', portfolioId: 'p1', type: 'FEE', symbol: '$FEE', qty: 1, price: 10, amount: 10, fees: 0, date: '2026-02-02' },
        ];
        return svc;
    }

    it('agrege depots / retraits / dividendes / frais (USD)', () => {
        const s = cashOnlyService().calculatePortfolio('USD');
        expect(s.cash).toBeCloseTo(850);        // 1000 - 200 + 50 ; le FEE autonome ne bouge pas le cash affiche
        expect(s.totalDeposits).toBeCloseTo(1000);
        expect(s.totalWithdrawals).toBeCloseTo(200);
        expect(s.totalDividends).toBeCloseTo(50);
        expect(s.holdings).toEqual([]);
        expect(s.totalValue).toBeCloseTo(850);
        expect(s.totalPnL).toBeCloseTo(40);     // dividendes 50 - frais autonomes 10
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
            { id: 'b1', portfolioId: 'p1', type: 'BUY', symbol: 'AAPL', qty: 2, price: 100, amount: 200, fees: 0, date: '2026-01-02' },
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
            { id: 'b1', portfolioId: 'p1', type: 'BUY', symbol: 'AAPL', qty: 2, price: 100, amount: 200, fees: 0, date: '2026-01-02' },
            { id: 's1', portfolioId: 'p1', type: 'SELL', symbol: 'AAPL', qty: 2, price: 130, amount: 260, fees: 0, date: '2026-03-02' },
        ];
        svc.marketPrices = { AAPL: 150 };

        const s = svc.calculatePortfolio('USD');
        expect(s.holdings).toEqual([]);
        expect(s.realizedPnL).toBeCloseTo(60); // (130 - 100) * 2
    });
});

describe('App.renderResearchChart - fenetre de dates & options du graphe', () => {
    let captured, lastChartConfig;

    function setup(range, { holdings = [], researchSymbol = 'AAPL', canvas = true } = {}) {
        captured = undefined;
        lastChartConfig = null;
        app.App.chartState = { researchRange: range, currency: 'EUR' };
        app.App.researchSymbol = researchSymbol;
        app.App.researchChart = null;
        app.App.service = { calculatePortfolio: () => ({ holdings }) };
        app.App.chartInk = () => ({ tick: '#111', grid: '#222' });
        app.APIService.getDailyHistory = (sym, start, end, avg, cur) => {
            captured = { sym, start, end, avg, cur };
            return Promise.resolve({ '2026-01-02': 10, '2026-01-03': 12 });
        };
        app.sandbox.Chart = class {
            constructor(ctx, config) { lastChartConfig = config; }
            update() {} destroy() {}
        };
        app.document.getElementById = (id) =>
            (canvas && id === 'researchChart' ? { getContext: () => ({}) } : null);
    }

    it("MAX : date de debut = 50 ans avant aujourd'hui (meme mois/jour)", async () => {
        setup('MAX');
        const ref = new Date();
        await app.App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setFullYear(exp.getFullYear() - 50);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('1Y : date de debut = 12 mois avant', async () => {
        setup('1Y');
        const ref = new Date();
        await app.App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 12);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('1M : date de debut = 1 mois avant', async () => {
        setup('1M');
        const ref = new Date();
        await app.App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 1);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('5Y : date de debut = 60 mois avant', async () => {
        setup('5Y');
        const ref = new Date();
        await app.App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 60);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it('plage inconnue : repli sur 12 mois', async () => {
        setup('ZZZ');
        const ref = new Date();
        await app.App.renderResearchChart('AAPL');
        const exp = new Date(ref); exp.setMonth(exp.getMonth() - 12);
        expect(captured.start.getFullYear()).toBe(exp.getFullYear());
        expect(captured.start.getMonth()).toBe(exp.getMonth());
        expect(captured.start.getDate()).toBe(exp.getDate());
    });

    it("date de fin = aujourd'hui", async () => {
        setup('MAX');
        const ref = new Date();
        await app.App.renderResearchChart('AAPL');
        expect(captured.end.getFullYear()).toBe(ref.getFullYear());
        expect(captured.end.getMonth()).toBe(ref.getMonth());
        expect(captured.end.getDate()).toBe(ref.getDate());
    });

    it('transmet avgPrice / currentPrice du holding correspondant', async () => {
        setup('1Y', { holdings: [{ symbol: 'AAPL', avgPrice: 42, currentPrice: 55 }] });
        await app.App.renderResearchChart('AAPL');
        expect(captured.avg).toBe(42);
        expect(captured.cur).toBe(55);
    });

    it('sans holding correspondant : avg / current = undefined', async () => {
        setup('1Y', { holdings: [{ symbol: 'MSFT', avgPrice: 1, currentPrice: 2 }] });
        await app.App.renderResearchChart('AAPL');
        expect(captured.avg).toBeUndefined();
        expect(captured.cur).toBeUndefined();
    });

    it('options : interaction et tooltip en mode index', async () => {
        setup('1Y');
        await app.App.renderResearchChart('AAPL');
        expect(lastChartConfig.options.interaction).toEqual({ mode: 'index', axis: 'x', intersect: false });
        expect(lastChartConfig.options.plugins.tooltip.mode).toBe('index');
        expect(lastChartConfig.options.plugins.tooltip.intersect).toBe(false);
    });

    it('canvas absent : aucun appel reseau', async () => {
        setup('1Y', { canvas: false });
        await app.App.renderResearchChart('AAPL');
        expect(captured).toBeUndefined();
    });

    it('symbole obsolete apres fetch : pas de creation de graphe', async () => {
        setup('1Y', { researchSymbol: 'OTHER' });
        await app.App.renderResearchChart('AAPL');
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
        app.App.researchChart = existing;
        await app.App.renderResearchChart('AAPL');
        expect(lastChartConfig).toBeNull();
        expect(existing._updated).toBe(true);
        expect(existing.data.datasets[0].data).toEqual([10, 12]);
        expect(existing.data.labels).toHaveLength(2);
    });
});

describe('helpers JWT (garde-fou horloge desynchronisee)', () => {
    const { jwtIssuedAt, isJwtTimingError } = app;
    const mkToken = (payload) => {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
        const { PortfolioService, store } = loadApp({
            maybeSingle: () => Promise.resolve({
                data: { ai_provider: 'groq', ai_providers_configured: ['groq', 'openai'] }, error: null
            })
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
        const { PortfolioService, store } = loadApp({
            maybeSingle: () => Promise.resolve({ data: null, error: null })
        });
        const svc = new PortfolioService();
        svc.userId = 'u-1';
        store.set('portfolio_ai_provider', 'anthropic');

        await svc._loadAiConfig();

        expect(svc.aiProvider).toBe('anthropic');
        expect(svc.aiConfigured).toEqual([]);
    });

    it('_loadAiConfig retombe sur le cache local si la table est absente', async () => {
        const { PortfolioService, store } = loadApp({
            maybeSingle: () => Promise.resolve({ data: null, error: { message: 'relation "user_settings" does not exist' } })
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
        const { PortfolioService, store } = loadApp({
            upsert: (payload, opts) => { calls.push({ payload, opts }); return Promise.resolve({ data: null, error: null }); }
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
        const { PortfolioService, store } = loadApp({
            session: SESSION,
            fetch: async (urlArg, opts) => {
                reqs.push({ url: String(urlArg), opts });
                return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'anthropic', configured: ['anthropic'] }) };
            }
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
        expect(JSON.parse(reqs[0].opts.body)).toEqual({ provider: 'anthropic', key: 'sk-ant-secret' });
        // aucune trace de la clé dans le stockage local
        expect(JSON.stringify([...store.entries()])).not.toContain('sk-ant-secret');
    });

    it('removeAiKey appelle DELETE /ai/key?provider= et rafraîchit aiConfigured', async () => {
        const reqs = [];
        const { PortfolioService } = loadApp({
            session: SESSION,
            fetch: async (urlArg, opts) => {
                reqs.push({ url: String(urlArg), method: opts && opts.method });
                return { ok: true, status: 200, json: async () => ({ ok: true, configured: [] }) };
            }
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
        const { AI_PROVIDERS } = loadApp();
        for (const p of Object.keys(AI_PROVIDERS)) {
            expect(typeof AI_PROVIDERS[p].call).toBe('undefined');
            expect(typeof AI_PROVIDERS[p].label).toBe('string');
        }
    });
});

// ---------------------------------------------------------------------------
// Phase 1 — couche de donnees d'analyse de valeur (AnalysisService / AnalysisUtils)
// ---------------------------------------------------------------------------

describe('AnalysisUtils', () => {
    const { AnalysisUtils: A } = app;

    it('num : ne garde que les nombres finis', () => {
        expect(A.num(3.2)).toBe(3.2);
        expect(A.num(NaN)).toBeNull();
        expect(A.num(Infinity)).toBeNull();
        expect(A.num('5')).toBeNull();
        expect(A.num(null)).toBeNull();
    });

    it('pctU : fraction -> unite pourcent', () => {
        expect(A.pctU(0.128)).toBeCloseTo(12.8, 6);
        expect(A.pctU(null)).toBeNull();
    });

    it('avg : moyenne en ignorant les trous', () => {
        expect(A.avg([2, 4, null, 6, NaN])).toBe(4);
        expect(A.avg([])).toBeNull();
    });

    it('cagrPct : taux annualise en pourcent', () => {
        expect(A.cagrPct(100, 200, 1)).toBeCloseTo(100, 6);
        expect(A.cagrPct(100, 100, 4)).toBeCloseTo(0, 6);
        expect(A.cagrPct(0, 200, 3)).toBeNull();
    });

    it('trend : classe une serie ancien -> recent', () => {
        expect(A.trend([10, 12, 15, 20])).toBe('croissant');
        expect(A.trend([20, 15, 10])).toBe('décroissant');
        expect(A.trend([10, 10.1, 9.9, 10])).toBe('stable');
        expect(A.trend([5])).toBeNull();
    });
});

describe('AnalysisService._normalize', () => {
    const { AnalysisService: S } = app;

    it('fusionne quoteSummary + FMP dans un StockAnalysis normalise', () => {
        const out = S._normalize({
            symbol: 'MSFT',
            nonUS: false,
            errors: [],
            fund: { price: 420, previousClose: 415, peTTM: 35, roeTTM: 38.1, netMarginTTM: 34, dividendYield: 0.72, fundamentalsSource: 'finnhub' },
            qs: {
                source: 'yahoo-quoteSummary', name: 'Microsoft', currency: 'USD',
                price: 420.5, previousClose: 415, forwardPE: undefined, peForward: 32,
                pegRatio: 2.1, enterpriseToEbitda: 24, grossMargins: 0.68, operatingMargins: 0.44,
                profitMargins: 0.35, revenueGrowth: 0.16, earningsGrowth: 0.20,
                heldPercentInstitutions: 0.73, shortPercentOfFloat: 0.006,
                numberOfAnalystOpinions: 45, targetMeanPrice: 480, targetLowPrice: 400, targetHighPrice: 550,
                dividendYield: 0.0072, payoutRatio: 0.25, debtToEquity: 30,
                exDividendDate: '2025-08-14', beta: 0.92,
                governance: { overall: 1, audit: 4, board: 1, compensation: 8, shareholderRights: 1 },
                recommendationTrend: { strongBuy: 20, buy: 15, hold: 8, sell: 1, strongSell: 0 }
            },
            ratios: [
                { calendarYear: '2023', priceEarningsRatio: 34, priceToBookRatio: 12, priceToSalesRatio: 11, enterpriseValueMultiple: 23, grossProfitMargin: 0.69, operatingProfitMargin: 0.45, netProfitMargin: 0.36, currentRatio: 1.8, quickRatio: 1.7, debtEquityRatio: 0.35, interestCoverage: 45 },
                { calendarYear: '2022', priceEarningsRatio: 30, priceToBookRatio: 11, priceToSalesRatio: 10, enterpriseValueMultiple: 21, grossProfitMargin: 0.68, operatingProfitMargin: 0.42, netProfitMargin: 0.37 }
            ],
            income: [
                { calendarYear: '2023', revenue: 211000, eps: 9.7 },
                { calendarYear: '2022', revenue: 198000, eps: 9.2 },
                { calendarYear: '2021', revenue: 168000, eps: 8.0 }
            ],
            cashflow: [
                { calendarYear: '2023', freeCashFlow: 59000 },
                { calendarYear: '2022', freeCashFlow: 65000 },
                { calendarYear: '2021', freeCashFlow: 56000 }
            ],
            keyMetricsTtm: [{ roicTTM: 0.29, freeCashFlowYieldTTM: 0.025, enterpriseValueOverEBITDATTM: 24.5 }],
            ratiosTtm: [{ peRatioTTM: 35.5, returnOnAssetsTTM: 0.18 }],
            estimatesFmp: [
                { date: '2025-06-30', estimatedRevenueAvg: 250000, estimatedEpsAvg: 12.1, numberAnalystsEstimatedEps: 30 }
            ],
            profileFmp: [{ sector: 'Technology', industry: 'Software', description: 'MSFT desc', website: 'https://microsoft.com' }],
            reco: [{ strongBuy: 22, buy: 14, hold: 7, sell: 1, strongSell: 0, period: '2025-01-01' }],
            insider: { data: [{ change: 1000 }, { change: -400 }] },
            peersRaw: ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META'],
            earn: { date: '2025-07-24' },
            history: { '2025-01-02': 410, '2025-01-03': 415 },
            dividends: [
                { date: '2021-03-01', amountPerShare: 0.56 }, { date: '2021-06-01', amountPerShare: 0.56 },
                { date: '2022-03-01', amountPerShare: 0.62 }, { date: '2022-06-01', amountPerShare: 0.62 },
                { date: '2023-03-01', amountPerShare: 0.68 }, { date: '2023-06-01', amountPerShare: 0.68 },
                { date: '2024-03-01', amountPerShare: 0.75 }
            ]
        });

        expect(out.symbol).toBe('MSFT');
        expect(out.identity.name).toBe('Microsoft');
        expect(out.identity.sector).toBe('Technology');
        expect(out.price.current).toBe(420.5);
        expect(out.price.changePct).toBeCloseTo((420.5 - 415) / 415 * 100, 4);

        // valorisation : forward P/E de Yahoo, moyenne 5 ans depuis FMP
        expect(out.valuation.peForward).toBe(32);
        expect(out.valuation.hist5y.pe).toBe(32);          // (34 + 30) / 2
        expect(out.valuation.evEbitda).toBe(24);

        // croissance : CAGR CA sur 2 pas (168000 -> 211000)
        expect(out.growth.revenueAnnual.map(p => p.year)).toEqual(['2021', '2022', '2023']);
        expect(out.growth.revenueCagrPct).toBeCloseTo((Math.pow(211000 / 168000, 1 / 2) - 1) * 100, 4);
        expect(out.growth.estimates[0].analysts).toBe(30);
        expect(out.growth.guidance).toBeNull();

        // sante financiere : dette/EBITDA absent -> null, D/E depuis FMP
        expect(out.health.debtToEquity).toBe(0.35);
        expect(out.health.fcfTrend).toBe('croissant');     // 56000 -> 59000

        // rentabilite : marges en unites pourcent
        expect(out.profitability.grossMargin).toBeCloseTo(68, 6);
        expect(out.profitability.roic).toBeCloseTo(29, 6);
        expect(out.profitability.marginHistory.net.map(p => p.value)).toEqual([37, 36]);

        // sentiment : consensus Finnhub prioritaire, detention instit. en pourcent
        expect(out.sentiment.consensus.strongBuy).toBe(22);
        expect(out.sentiment.institutionalOwnership).toBeCloseTo(73, 6);
        expect(out.sentiment.shortPercentOfFloat).toBeCloseTo(0.6, 6);
        expect(out.sentiment.insider.net).toBe(600);
        expect(out.sentiment.ptRevisions).toBeNull();

        // dividende : verse, 3 hausses consecutives (2021<2022<2023), 2024 exclue
        expect(out.dividend.paysDividend).toBe(true);
        expect(out.dividend.growthStreakYears).toBe(2);
        expect(out.dividend.exDate).toBe('2025-08-14');

        // risques : uniquement ce que l'API publie (beta + scores de gouvernance)
        expect(out.risks.beta).toBe(0.92);
        expect(out.risks.hasGovernance).toBe(true);
        expect(out.risks.governance.compensation).toBe(8);

        // peers : sans le ticker lui-meme, max 4
        expect(out.peersSymbols).toEqual(['AAPL', 'GOOGL', 'AMZN', 'META']);

        // 2 seules seances d'historique -> pas d'analyse technique possible
        expect(out.technical).toBeNull();
        // score global : moyenne ponderee des 5 sous-scores disponibles
        expect(out.score.subs.map(x => x.key)).toEqual(['valuation', 'growth', 'health', 'profitability', 'momentum']);
        expect(out.score.subsUsed).toBe(5);
        expect(out.score.weightCoverage).toBeCloseTo(1, 6);
        expect(out.score.global).toBeGreaterThan(0);
        expect(out.score.global).toBeLessThan(100);
        expect(['Achat', 'Conserver', 'Vente']).toContain(out.score.signal);
        // chaque sous-score porte une justification chiffree
        out.score.subs.forEach(x => expect(x.note.length).toBeGreaterThan(0));
        expect(out.meta.errors).toEqual([]);
    });

    it('donnees manquantes -> null partout, aucun NaN, pas d exception', () => {
        const out = S._normalize({
            symbol: 'XYZ', nonUS: true, errors: ['fmp:ratios'],
            fund: null, qs: null, ratios: { unavailable: true }, income: { unavailable: true },
            cashflow: null, keyMetricsTtm: null, ratiosTtm: null, estimatesFmp: null,
            profileFmp: null, reco: null, insider: null, peersRaw: null, earn: null,
            history: null, dividends: null
        });
        expect(out.valuation.peTTM).toBeNull();
        expect(out.valuation.hist5y.pe).toBeNull();
        expect(out.growth.revenueAnnual).toEqual([]);
        expect(out.profitability.roe).toBeNull();
        expect(out.sentiment.consensus).toBeNull();
        expect(out.dividend.paysDividend).toBe(false);
        expect(out.dividend.exDate).toBeNull();
        // aucune donnee de risque publiee -> sous-section laissee de cote au rendu
        expect(out.risks.beta).toBeNull();
        expect(out.risks.hasGovernance).toBe(false);
        expect(out.peersSymbols).toEqual([]);
        expect(out.meta.fmpUnavailable).toBe(true);
        expect(JSON.stringify(out)).not.toContain('NaN');
    });
});

// ---------------------------------------------------------------------------
// Bugs remontes par l'audit des calculs financiers
// ---------------------------------------------------------------------------

describe('PortfolioService.computeProfitAsOf : devise du prix de repli', () => {
    it('une position en euros n est pas convertie deux fois', () => {
        const svc = new PortfolioService();
        svc.portfolios = [{ id: 'p1', name: 'A' }];
        svc.activePortfolioId = 'GLOBAL';
        svc.fxRate = 1.08;
        svc.fxRates = { EUR: 1.08 };
        svc.trades = [
            { id: 'b1', portfolioId: 'p1', type: 'BUY', symbol: 'AIR.PA', qty: 10, price: 100, amount: 1000, fees: 0, date: '2026-01-02' }
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

describe('AnalysisUtils.avgPositive : moyennes de multiples', () => {
    const { AnalysisUtils: U } = app;

    it('ecarte les exercices ou le multiple n a pas de sens', () => {
        // Un exercice deficitaire (PER negatif) ecrasait la reference historique.
        expect(U.avg([-50, 25, 28, 30, 26, 27])).toBeCloseTo(14.333, 3);
        expect(U.avgPositive([-50, 25, 28, 30, 26, 27])).toBeCloseTo(27.2, 3);
        expect(U.avgPositive([0, 20, 30])).toBe(25);
        expect(U.avgPositive([-5, -8])).toBeNull();
        expect(U.avgPositive([])).toBeNull();
    });

    it('_normalize : la moyenne historique ignore l exercice deficitaire', () => {
        const { AnalysisService: S } = app;
        const out = S._normalize({
            symbol: 'X', nonUS: false, errors: [], fund: {}, qs: {},
            ratios: [
                { calendarYear: '2022', priceEarningsRatio: -50, enterpriseValueMultiple: -12 },
                { calendarYear: '2023', priceEarningsRatio: 25, enterpriseValueMultiple: 20 },
                { calendarYear: '2024', priceEarningsRatio: 29, enterpriseValueMultiple: 22 }
            ],
            income: [], cashflow: [], keyMetricsTtm: {}, ratiosTtm: {},
            estimatesFmp: [], profileFmp: {}, reco: [], insider: {}, peersRaw: [],
            earn: null, history: {}, dividends: []
        });
        expect(out.valuation.hist5y.pe).toBe(27);          // (25 + 29) / 2, pas 1,33
        expect(out.valuation.hist5y.evEbitda).toBe(21);
    });
});

describe('series de cours simulees (repli sans historique reel)', () => {
    const { AnalysisService: S, APIService: A } = app;

    const serie = (n) => {
        const h = {};
        for (let i = 0; i < n; i++) {
            const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
            h[d] = 100 + Math.sin(i / 5) * 10;
        }
        return h;
    };

    it('le marqueur reste invisible pour les consommateurs de la serie', () => {
        const h = A.markSyntheticHistory(serie(3));
        expect(Object.keys(h)).toHaveLength(3);            // aucune cle parasite
        expect(JSON.parse(JSON.stringify(h))).toEqual({ ...h });
        expect(A.isSyntheticHistory(h)).toBe(true);
        expect(A.isSyntheticHistory(serie(3))).toBe(false);
        expect(A.isSyntheticHistory(null)).toBe(false);
    });

    it('getDailyHistory marque la serie quand le proxy ne renvoie rien', async () => {
        // Contexte neuf : le realm partage a un stub de getDailyHistory (cf. les
        // tests du graphe), on veut ici la vraie fonction.
        const { APIService: fresh } = loadApp();
        // Le stub de fetch du contexte renvoie {} : historique vide -> repli simule.
        const h = await fresh.getDailyHistory('ZZZZ', new Date('2025-01-01'), new Date('2025-03-01'), 100, 110);
        expect(Object.keys(h).length).toBeGreaterThan(0);
        expect(fresh.isSyntheticHistory(h)).toBe(true);
        // Une reponse exploitable du proxy n'est evidemment pas marquee.
        const { APIService: ok } = loadApp({
            fetch: async () => ({ ok: true, status: 200, json: async () => ({ '2025-01-02': 10, '2025-01-03': 11 }) })
        });
        const reel = await ok.getDailyHistory('ZZZZ', new Date('2025-01-01'), new Date('2025-03-01'), 100, 110);
        expect(ok.isSyntheticHistory(reel)).toBe(false);
    });

    it('aucune analyse technique n est deduite d une serie simulee', () => {
        const reelle = serie(120);
        const vraie = S._technicalBlock(reelle, { fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80 }, {});
        expect(vraie).not.toBeNull();
        expect(vraie.rsi14).not.toBeNull();
        expect(vraie.cross === null || typeof vraie.cross === 'string').toBe(true);

        // Meme serie, marquee simulee : ni RSI, ni tendance, ni croisement date.
        const simulee = A.markSyntheticHistory(serie(120));
        expect(S._technicalBlock(simulee, {}, {})).toBeNull();
    });
});

describe('AnalysisService._dividendBlock (phase 8)', () => {
    const { AnalysisService: S } = app;

    it('agrege par annee civile et compte les hausses sur exercices complets', () => {
        const out = S._dividendBlock([
            { date: '2021-03-01', amountPerShare: 0.5 }, { date: '2021-09-01', amountPerShare: 0.5 },
            { date: '2022-03-01', amountPerShare: 0.6 }, { date: '2022-09-01', amountPerShare: 0.6 },
            { date: '2023-03-01', amountPerShare: 0.7 }, { date: '2023-09-01', amountPerShare: 0.7 },
            { date: '2024-03-01', amountPerShare: 0.75 }
        ], { yieldPct: 2.4, payoutRatio: 0.42, ratePerShare: 1.5, avgYield5y: 1.9 });

        expect(out.paysDividend).toBe(true);
        expect(out.avgYield5y).toBe(1.9);
        expect(out.annualPerShare.map(p => p.year)).toEqual(['2021', '2022', '2023', '2024']);
        expect(out.annualPerShare[1].value).toBeCloseTo(1.2, 10);
        // 2024 incomplete -> exclue ; 2021 < 2022 < 2023 -> 2 hausses
        expect(out.growthStreakYears).toBe(2);
        expect(out.lastPayment.date).toBe('2024-03-01');
    });

    it('valeur sans dividende : rien a afficher, aucun NaN', () => {
        const out = S._dividendBlock([], { yieldPct: null, payoutRatio: null, ratePerShare: null });
        expect(out.paysDividend).toBe(false);
        expect(out.growthStreakYears).toBe(0);
        expect(out.avgYield5y).toBeNull();
        expect(out.annualPerShare).toEqual([]);
        expect(out.lastPayment).toBeNull();
        expect(JSON.stringify(out)).not.toContain('NaN');
    });
});

describe('AnalysisService : analyse technique (phase 7)', () => {
    const { AnalysisService: S } = app;

    it('_sma : moyenne mobile simple, null pendant la periode de chauffe', () => {
        const out = S._sma([1, 2, 3, 4, 5], 3);
        expect(out[0]).toBeNull();
        expect(out[1]).toBeNull();
        expect(out[2]).toBeCloseTo(2, 10);
        expect(out[4]).toBeCloseTo(4, 10);
    });

    it('_rsi : 100 quand la serie ne fait que monter, null si trop courte', () => {
        const up = Array.from({ length: 30 }, (_, i) => 100 + i);
        expect(S._rsi(up, 14)).toBe(100);
        const down = Array.from({ length: 30 }, (_, i) => 200 - i);
        expect(S._rsi(down, 14)).toBeCloseTo(0, 6);
        expect(S._rsi([1, 2, 3], 14)).toBeNull();
    });

    it('_technicalBlock : MM, RSI, position 52 semaines et ratio de volume', () => {
        // 300 seances lineairement haussieres : 100 -> 399
        const history = {};
        const start = new Date('2024-01-01T00:00:00Z');
        for (let i = 0; i < 300; i++) {
            const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
            history[d] = 100 + i;
        }
        const t = S._technicalBlock(history,
            { fiftyTwoWeekHigh: 399, fiftyTwoWeekLow: 100, volume: null },
            { regularMarketVolume: 12e6, averageVolume: 8e6 });

        expect(t.points).toBe(300);
        expect(t.lastClose).toBe(399);
        expect(t.ma50).toBeCloseTo(374.5, 6);     // moyenne de 350..399
        expect(t.ma200).toBeCloseTo(299.5, 6);    // moyenne de 200..399
        expect(t.trend).toBe('haussière');
        expect(t.cross).toBeNull();               // aucun croisement sur une serie monotone
        expect(t.rsi14).toBe(100);
        expect(t.rsiZone).toBe('surachat');
        expect(t.rangePosition52).toBeCloseTo(100, 6);
        expect(t.pctFromHigh52).toBeCloseTo(0, 6);
        expect(t.volumeRatio).toBeCloseTo(1.5, 6);
        expect(t.maSeries.dates.length).toBe(300);
        expect(JSON.stringify(t)).not.toContain('NaN');
    });

    it('_technicalBlock : detecte un golden cross apres un retournement', () => {
        // 260 seances en baisse puis 120 en hausse : la MM50 repasse au-dessus de la MM200
        const history = {};
        const start = new Date('2023-01-01T00:00:00Z');
        const vals = [];
        for (let i = 0; i < 260; i++) vals.push(400 - i);
        for (let i = 0; i < 120; i++) vals.push(140 + i * 3);
        vals.forEach((v, i) => {
            history[new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10)] = v;
        });
        const t = S._technicalBlock(history, {}, {});
        expect(t.cross).toBe('golden');
        expect(t.crossDaysAgo).toBeGreaterThan(0);
        expect(t.crossDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('_technicalBlock : historique trop court -> null (pas de NaN)', () => {
        expect(S._technicalBlock({ '2025-01-02': 10, '2025-01-03': 11 }, {}, {})).toBeNull();
        expect(S._technicalBlock(null, {}, {})).toBeNull();
    });
});

describe('bug corrige : dates NaN dans le flux actualites', () => {
    const { Utils } = app;
    it('formatDateDisplay renvoie "" pour une date non parseable', () => {
        expect(Utils.formatDateDisplay('Tue, 26 Au')).toBe('');
        expect(Utils.formatDateDisplay('pas une date')).toBe('');
    });
    it('formatDateDisplay accepte un format RFC-2822 complet (Tavily)', () => {
        expect(Utils.formatDateDisplay('Tue, 26 Aug 2025 00:00:00 GMT')).toBe('26/08/2025');
    });
});

describe('AnalysisService : comparaison sectorielle (phase 10)', () => {
    const { AnalysisService: S } = app;

    it('_peerMedians ignore les valeurs absentes metrique par metrique', () => {
        const med = S._peerMedians([
            { peTTM: 10, roe: 20, netMargin: null },
            { peTTM: 20, roe: null, netMargin: 5 },
            { peTTM: 30, roe: 40, netMargin: 15 }
        ]);
        expect(med.peTTM).toBe(20);          // impair -> valeur centrale
        expect(med.roe).toBe(30);            // pair sur 2 valeurs -> moyenne
        expect(med.netMargin).toBe(10);
        expect(med.marketCap).toBeNull();    // aucune valeur -> null, pas NaN
    });

    it('_peerRow normalise un quoteSummary en pourcentages', () => {
        const r = S._peerRow('MSFT', {
            name: 'Microsoft', marketCap: 3.1e12, peTrailing: 35,
            profitMargins: 0.36, revenueGrowth: 0.16, returnOnEquity: 0.39
        });
        expect(r).toMatchObject({ symbol: 'MSFT', name: 'Microsoft', peTTM: 35 });
        expect(r.netMargin).toBeCloseTo(36, 6);
        expect(r.revenueGrowth).toBeCloseTo(16, 6);
        expect(r.roe).toBeCloseTo(39, 6);
    });

    it('buildPeers : la valeur analysee sert de reference et ne declenche aucune requete', async () => {
        const calls = [];
        const orig = app.APIService.getQuoteSummary;
        app.APIService.getQuoteSummary = (s) => {
            calls.push(s);
            return Promise.resolve({ name: s, marketCap: 1e11, peTrailing: 20, profitMargins: 0.1, revenueGrowth: 0.05, returnOnEquity: 0.15 });
        };
        S._peersCache = {};

        const out = await S.buildPeers({
            symbol: 'AAPL',
            identity: { name: 'Apple Inc' },
            price: { marketCap: 3e12 },
            valuation: { peTTM: 31.2 },
            profitability: { netMargin: 25.3, roe: 150.2 },
            growth: { revenueGrowthYoyPct: 8 },
            peersSymbols: ['MSFT', 'GOOGL']
        });

        expect(calls).toEqual(['MSFT', 'GOOGL']);   // aucun appel pour AAPL
        expect(out.self).toMatchObject({ symbol: 'AAPL', peTTM: 31.2, roe: 150.2, isSelf: true });
        expect(out.peers.map(p => p.symbol)).toEqual(['MSFT', 'GOOGL']);
        expect(out.median.peTTM).toBe(20);          // 20, 20, 31.2
        expect(JSON.stringify(out)).not.toContain('NaN');

        // deuxieme appel : servi par le cache 15 min, aucune requete de plus
        await S.buildPeers({ symbol: 'AAPL', peersSymbols: ['MSFT', 'GOOGL'] });
        expect(calls).toEqual(['MSFT', 'GOOGL']);

        app.APIService.getQuoteSummary = orig;
    });

    it('buildPeers : sans comparables, renvoie une liste vide sans exception', async () => {
        S._peersCache = {};
        const out = await S.buildPeers({ symbol: 'XYZ.PA', peersSymbols: [] });
        expect(out.peers).toEqual([]);
        expect(out.self.symbol).toBe('XYZ.PA');
    });
});

describe('AnalysisService : score global (phase 11)', () => {
    const { AnalysisService: S } = app;

    it('_scoreLinear interpole et borne, dans les deux sens', () => {
        expect(S._scoreLinear(10, 0, 20)).toBe(50);
        expect(S._scoreLinear(-5, 0, 20)).toBe(0);      // borne basse
        expect(S._scoreLinear(50, 0, 20)).toBe(100);    // borne haute
        // sens inverse (PER : plus bas vaut mieux)
        expect(S._scoreLinear(10, 45, 10)).toBe(100);
        expect(S._scoreLinear(45, 45, 10)).toBe(0);
        expect(S._scoreLinear(null, 0, 20)).toBeNull();
        expect(S._scoreLinear(NaN, 0, 20)).toBeNull();
    });

    it('_scoreCriteria ignore les criteres absents et justifie avec des chiffres', () => {
        const out = S._scoreCriteria([
            { score: 90, note: 'ROE de 40,0 %' },
            { score: 20, note: 'PER de 44,0 ×' },
            { score: null, note: null }
        ]);
        expect(out.value).toBe(55);          // (90 + 20) / 2, le critere absent est ignore
        expect(out.used).toBe(2);
        expect(out.total).toBe(3);
        expect(out.note).toBe('ROE de 40,0 % ; PER de 44,0 ×');
    });

    it('sous-score sans aucune donnee -> null et message explicite', () => {
        const out = S._scoreCriteria([{ score: null, note: null }, { score: null, note: null }]);
        expect(out.value).toBeNull();
        expect(out.note).toContain('Données insuffisantes');
    });

    it('_scoreBlock : ponderation renormalisee sur les dimensions disponibles', () => {
        // seules valorisation et rentabilite sont notables ici
        const out = S._scoreBlock({
            valuation: { peTTM: 10, peg: 1, evEbitda: 8, fcfYield: 8, hist5y: { pe: 20 } },
            growth: {}, health: {}, sentiment: {}, technical: {},
            profitability: { roe: 30, roic: 20, netMargin: 25, operatingMargin: 30 },
            price: {}
        });
        expect(out.subsUsed).toBe(2);
        expect(out.weightCoverage).toBeCloseTo(S.SCORE_WEIGHTS.valuation + S.SCORE_WEIGHTS.profitability, 6);
        expect(out.global).toBe(100);        // tous les criteres au maximum
        expect(out.signal).toBe('Achat');
        expect(out.subs.find(s => s.key === 'growth').value).toBeNull();
    });

    it('_scoreBlock : signal Vente sur des fondamentaux degrades', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 60, peg: 4, evEbitda: 30, fcfYield: -2, hist5y: { pe: 20 } },
            growth: { revenueGrowthYoyPct: -8, revenueCagrPct: -5, epsCagrPct: -10 },
            health: { netDebtToEbitda: 6, debtToEquity: 3, currentRatio: 0.5, interestCoverage: 1, fcfTrend: 'décroissant' },
            profitability: { roe: 1, roic: 1, netMargin: 0.5, operatingMargin: 1 },
            sentiment: { recommendationMean: 4.5, targetMean: 80 },
            technical: { trend: 'baissière', rsi14: 25, rsiZone: 'survente' },
            price: { current: 100 }
        });
        expect(out.global).toBeLessThan(S.SIGNAL_THRESHOLDS.hold);
        expect(out.signal).toBe('Vente');
        expect(JSON.stringify(out)).not.toContain('NaN');
    });

    // Bug corrige : sur un critere note en sens inverse (`lo` > `hi`), une valeur
    // negative sortait du segment par le haut et etait clampee a 100/100. Une
    // societe en perte decrochait ainsi la note maximale en valorisation.
    it('_scoreLinearPositive : un multiple negatif vaut 0, pas 100', () => {
        expect(S._scoreLinear(-12, 45, 10)).toBe(100);          // comportement brut, d'ou la garde
        expect(S._scoreLinearPositive(-12, 45, 10)).toBe(0);    // PER negatif = perte
        expect(S._scoreLinearPositive(0, 45, 10)).toBe(0);
        expect(S._scoreLinearPositive(10, 45, 10)).toBe(100);   // cas normal inchange
        expect(S._scoreLinearPositive(45, 45, 10)).toBe(0);
        expect(S._scoreLinearPositive(null, 45, 10)).toBeNull();
        expect(S._scoreLinearPositive(NaN, 45, 10)).toBeNull();
    });

    it('_scoreBlock : societe en perte -> valorisation basse, pas maximale', () => {
        const out = S._scoreBlock({
            // PER, PEG et VE/EBITDA negatifs : perte nette ET EBITDA negatif.
            valuation: { peTTM: -12, peg: -2, evEbitda: -8, fcfYield: -3, hist5y: { pe: 20 } },
            growth: { revenueGrowthYoyPct: 30, revenueCagrPct: 25, epsCagrPct: 30 },
            health: { netDebtToEbitda: -3, debtToEquity: 0.4, currentRatio: 2, interestCoverage: 12, fcfTrend: 'stable' },
            profitability: { roe: -10, roic: -8, netMargin: -15, operatingMargin: -12 },
            sentiment: {}, technical: {}, price: { current: 100 }
        });
        const val = out.subs.find(s => s.key === 'valuation');
        expect(val.value).toBe(0);
        expect(val.note).toContain('bénéfice négatif');
        // Le PER negatif rend la comparaison a l'historique ininterpretable :
        // le critere est ecarte au lieu d'etre note a l'envers.
        expect(val.used).toBe(4);
        // Dette nette / EBITDA : sans EBITDA positif le ratio ne veut rien dire,
        // il ne doit pas passer pour une tresorerie nette confortable.
        const hlt = out.subs.find(s => s.key === 'health');
        expect(hlt.used).toBe(4);          // 5 criteres moins la dette nette / EBITDA
        expect(hlt.note).not.toContain("l'EBITDA");
        expect(out.signal).not.toBe('Achat');
    });

    it('_scoreBlock : un VE/EBITDA negatif est signale et note 0', () => {
        const out = S._scoreBlock({
            valuation: { evEbitda: -8 },
            growth: {}, health: {}, sentiment: {}, technical: {},
            profitability: { roe: 25 }, price: {}
        });
        const val = out.subs.find(s => s.key === 'valuation');
        expect(val.value).toBe(0);
        expect(val.note).toContain('EBITDA négatif');
    });

    it('_scoreBlock : tresorerie nette et zero dette restent des points forts', () => {
        const out = S._scoreBlock({
            // EBITDA positif : la dette nette negative est bien une tresorerie nette.
            valuation: { peTTM: 15, evEbitda: 10 },
            growth: {}, sentiment: {}, technical: {},
            health: { netDebtToEbitda: -1.5, debtToEquity: 0, currentRatio: 3, interestCoverage: 40, fcfTrend: 'croissant' },
            profitability: { roe: 25 }, price: {}
        });
        const hlt = out.subs.find(s => s.key === 'health');
        expect(hlt.value).toBe(100);
        expect(hlt.used).toBe(5);
    });

    it('_scoreBlock : fonds propres negatifs notes 0 sur la dette', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 15, evEbitda: 10 },
            growth: {}, sentiment: {}, technical: {},
            health: { debtToEquity: -1.8, currentRatio: 2, interestCoverage: 12, fcfTrend: 'stable' },
            profitability: { roe: 25 }, price: {}
        });
        const hlt = out.subs.find(s => s.key === 'health');
        expect(hlt.note).toContain('fonds propres négatifs');
        expect(hlt.value).toBeLessThan(100);
    });

    // Bug corrige : une perte divisee par des fonds propres negatifs ressort en
    // ROE positif et enorme, note 100/100 sur une societe qui detruit du capital.
    it('_scoreBlock : ROE ininterpretable sur fonds propres negatifs', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 15, evEbitda: 10, pb: -3.2 },   // P/B negatif = actif net negatif
            growth: {}, sentiment: {}, technical: {},
            health: { debtToEquity: -1.8, currentRatio: 2, interestCoverage: 12, fcfTrend: 'stable' },
            profitability: { roe: 180, roa: -6, netMargin: -15, operatingMargin: -12 },
            price: {}
        });
        const prof = out.subs.find(s => s.key === 'profitability');
        expect(prof.note).not.toContain('ROE');
        expect(prof.used).toBe(2);           // seules les deux marges sont notees
        expect(prof.value).toBe(0);          // marges negatives : rentabilite nulle
        expect(out.signal).not.toBe('Achat');
    });

    // Detection sans P/B ni dette / fonds propres : un ROE positif ne peut pas
    // coexister avec une marge nette negative.
    it('_scoreBlock : ROE positif et marge nette negative -> incoherence detectee', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 15, evEbitda: 10 },
            growth: {}, health: {}, sentiment: {}, technical: {},
            profitability: { roe: 95, roic: 40, netMargin: -8 },
            price: {}
        });
        const prof = out.subs.find(s => s.key === 'profitability');
        expect(prof.used).toBe(1);           // ROE et ROIC ecartes, reste la marge nette
        expect(prof.value).toBe(0);
    });

    it('_profitabilityFlags : une rentabilite saine reste notee normalement', () => {
        const flags = S._profitabilityFlags({
            valuation: { pb: 8 }, health: { debtToEquity: 1.2 },
            profitability: { roe: 35, roic: 22, netMargin: 25 }
        });
        expect(flags.negativeEquity).toBe(false);
        expect(flags.roeReliable).toBe(true);
        expect(flags.roicReliable).toBe(true);
        // Fonds propres negatifs mais societe profitable (rachats d'actions) :
        // le ROE reste ecarte, ce n'est ni un bon ni un mauvais signal.
        const buyback = S._profitabilityFlags({
            valuation: { pb: -12 }, health: {},
            profitability: { roe: 240, roic: 25, netMargin: 22 }
        });
        expect(buyback.roeReliable).toBe(false);
        expect(buyback.roicReliable).toBe(true);   // capital investi toujours positif
    });

    it('_scoreBlock : moins de 2 dimensions notables -> pas de score global', () => {
        const out = S._scoreBlock({
            valuation: {}, growth: {}, health: {}, sentiment: {}, technical: {},
            profitability: { roe: 20 }, price: {}
        });
        expect(out.subsUsed).toBe(1);
        expect(out.global).toBeNull();
        expect(out.signal).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Phase 13 — donnees envoyees au modele pour l'analyse redigee
// ---------------------------------------------------------------------------

describe('AnalysisService.buildAiPayload (phase 13)', () => {
    const { AnalysisService: S } = app;

    const richAnalysis = () => ({
        symbol: 'AAPL',
        asOf: '2026-08-31',
        identity: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', country: 'US', currency: 'USD' },
        price: { current: 200, changePct: 1.234567, marketCap: 3.1e12 },
        valuation: { peTTM: 30.123, peForward: 27, peg: 2.4, pb: 45, ps: 8, evEbitda: 22, fcfYield: 3.4, hist5y: { pe: 26 } },
        growth: { revenueGrowthYoyPct: 6.2, epsGrowthYoyPct: 9.1, revenueCagrPct: 8, epsCagrPct: 12 },
        health: { netDebtToEbitda: 0.4, debtToEquity: 1.5, currentRatio: 0.95, quickRatio: 0.8, interestCoverage: 30, fcfTrend: 'croissant' },
        profitability: { roe: 145, roa: 22, roic: 40, grossMargin: 46, operatingMargin: 31, netMargin: 25 },
        sentiment: { recommendationMean: 2.1, analystCount: 40, targetMean: 240, institutionalOwnership: 62, shortPercentOfFloat: 0.8 },
        technical: { trend: 'haussière', rsi14: 55.6, rsiZone: 'neutre', rangePosition52: 72 },
        dividend: { paysDividend: true, yieldPct: 0.5, avgYield5y: 0.7, payoutRatio: 0.15, growthStreakYears: 3 },
        risks: { beta: 1.2 },
        score: {
            global: 61.7, signal: 'Conserver',
            subs: [
                { key: 'valuation', label: 'Valorisation', weight: 0.25, value: 38.4, note: 'PER de 30,1 ×', used: 5, total: 5 },
                { key: 'growth', label: 'Croissance', weight: 0.2, value: null, note: 'Données insuffisantes pour noter cette dimension.', used: 0, total: 3 }
            ]
        }
    });

    it('un ROE fausse par des fonds propres negatifs est envoye comme non significatif', () => {
        const a = richAnalysis();
        a.valuation.pb = -12;              // actif net negatif
        a.profitability.roe = 240;
        const out = S.buildAiPayload(a, []);
        // Ni le chiffre trompeur, ni un simple trou dans les donnees : le modele
        // recoit la raison, pour pouvoir la citer comme limite de l'analyse.
        expect(out.metriques.rentabilite['ROE (%)']).toBe('non significatif (fonds propres négatifs)');
        expect(out.nonDisponible).not.toContain('ROE (%)');
        // Le capital investi reste positif ici : le ROIC n'est pas touche.
        expect(out.metriques.rentabilite['ROIC (%)']).toBe(40);
    });

    it('reprend identite, score, sous-scores et metriques arrondies', () => {
        const p = S.buildAiPayload(richAnalysis(), []);
        expect(p.symbol).toBe('AAPL');
        expect(p.nom).toBe('Apple Inc.');
        expect(p.secteur).toBe('Technology');
        expect(p.scoreGlobal).toBe(62);                       // arrondi, comme a l'ecran
        expect(p.signal).toBe('Conserver');
        expect(p.variationJourPct).toBe(1.23);                // 2 decimales max
        expect(p.metriques.valorisation['PER (12 derniers mois)']).toBe(30.12);
        expect(p.metriques.valorisation["PER moyen sur l'historique disponible"]).toBe(26);
        expect(p.metriques.rentabilite['ROE (%)']).toBe(145);
        expect(p.sousScores[0]).toMatchObject({
            dimension: 'Valorisation', score: 38, criteresDisponibles: '5 sur 5'
        });
        expect(p.sousScores[1].score).toBeNull();
        expect(p.seuilsSignal).toContain(String(S.SIGNAL_THRESHOLDS.buy));
    });

    it('transmet le poids reellement applique, pas le poids nominal', () => {
        // Une seule dimension notee sur cinq : elle porte 100 % du score global,
        // pas ses 25 % nominaux (les poids sont renormalises par _scoreBlock).
        const a = richAnalysis();
        a.score.subs = [
            { key: 'valuation', label: 'Valorisation', weight: 0.25, value: 38.4, note: 'PER de 30,1 ×', used: 5, total: 5 },
            { key: 'growth', label: 'Croissance', weight: 0.20, value: null, note: '—', used: 0, total: 3 }
        ];
        a.score.weightCoverage = 0.25;
        const p = S.buildAiPayload(a, []);

        expect(p.sousScores[0].poidsDansLeScorePct).toBe(100);
        expect(p.sousScores[1].poidsDansLeScorePct).toBeNull();
    });

    it('objectif de cours nul ou negatif : ni objectif ni ecart transmis', () => {
        const a = richAnalysis();
        a.sentiment.targetMean = 0;
        const p = S.buildAiPayload(a, []);

        expect(p.metriques.sentimentTechnique).not.toHaveProperty('Objectif de cours moyen');
        expect(p.nonDisponible).toContain('Objectif de cours moyen');
        expect(p.nonDisponible).toContain('Écart entre objectif moyen et cours actuel (%)');
    });

    it('liste explicitement les metriques absentes au lieu de les omettre en silence', () => {
        const a = richAnalysis();
        a.valuation.peg = null;
        a.profitability.roic = null;
        a.technical.rsi14 = null;
        const p = S.buildAiPayload(a, []);

        expect(p.nonDisponible).toContain('PEG');
        expect(p.nonDisponible).toContain('ROIC (%)');
        expect(p.nonDisponible).toContain('RSI 14 jours');
        // une metrique absente ne doit pas apparaitre aussi dans les valeurs
        expect(p.metriques.valorisation).not.toHaveProperty('PEG');
        expect(p.metriques.rentabilite).not.toHaveProperty('ROIC (%)');
    });

    it('ne transmet que les titres d actualite, jamais le contenu des pages', () => {
        const news = [
            { title: 'Résultats trimestriels', source: 'lesechos.fr', date: '2026-08-20', content: 'texte scrappé' },
            { title: '', source: 'x.fr' }
        ];
        const p = S.buildAiPayload(richAnalysis(), news);
        expect(p.actualitesRecentes).toEqual([
            { titre: 'Résultats trimestriels', source: 'lesechos.fr', date: '2026-08-20' }
        ]);
        expect(JSON.stringify(p)).not.toContain('texte scrappé');
    });

    it('valeur pauvre en donnees : payload exploitable, aucun NaN, limites listees', () => {
        const p = S.buildAiPayload({
            symbol: 'XYZ.PA', asOf: '2026-08-31',
            identity: { name: 'Petite Valeur' },
            price: { current: 12 },
            valuation: {}, growth: {}, health: {}, profitability: { roe: 8 },
            sentiment: {}, technical: {}, dividend: {}, risks: {},
            score: { global: null, signal: null, subs: [] }
        }, []);

        expect(p.scoreGlobal).toBeNull();
        expect(p.nonDisponible.length).toBeGreaterThan(20);
        expect(p.metriques.rentabilite['ROE (%)']).toBe(8);
        expect(JSON.stringify(p)).not.toContain('NaN');
        // borne de taille du payload cote worker (24 000 caracteres)
        expect(JSON.stringify(p).length).toBeLessThan(24000);
    });

    it('valeur sans dividende : rien n est presente comme une metrique manquante', () => {
        const a = richAnalysis();
        a.dividend = { paysDividend: false, yieldPct: null, avgYield5y: null, payoutRatio: null };
        const p = S.buildAiPayload(a, []);

        expect(p.verseUnDividende).toBe(false);
        expect(p.nonDisponible.some(l => /dividende|distribution/i.test(l))).toBe(false);
        expect(p.metriques.dividende).toEqual({});
    });

    it('valeur distributrice : un dividende reellement absent reste signale', () => {
        const a = richAnalysis();
        a.dividend.avgYield5y = null;
        const p = S.buildAiPayload(a, []);

        expect(p.verseUnDividende).toBe(true);
        expect(p.nonDisponible).toContain('Rendement moyen sur 5 ans (%)');
    });

    it('renvoie null sans analyse', () => {
        expect(S.buildAiPayload(null)).toBeNull();
    });
});
