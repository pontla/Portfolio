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

function supabaseStub() {
    const chain = {
        from() { return chain; },
        select() { return chain; },
        insert() { return chain; },
        update() { return chain; },
        delete() { return chain; },
        eq() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        single() { return Promise.resolve({ data: null, error: null }); },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return { from() { return chain; }, auth: { getSession: async () => ({ data: { session: null } }) } };
}

function loadApp() {
    const store = new Map();
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
    };

    const win = {
        supabase: { createClient: () => supabaseStub() },
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
        fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
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
        '\n;globalThis.__APP__ = { CONFIG, AI_PROVIDERS, AuthService, Utils, APIService, PortfolioService, App, jwtIssuedAt, isJwtTimingError };\n';
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
