/**
 * Formatage, moteur de dates, classification des symboles, CSV, echappement.
 * Le module est importe directement : plus de realm `vm` ni de stub de DOM.
 */
import { describe, it, expect } from 'vitest';
import { Utils } from './utils.js';

// normalise les espaces insecables produits par Intl fr-FR
const sp = (s) => s.replace(/[\u00a0\u202f\u2009]/g, ' ');

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
        expect(Utils.escapeHtml('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
        expect(Utils.escapeHtml("l'a")).toBe('l&#39;a');
    });
});

// ---------------------------------------------------------------------------

describe('bug corrige : dates NaN dans le flux actualites', () => {
    it('formatDateDisplay renvoie "" pour une date non parseable', () => {
        expect(Utils.formatDateDisplay('Tue, 26 Au')).toBe('');
        expect(Utils.formatDateDisplay('pas une date')).toBe('');
    });
    it('formatDateDisplay accepte un format RFC-2822 complet (Tavily)', () => {
        expect(Utils.formatDateDisplay('Tue, 26 Aug 2025 00:00:00 GMT')).toBe('26/08/2025');
    });
});
