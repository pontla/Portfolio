/**
 * Acces aux donnees de marche via le proxy Cloudflare Worker (voir
 * worker/proxy.js). Aucune dependance au DOM.
 */

import { CONFIG } from './config.js';
import { Utils } from './utils.js';
import { AuthService } from './auth.js';

// --- API SERVICE (proxy Cloudflare Worker -> Yahoo Finance, voir worker/proxy.js) ---
// Marque une serie de cours generee faute d'historique reel (proxy en erreur ou
// reponse vide). Symbol plutot que chaine : impossible de l'obtenir par accident
// depuis des donnees d'API.
const SYNTHETIC_HISTORY = Symbol('syntheticHistory');

export const APIService = {
    quoteCache: {},
    candleCache: {},
    cachedFxRate: null,

    async searchSymbol(query) {
        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/search?q=${encodeURIComponent(query)}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) return data;
        } catch (e) {
            console.warn('Search proxy error, repli sur liste locale', e);
        }

        const mockEntries = CONFIG.KNOWN_SYMBOLS.map((s) => ({
            displaySymbol: s,
            description: `${s} Asset`,
            type: s.includes('.PA') ? 'Common Stock' : s.includes('BTC') ? 'Crypto' : 'Stock',
        }));
        return mockEntries.filter((m) =>
            m.displaySymbol.toLowerCase().includes(query.toLowerCase())
        );
    },

    async webSearch(query) {
        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/websearch?q=${encodeURIComponent(query)}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            return data && Array.isArray(data.results) ? data.results : [];
        } catch (e) {
            console.warn('Websearch proxy error', e);
            return [];
        }
    },

    // Resume IA execute cote worker : la cle API du fournisseur n'est jamais
    // envoyee ici, seul le JWT Supabase identifie l'utilisateur.
    async aiInsights(provider, prompt, liveSearch) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(`${CONFIG.PROXY_BASE_URL}/ai/insights`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ provider, prompt, liveSearch: !!liveSearch }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `proxy HTTP ${res.status}`);
        return data.text || '';
    },

    // Analyse redigee d'une valeur : le prompt systeme et le cache vivent cote
    // worker, on ne transmet que les donnees deja calculees par l'analyse.
    async aiStockAnalysis(provider, data, force = false) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(`${CONFIG.PROXY_BASE_URL}/ai/stock-analysis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ provider, data, force: !!force }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `proxy HTTP ${res.status}`);
        return payload;
    },

    async aiKeySave(provider, key) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(`${CONFIG.PROXY_BASE_URL}/ai/key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ provider, key }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `proxy HTTP ${res.status}`);
        return data.configured || [];
    },

    async aiKeyDelete(provider) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(
            `${CONFIG.PROXY_BASE_URL}/ai/key?provider=${encodeURIComponent(provider)}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.access_token}` },
            }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `proxy HTTP ${res.status}`);
        return data.configured || [];
    },

    async getCurrentPrice(symbol) {
        if (symbol.startsWith('$')) return 1.0;

        const now = Date.now();
        if (this.quoteCache[symbol] && now - this.quoteCache[symbol].timestamp < 300000) {
            return this.quoteCache[symbol].price;
        }

        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            if (data && typeof data.price === 'number' && data.price > 0) {
                this.quoteCache[symbol] = { timestamp: now, price: data.price };
                return data.price;
            }
            throw new Error('prix invalide');
        } catch (e) {
            // Pas de cours de repli : un prix invente serait affiche comme un
            // prix reel et produirait une plus-value fausse. L'appelant traite
            // `null` comme « indisponible » et valorise la position a son cout.
            console.warn(`Quote proxy error pour ${symbol}, cours indisponible`, e);
            return null;
        }
    },

    // Taux USD par unite de devise. Contrairement aux cours, un taux de change
    // ne peut pas etre omis : sans lui aucune conversion n'est possible et tout
    // le portefeuille devient inaffichable. On garde donc une estimation de
    // dernier recours, mais on signale qu'elle en est une (cf. fxEstimated).
    FX_FALLBACK: { EUR: 1.08, GBP: 1.27, CAD: 0.73 },

    /** Devises dont le dernier taux servi n'est pas un taux live. */
    fxEstimated: /** @type {Record<string, 'perime' | 'estimation'>} */ ({}),

    /** Devises actuellement servies par un taux perime ou une estimation. */
    fxEstimatedCurrencies() {
        return Object.keys(this.fxEstimated);
    },

    async getExchangeRate(currency = 'EUR') {
        const cur = (currency || 'EUR').toUpperCase();
        if (cur === 'USD') return 1;
        const fallback = this.FX_FALLBACK[cur];
        if (fallback === undefined) return null;

        const now = Date.now();
        this.cachedFxRates = this.cachedFxRates || {};
        const cached = this.cachedFxRates[cur];
        if (cached && now - cached.timestamp < 3600000) {
            return cached.rate;
        }

        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/quote?symbol=${encodeURIComponent(cur + 'USD=X')}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            if (data && typeof data.price === 'number' && data.price > 0) {
                this.cachedFxRates[cur] = { timestamp: now, rate: data.price };
                delete this.fxEstimated[cur];
                return data.price;
            }
            throw new Error('taux invalide');
        } catch (e) {
            // Un taux live deja obtenu, meme perime, vaut mieux qu'une constante
            // de 2024 : on le reutilise sans ecraser son horodatage, pour que la
            // prochaine tentative reessaie le reseau.
            if (cached && cached.rate > 0) {
                console.warn(`FX proxy error ${cur}, dernier taux connu conserve`, e);
                this.fxEstimated[cur] = 'perime';
                return cached.rate;
            }
            console.warn(`FX proxy error ${cur}, estimation ${fallback}`, e);
            this.fxEstimated[cur] = 'estimation';
            return fallback;
        }
    },

    async getExchangeRates() {
        const currencies = Object.keys(this.FX_FALLBACK);
        const rates = /** @type {Record<string, number|null>} */ ({ USD: 1 });
        await Promise.all(
            currencies.map(async (cur) => {
                rates[cur] = await this.getExchangeRate(cur);
            })
        );
        return rates;
    },

    async getDailyHistory(symbol, startDate, endDate, anchorPriceStart, currentPriceEnd) {
        if (symbol.startsWith('$')) {
            const daily = {};
            const days = Utils.daysBetween(startDate, endDate);
            for (let i = 0; i <= days; i++) {
                const d = new Date(startDate);
                d.setDate(startDate.getDate() + i);
                daily[Utils.getDateString(d)] = 1.0;
            }
            return daily;
        }

        const cacheKey = `${symbol}_${Utils.getDateString(startDate)}_${Utils.getDateString(endDate)}`;
        if (this.candleCache[cacheKey]) {
            return this.candleCache[cacheKey];
        }

        try {
            const from = Utils.getDateString(startDate);
            const to = Utils.getDateString(endDate);
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/history?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const daily = await res.json();
            if (daily && Object.keys(daily).length > 0) {
                this.candleCache[cacheKey] = daily;
                return daily;
            }
            throw new Error('historique vide');
        } catch (e) {
            console.warn(`History proxy error pour ${symbol}, repli simulation`, e);
        }

        const daily = this.generateRealisticDailyHistory(
            symbol,
            startDate,
            endDate,
            anchorPriceStart,
            currentPriceEnd
        );
        // Marqueur non enumerable : `Object.keys` / `JSON.stringify` continuent de
        // ne voir que des couples date -> cours, mais tout consommateur peut savoir
        // que la serie est simulee. Elle reste utile pour interpoler la courbe du
        // portefeuille entre deux points reels (elle est ancree sur le prix d'achat
        // et le prix courant), jamais pour en deduire un fait de marche.
        this.markSyntheticHistory(daily);
        this.candleCache[cacheKey] = daily;
        return daily;
    },

    markSyntheticHistory(history) {
        Object.defineProperty(history, SYNTHETIC_HISTORY, { value: true, configurable: true });
        return history;
    },

    // Une serie simulee ne doit alimenter aucun indicateur presente comme observe.
    isSyntheticHistory(history) {
        return !!(history && history[SYNTHETIC_HISTORY]);
    },

    async getDividends(symbol, from, to) {
        if (symbol.startsWith('$')) return [];
        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/dividends?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const list = await res.json();
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.warn(`Dividends proxy error pour ${symbol}`, e);
            return [];
        }
    },

    async getSector(symbol) {
        if (symbol.startsWith('$')) return null;
        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/sector?symbol=${encodeURIComponent(symbol)}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            return data.sector || null;
        } catch (e) {
            console.warn(`Sector proxy error pour ${symbol}`, e);
            return null;
        }
    },

    async getEarnings(symbol) {
        if (symbol.startsWith('$')) return null;
        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/earnings?symbol=${encodeURIComponent(symbol)}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            return data && data.date ? data : null;
        } catch (e) {
            console.warn(`Earnings proxy error pour ${symbol}`, e);
            return null;
        }
    },

    _fundCache: {},
    async getFundamentals(symbol) {
        if (!symbol || symbol.startsWith('$')) return null;
        const now = Date.now();
        const cached = this._fundCache[symbol];
        if (cached && now - cached.timestamp < 900000) return cached.data;
        try {
            const res = await fetch(
                `${CONFIG.PROXY_BASE_URL}/fundamentals?symbol=${encodeURIComponent(symbol)}`
            );
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            this._fundCache[symbol] = { timestamp: now, data };
            return data;
        } catch (e) {
            console.warn(`Fundamentals proxy error pour ${symbol}`, e);
            return null;
        }
    },

    // --- Sources fondamentales etendues (phases 2-11) ---
    // Cache TTL en memoire par type de donnee : fondamentaux trimestriels = 24 h,
    // donnees "riches" Yahoo = 1 h, peers = 7 j. En cas d'echec reseau on renvoie
    // la derniere valeur connue si elle existe, sinon null (jamais d'exception).
    _ttlCache: {},
    async _getCached(bucket, key, ttlMs, path) {
        const now = Date.now();
        const store = (this._ttlCache[bucket] = this._ttlCache[bucket] || {});
        const hit = store[key];
        if (hit && now - hit.ts < ttlMs) return hit.data;
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}${path}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            store[key] = { ts: now, data };
            return data;
        } catch (e) {
            console.warn(`API ${bucket} error [${key}]`, e);
            return hit ? hit.data : null;
        }
    },

    getQuoteSummary(symbol) {
        return this._getCached(
            'quoteSummary',
            symbol,
            3600000,
            `/quoteSummary?symbol=${encodeURIComponent(symbol)}`
        );
    },
    getFmp(resource, symbol) {
        return this._getCached(
            'fmp',
            `${resource}:${symbol}`,
            86400000,
            `/fmp?resource=${encodeURIComponent(resource)}&symbol=${encodeURIComponent(symbol)}`
        );
    },
    getRecommendation(symbol) {
        return this._getCached(
            'reco',
            symbol,
            86400000,
            `/recommendation?symbol=${encodeURIComponent(symbol)}`
        );
    },
    getInsiderTransactions(symbol) {
        return this._getCached(
            'insider',
            symbol,
            86400000,
            `/insider?symbol=${encodeURIComponent(symbol)}`
        );
    },
    getPeers(symbol) {
        return this._getCached(
            'peers',
            symbol,
            604800000,
            `/peers?symbol=${encodeURIComponent(symbol)}`
        );
    },

    generateRealisticDailyHistory(symbol, startDate, endDate, startPrice, endPrice) {
        const dailyMap = {};
        const sDate = Utils.parseDate(startDate);
        const eDate = Utils.parseDate(endDate);
        const totalDays = Math.max(1, Utils.daysBetween(sDate, eDate));

        // Sans aucune ancre reelle, il n'y a rien a interpoler : renvoyer une
        // serie ancree sur un prix arbitraire reviendrait a inventer un
        // historique de marche. L'appelant traite une serie vide comme absente.
        if (!(startPrice > 0) && !(endPrice > 0)) return dailyMap;

        const p0 = startPrice > 0 ? startPrice : endPrice;
        const pT = endPrice > 0 ? endPrice : p0;

        let seed = 42;
        for (let i = 0; i < symbol.length; i++) {
            seed = (seed * 37 + symbol.charCodeAt(i)) % 100000;
        }

        const pseudoNoise = (dayIndex) => {
            const x = Math.sin(seed + dayIndex * 15.789) * 43758.5453;
            return x - Math.floor(x) - 0.49;
        };

        const totalGrowth = pT / Math.max(0.01, p0);
        const dailyDrift = Math.pow(totalGrowth, 1 / totalDays);

        let runningPrice = p0;

        for (let i = 0; i <= totalDays; i++) {
            const d = new Date(sDate);
            d.setDate(sDate.getDate() + i);
            const dStr = Utils.getDateString(d);

            if (i === 0) {
                dailyMap[dStr] = p0;
            } else if (i === totalDays) {
                dailyMap[dStr] = pT;
            } else {
                const noise = pseudoNoise(i) * 0.025;
                runningPrice = runningPrice * dailyDrift * (1 + noise);
                dailyMap[dStr] = Math.max(0.1, parseFloat(runningPrice.toFixed(2)));
            }
        }

        return dailyMap;
    },
};
