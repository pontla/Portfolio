/**
 * Formatage, moteur de dates, classification des symboles, CSV. Aucune
 * dependance au DOM : importable tel quel sous Node.
 */

import { CONFIG } from './config.js';
import { storage } from './platform.js';

// --- ROBUST UTILITIES & DATE ENGINE ---
export const Utils = {
    // Echappement pur, sans DOM : le resultat est destine a du contenu textuel
    // injecte via innerHTML. Les guillemets sont echappes aussi, pour que le
    // helper reste sur en contexte d'attribut si un appel s'y risque un jour.
    /** @param {unknown} str */
    escapeHtml: (str) => String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),

    PORTFOLIO_ICONS: ['wallet', 'banknote', 'landmark', 'briefcase', 'bitcoin', 'shield', 'house', 'piggy-bank', 'coins', 'globe', 'cpu', 'trending-up', 'gem', 'rocket'],

    autoPortfolioIcon: (name) => {
        const n = (name || '').toLowerCase();
        const has = (...k) => k.some(x => n.includes(x));
        if (has('crypto', 'bitcoin', 'btc', ' eth', 'ether', 'web3')) return 'bitcoin';
        if (has('pea', 'épargne en actions', 'epargne en actions')) return 'landmark';
        if (has('assurance vie', 'assurance-vie', 'contrat')) return 'shield';
        if (has('cto', 'compte-titres', 'compte titres')) return 'briefcase';
        if (has('immo', 'immobilier', 'scpi', 'reit', 'pierre', 'foncier')) return 'house';
        if (has('retraite', ' per', 'pension')) return 'piggy-bank';
        if (has('dividende', 'rente', 'revenu', 'coupon')) return 'coins';
        if (has('livret', 'épargne', 'epargne', 'cash', 'liquidit', 'trésorerie', 'tresorerie')) return 'wallet';
        if (has('tech', 'nasdaq', 'growth', 'croissance', ' ia', 'semi-cond')) return 'cpu';
        if (has('monde', 'world', 'msci', 'etf', 'indiciel', 'passif', 'long terme')) return 'globe';
        if (has('trading', 'spécul', 'specul', 'court terme', 'swing')) return 'trending-up';
        if (has('or ', 'gold', 'métaux', 'metaux', 'précieux', 'precieux', 'luxe')) return 'gem';
        if (has('start', 'venture', 'pre-ipo', 'startup', 'moonshot', 'pari')) return 'rocket';
        if (has('salaire', 'compte courant', 'banque', 'quotidien')) return 'banknote';
        return 'wallet';
    },

    portfolioIconOverrides: () => {
        try { return JSON.parse(storage.get(CONFIG.PORTFOLIO_ICONS_STORAGE)) || {}; }
        catch (e) { return {}; }
    },

    portfolioIcon: (p) => {
        if (!p) return 'wallet';
        if (p.id === 'GLOBAL') return 'globe';
        return Utils.portfolioIconOverrides()[p.id] || Utils.autoPortfolioIcon(p.name);
    },

    setPortfolioIconOverride: (id, icon) => {
        const map = Utils.portfolioIconOverrides();
        if (icon) map[id] = icon; else delete map[id];
        storage.set(CONFIG.PORTFOLIO_ICONS_STORAGE, JSON.stringify(map));
    },

    parseDate: (val) => {
        if (!val) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        }
        if (val instanceof Date) {
            const d = new Date(val);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
                const parts = trimmed.split('T')[0].split('-');
                return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
            }
            if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(trimmed)) {
                const parts = trimmed.split(' ')[0].split('/');
                return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 0, 0, 0, 0);
            }
        }
        const d = new Date(val);
        d.setHours(0, 0, 0, 0);
        return d;
    },

    /** @param {Date|string} [dateObj] */
    getDateString: (dateObj = new Date()) => {
        const d = Utils.parseDate(dateObj);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    formatDateDisplay: (dateStr) => {
        if (!dateStr) return '';
        const d = Utils.parseDate(dateStr);
        if (!d || isNaN(d.getTime())) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    },

    formatDateShort: (dateStr) => {
        if (!dateStr) return '';
        const d = Utils.parseDate(dateStr);
        return d.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
    },

    daysBetween: (d1, d2) => {
        const date1 = Utils.parseDate(d1);
        const date2 = Utils.parseDate(d2);
        const oneDay = 24 * 60 * 60 * 1000;
        return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
    },

    // Format FR : espace fine comme separateur de milliers, virgule decimale,
    // signe moins d'affichage U+2212. EUR : symbole suffixe (1 234,56 €). USD : symbole prefixe ($1 234,56).
    formatCurrency: (num, currency = 'USD') => {
        if (num === null || num === undefined || isNaN(num)) num = 0;
        const curr = (currency || 'USD').toUpperCase();
        const sign = num < 0 ? '−' : '';
        const body = new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Math.abs(num));
        if (curr === 'EUR') return `${sign}${body} €`;
        if (curr === 'GBP') return `${sign}£${body}`;
        if (curr === 'CAD') return `${sign}CA$${body}`;
        return `${sign}$${body}`;
    },

    formatPercent: (num, withSign = true) => {
        if (num === null || num === undefined || isNaN(num)) return '0,00 %';
        const sign = num < 0 ? '−' : (withSign && num > 0 ? '+' : '');
        const body = new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Math.abs(num));
        return sign + body + ' %';
    },

    generateID: () => '_' + Math.random().toString(36).substring(2, 11),

    // Format compact : 12,3 k / 4,56 M / 1,20 Md / 3,42 T (suffixe devise optionnel)
    formatCompact: (num, currency) => {
        if (num === null || num === undefined || isNaN(num)) return '—';
        const abs = Math.abs(num);
        const sign = num < 0 ? '−' : '';
        const units = /** @type {[number, string][]} */ ([[1e12, 'T'], [1e9, 'Md'], [1e6, 'M'], [1e3, 'k']]);
        let body;
        const hit = units.find(([v]) => abs >= v);
        if (hit) {
            body = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(abs / hit[0]) + ' ' + hit[1];
        } else {
            body = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(abs);
        }
        if (!currency) return sign + body;
        const curr = currency.toUpperCase();
        if (curr === 'EUR') return `${sign}${body} €`;
        if (curr === 'GBP') return `${sign}£${body}`;
        if (curr === 'CAD') return `${sign}CA$${body}`;
        return `${sign}$${body}`;
    },

    formatQty: (num) => {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(num);
    },

    getExchangeName: (symbol) => {
        if (!symbol) return 'US';
        if (symbol.startsWith('$')) return 'Trésorerie';
        const parts = symbol.split('.');
        if (parts.length === 1) return 'NASDAQ/NYSE';

        const suffix = parts[1];
        const map = {
            'PA': 'Euronext Paris',
            'L': 'London LSE',
            'TO': 'Toronto TSX',
            'DE': 'Xetra Allemagne',
            'MI': 'Borsa Italiana',
            'AS': 'Euronext Amsterdam',
            'BR': 'Euronext Bruxelles',
            'LS': 'Euronext Lisbonne',
            'MC': 'Bolsa de Madrid',
            'HK': 'Hong Kong HKSE',
            'KS': 'Korea KOSPI',
            'SI': 'Singapore SGX',
            'AX': 'Australie ASX',
            'NS': 'Inde NSE'
        };
        return map[suffix] || suffix;
    },

    getCurrency: (symbol) => {
        if (!symbol) return 'USD';
        if (symbol.startsWith('$')) return 'USD';
        const parts = symbol.split('.');
        if (parts.length === 1) return 'USD';
        const suffix = parts[1];
        const eurSuffixes = ['PA', 'DE', 'MI', 'AS', 'BR', 'LS', 'MC', 'NL'];
        if (eurSuffixes.includes(suffix)) return 'EUR';
        if (suffix === 'L') return 'GBP';
        if (suffix === 'TO' || suffix === 'V') return 'CAD';
        return 'USD';
    },

    getAssetClass: (symbol) => {
        if (!symbol) return 'Actions & ETF';
        const s = symbol.toUpperCase();
        if (s.startsWith('$')) return 'Trésorerie';
        if (s.endsWith('-USD') || ['BTC', 'ETH', 'SOL'].includes(s)) return 'Crypto';
        return 'Actions & ETF';
    },

    parseCSV: (text) => {
        const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
        if (lines.length === 0) return [];

        const parseLine = (line) => {
            const cells = [];
            let cur = '', inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (inQuotes) {
                    if (c === '"') {
                        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
                    } else {
                        cur += c;
                    }
                } else if (c === '"') {
                    inQuotes = true;
                } else if (c === ';') {
                    cells.push(cur);
                    cur = '';
                } else {
                    cur += c;
                }
            }
            cells.push(cur);
            return cells.map(c => c.trim());
        };

        const headers = parseLine(lines[0]).map(h => h.toLowerCase());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = parseLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => { row[h] = cells[idx] !== undefined ? cells[idx] : ''; });
            rows.push(row);
        }
        return rows;
    },

    csvCell: (val) => {
        const s = String(val === null || val === undefined ? '' : val);
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    },

    // Format FR : virgule decimale (ex: 10,5). A utiliser pour les colonnes numeriques du CSV.
    csvNumber: (val) => {
        if (val === null || val === undefined || val === '') return '';
        const n = Number(val);
        if (isNaN(n)) return '';
        return String(n).replace('.', ',');
    },

    // Parse un nombre saisi en format FR (virgule) ou US (point).
    parseCSVNumber: (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const n = parseFloat(String(val).trim().replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }
};
