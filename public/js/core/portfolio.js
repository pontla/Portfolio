/**
 * Moteur de donnees et de calcul multi-portefeuilles : chargement Supabase,
 * validation des transactions, P&L realise/latent, allocations, series
 * historiques. Aucune dependance au DOM.
 */

import { CONFIG } from './config.js';
import { storage, emit } from './platform.js';
import { db } from './supabase.js';
import { Utils } from './utils.js';
import { APIService } from './api.js';
import { AuthService, isJwtTimingError, jwtIssuedAt } from './auth.js';

// Dates d'un historique quotidien, triees une fois pour toutes. Les historiques
// sont toujours remplaces en bloc (refreshPrices assigne l'objet renvoye par
// APIService.getDailyHistory) et jamais completes en place : l'identite de
// l'objet est donc une cle de cache valide, et un WeakMap libere l'entree avec
// l'historique lui-meme.
/** @type {WeakMap<object, string[]>} */
const historyDatesCache = new WeakMap();

function sortedHistoryDates(history) {
    let dates = historyDatesCache.get(history);
    if (!dates) {
        dates = Object.keys(history).sort();
        historyDatesCache.set(history, dates);
    }
    return dates;
}

// --- DATA & MULTI-PORTFOLIO ENGINE LAYER ---
export class PortfolioService {
    constructor() {
        this.portfolios = [];
        this.activePortfolioId = 'GLOBAL';
        this.trades = [];
        this.marketPrices = {};
        this.dailyPriceCache = {};
        this.fxRate = 1.08;
        this.fxRates = /** @type {Record<string, number|null>} */ ({
            USD: 1,
            EUR: 1.08,
            GBP: 1.27,
            CAD: 0.73,
        });
        this.userId = null;
        // Config IA liee au compte (table user_settings). aiProvider = fournisseur
        // choisi (non secret) ; aiConfigured = fournisseurs pour lesquels une cle
        // est stockee cote worker. Les cles elles-memes ne transitent jamais ici.
        this.aiProvider = null;
        this.aiConfigured = [];
    }

    // Charge la config IA du compte ; retombe sur le cache local (fournisseur
    // choisi uniquement) en cas d'echec (table absente, hors-ligne).
    async _loadAiConfig() {
        try {
            this.aiProvider = storage.get(CONFIG.AI_PROVIDER_STORAGE) || null;
        } catch (e) {
            /* stockage indisponible */
        }

        try {
            const { data, error } = await db()
                .from('user_settings')
                .select('ai_provider, ai_providers_configured')
                .eq('user_id', this.userId)
                .maybeSingle();
            if (error || !data) return;
            this.aiProvider = data.ai_provider || null;
            this.aiConfigured = data.ai_providers_configured || [];
            try {
                if (this.aiProvider) storage.set(CONFIG.AI_PROVIDER_STORAGE, this.aiProvider);
                else storage.remove(CONFIG.AI_PROVIDER_STORAGE);
            } catch (e) {
                /* ignore */
            }
        } catch (e) {
            /* on garde le cache local */
        }
    }

    // Change le fournisseur actif (non secret) : ecriture directe via RLS + cache.
    async setAiProvider(provider) {
        this.aiProvider = provider || null;
        try {
            if (this.aiProvider) storage.set(CONFIG.AI_PROVIDER_STORAGE, this.aiProvider);
            else storage.remove(CONFIG.AI_PROVIDER_STORAGE);
        } catch (e) {
            /* ignore */
        }
        const { error } = await db().from('user_settings').upsert(
            {
                user_id: this.userId,
                ai_provider: this.aiProvider,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        );
        if (error) throw error;
    }

    // Enregistre / supprime la cle API d'un fournisseur cote worker (chiffree).
    async saveAiKey(provider, key) {
        this.aiConfigured = await APIService.aiKeySave(provider, key);
        this.aiProvider = provider;
        try {
            storage.set(CONFIG.AI_PROVIDER_STORAGE, provider);
        } catch (e) {
            /* ignore */
        }
    }

    async removeAiKey(provider) {
        this.aiConfigured = await APIService.aiKeyDelete(provider);
    }

    async _fetchRows() {
        const [{ data: portfolioRows, error: pErr }, { data: tradeRows, error: tErr }] =
            await Promise.all([
                db().from('portfolios').select('*').order('created_at', { ascending: true }),
                db().from('trades').select('*'),
            ]);
        if (pErr) throw pErr;
        if (tErr) throw tErr;
        return { portfolioRows, tradeRows };
    }

    async load() {
        let session = await AuthService.getSession();
        if (!session) throw new Error('Pas de session active');

        // Jeton emis dans le futur (horloge de l'appareil en avance) : on force un
        // rafraichissement pour obtenir un access_token avec un iat correct.
        const iat = jwtIssuedAt(session.access_token);
        if (iat && iat * 1000 - Date.now() > 5000) {
            session = await AuthService.refreshSession().catch(() => session);
        }
        this.userId = session.user.id;

        let portfolioRows, tradeRows;
        try {
            ({ portfolioRows, tradeRows } = await this._fetchRows());
        } catch (err) {
            if (!isJwtTimingError(err)) throw err;
            // Rafraichit le jeton puis laisse le serveur rattraper l'ecart avant de reessayer.
            await AuthService.refreshSession().catch(() => {});
            await new Promise((r) => setTimeout(r, 2500));
            ({ portfolioRows, tradeRows } = await this._fetchRows());
        }

        if (portfolioRows.length === 0) {
            const created = await this.createPortfolio('Portefeuille Principal', '#3b82f6');
            this.portfolios = [created];
        } else {
            this.portfolios = portfolioRows.map((r) => ({
                id: r.id,
                name: r.name,
                color: r.color,
                createdAt: r.created_at,
            }));
        }

        this.trades = (tradeRows || []).map((r) => ({
            id: r.id,
            portfolioId: r.portfolio_id,
            type: r.type,
            symbol: r.symbol,
            qty: Number(r.qty),
            price: Number(r.price),
            amount: Number(r.amount),
            fees: Number(r.fees) || 0,
            fxRate: Number(r.fx_rate) || null,
            date: r.date,
        }));

        const storedActiveId = storage.get(CONFIG.ACTIVE_PORTFOLIO_STORAGE);
        this.activePortfolioId = storedActiveId || this.portfolios[0].id;
        if (
            this.activePortfolioId !== 'GLOBAL' &&
            !this.portfolios.find((p) => p.id === this.activePortfolioId)
        ) {
            this.activePortfolioId = this.portfolios[0].id;
        }

        await this._loadAiConfig();
    }

    async createPortfolio(name, color = '#3b82f6') {
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('Nom de portefeuille requis');
        if (this.portfolios.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
            throw new Error(`Un portefeuille nommé "${trimmed}" existe déjà`);
        }

        const { data, error } = await db()
            .from('portfolios')
            .insert({ user_id: this.userId, name: trimmed, color: color || '#3b82f6' })
            .select()
            .single();
        if (error) throw error;

        const newPort = {
            id: data.id,
            name: data.name,
            color: data.color,
            createdAt: data.created_at,
        };
        if (!this.portfolios.find((p) => p.id === newPort.id)) {
            this.portfolios.push(newPort);
        }
        this.setActivePortfolio(newPort.id);
        return newPort;
    }

    async renamePortfolio(id, newName, newColor) {
        const trimmed = (newName || '').trim();
        if (!trimmed) throw new Error('Nom de portefeuille requis');
        if (
            this.portfolios.some(
                (p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase()
            )
        ) {
            throw new Error(`Un portefeuille nommé "${trimmed}" existe déjà`);
        }

        const updates = { name: trimmed };
        if (newColor) updates.color = newColor;

        const { error } = await db().from('portfolios').update(updates).eq('id', id);
        if (error) throw error;

        const p = this.portfolios.find((x) => x.id === id);
        if (p) {
            p.name = updates.name;
            if (newColor) p.color = newColor;
        }
        emit('portfolio-updated');
    }

    async deletePortfolio(id) {
        // Refus silencieux cote moteur : c'est l'appelant (App) qui informe
        // l'utilisateur, le moteur ne touche pas a l'UI.
        if (this.portfolios.length <= 1) return false;

        const { error } = await db().from('portfolios').delete().eq('id', id);
        if (error) throw error;

        // La contrainte "on delete cascade" cote Supabase supprime deja les trades associes
        this.trades = this.trades.filter((t) => t.portfolioId !== id);
        this.portfolios = this.portfolios.filter((p) => p.id !== id);

        if (this.activePortfolioId === id) {
            this.setActivePortfolio(this.portfolios[0].id);
        } else {
            emit('portfolio-updated');
        }
        return true;
    }

    setActivePortfolio(id) {
        this.activePortfolioId = id;
        storage.set(CONFIG.ACTIVE_PORTFOLIO_STORAGE, id);
        this.refreshPrices();
    }

    getActivePortfolio() {
        if (this.activePortfolioId === 'GLOBAL') {
            return { id: 'GLOBAL', name: 'Tous les portefeuilles (Global)', color: '#4f46e5' };
        }
        return this.portfolios.find((p) => p.id === this.activePortfolioId) || this.portfolios[0];
    }

    getPortfolioById(id) {
        return this.portfolios.find((p) => p.id === id) || { name: 'Inconnu', color: '#6b7280' };
    }

    getFilteredTrades() {
        if (this.activePortfolioId === 'GLOBAL') {
            return [...this.trades];
        }
        return this.trades.filter((t) => t.portfolioId === this.activePortfolioId);
    }

    getSortedTrades() {
        return this.getFilteredTrades().sort((a, b) => {
            const dA = Utils.parseDate(a.date);
            const dB = Utils.parseDate(b.date);
            return dA.getTime() - dB.getTime();
        });
    }

    getFirstTradeDate() {
        const sorted = this.getSortedTrades();
        return sorted.length > 0 ? Utils.parseDate(sorted[0].date) : null;
    }

    async refreshPrices() {
        const uniqueSymbols = [
            ...new Set(
                this.trades.map((t) => t.symbol).filter((s) => !s.startsWith('$') && s !== '$FEE')
            ),
        ];
        this.marketPrices = {};

        await Promise.all(
            uniqueSymbols.map(async (sym) => {
                this.marketPrices[sym] = await APIService.getCurrentPrice(sym);
            })
        );

        this.fxRates = await APIService.getExchangeRates();
        this.fxRate = this.fxRates.EUR || 1.08;

        const earliestDate =
            this.getFirstTradeDate() || new Date(Date.now() - 365 * 24 * 3600 * 1000);
        const today = new Date();

        await Promise.all(
            uniqueSymbols.map(async (sym) => {
                const symTrades = this.trades
                    .filter((t) => t.symbol === sym && t.type === 'BUY')
                    .sort(
                        (a, b) =>
                            Utils.parseDate(a.date).getTime() - Utils.parseDate(b.date).getTime()
                    );
                const anchorBuyPrice =
                    symTrades.length > 0 ? symTrades[0].price : this.marketPrices[sym] || 100;
                const currentPrice = this.marketPrices[sym] || anchorBuyPrice;

                const dailyPrices = await APIService.getDailyHistory(
                    sym,
                    earliestDate,
                    today,
                    anchorBuyPrice,
                    currentPrice
                );
                this.dailyPriceCache[sym] = dailyPrices;
            })
        );

        emit('portfolio-updated');
    }

    getPriceOnDate(symbol, dateStr, fallbackPrice = 100) {
        if (symbol.startsWith('$')) return 1.0;

        // Le jour courant est souvent absent de l'historique proxy : on retombe sur le prix
        // live pour que le dernier point du graphe colle a la carte "Valeur du portefeuille".
        if (dateStr >= Utils.getDateString() && this.marketPrices[symbol] > 0) {
            return this.marketPrices[symbol];
        }

        const symPrices = this.dailyPriceCache[symbol];
        if (symPrices && symPrices[dateStr] !== undefined) {
            return symPrices[dateStr];
        }

        if (symPrices) {
            // Historique a trous (week-ends, jours feries) : on prend la derniere
            // seance connue. Les dates sont triees une seule fois par historique
            // (cf. sortedHistoryDates) et localisees par dichotomie — la version
            // precedente retriait et refiltrait toutes les dates a chaque appel,
            // soit des centaines de fois par serie quotidienne.
            const availableDates = sortedHistoryDates(symPrices);
            if (availableDates.length > 0) {
                let lo = 0;
                let hi = availableDates.length - 1;
                let found = -1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (availableDates[mid] <= dateStr) {
                        found = mid;
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                }
                return symPrices[availableDates[found === -1 ? 0 : found]];
            }
        }

        return this.marketPrices[symbol] || fallbackPrice;
    }

    normalizeTradeInput(tradeData) {
        const type = (tradeData.type || 'BUY').toUpperCase();
        let symbol = (tradeData.symbol || '').toUpperCase().trim();
        let qty = parseFloat(tradeData.qty) || 0;
        let price = parseFloat(tradeData.price) || 0;
        let amount = parseFloat(tradeData.amount) || 0;
        const fees = parseFloat(tradeData.fees) || 0;
        const normalizedDate = Utils.getDateString(tradeData.date || new Date());

        let portfolioId = tradeData.portfolioId;
        if (!portfolioId || portfolioId === 'GLOBAL') {
            portfolioId =
                this.activePortfolioId === 'GLOBAL'
                    ? this.portfolios[0]
                        ? this.portfolios[0].id
                        : null
                    : this.activePortfolioId;
        }

        if (type === 'DEPOSIT' || type === 'WITHDRAWAL') {
            symbol = '$CASH';
            amount = amount > 0 ? amount : qty * price || qty || price || 0;
            qty = amount;
            price = 1.0;
        } else if (type === 'DIVIDEND') {
            symbol = symbol || '$CASH';
            amount = amount > 0 ? amount : qty * price || price || 0;
            qty = 1;
            price = amount;
        } else if (type === 'FEE') {
            symbol = '$FEE';
            amount = amount > 0 ? amount : qty * price || price || 0;
            qty = 1;
            price = amount;
        } else {
            amount = qty * price;
        }

        // Taux de change fige a la saisie (USD pour 1 unite de la devise native du titre).
        // Reutilise une valeur fournie (ex. re-edition, import) sinon prend le spot courant.
        const nativeCurrency = Utils.getCurrency(symbol);
        let fxRate = tradeData.fxRate != null ? Number(tradeData.fxRate) : null;
        if (!(fxRate > 0)) {
            fxRate =
                nativeCurrency === 'USD'
                    ? 1
                    : (this.fxRates && this.fxRates[nativeCurrency]) || null;
        }

        return {
            type,
            symbol,
            qty,
            price,
            amount,
            fees,
            fxRate,
            date: normalizedDate,
            portfolioId,
        };
    }

    validateTrade(n, excludeTradeId) {
        const errors = [];

        if (!n.date) {
            errors.push('Date manquante');
        } else if (n.date > Utils.getDateString()) {
            errors.push('La date ne peut pas être dans le futur');
        }

        if (n.type === 'BUY' || n.type === 'SELL') {
            if (!n.symbol) errors.push('Symbole manquant');
            if (!(n.qty > 0)) errors.push('Quantité invalide (doit être > 0)');
            if (!(n.price > 0)) errors.push('Prix invalide (doit être > 0)');

            if (n.type === 'SELL' && n.symbol) {
                const held = this.trades
                    .filter(
                        (t) =>
                            t.id !== excludeTradeId &&
                            t.symbol === n.symbol &&
                            (t.type === 'BUY' || t.type === 'SELL') &&
                            t.portfolioId === n.portfolioId &&
                            t.date <= n.date
                    )
                    .reduce((q, t) => q + (t.type === 'BUY' ? t.qty : -t.qty), 0);
                if (n.qty > held + 0.0001) {
                    errors.push(
                        `Quantité vendue (${n.qty}) supérieure à la quantité détenue à cette date (${held})`
                    );
                }
            }
        } else if (['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'FEE'].includes(n.type)) {
            if (!(n.amount > 0)) errors.push('Montant invalide (doit être > 0)');
        } else {
            errors.push('Type de transaction inconnu');
        }

        if (errors.length) throw new Error(errors.join(' ; '));
    }

    async addTrade(tradeData) {
        const n = this.normalizeTradeInput(tradeData);
        this.validateTrade(n);

        const { data, error } = await db()
            .from('trades')
            .insert({
                user_id: this.userId,
                portfolio_id: n.portfolioId,
                type: n.type,
                symbol: n.symbol,
                qty: n.qty,
                price: n.price,
                amount: n.amount,
                fees: n.fees,
                fx_rate: n.fxRate,
                date: n.date,
            })
            .select()
            .single();
        if (error) throw error;

        const newTrade = {
            id: data.id,
            portfolioId: data.portfolio_id,
            type: data.type,
            symbol: data.symbol,
            qty: Number(data.qty),
            price: Number(data.price),
            amount: Number(data.amount),
            fees: Number(data.fees) || 0,
            fxRate: Number(data.fx_rate) || null,
            date: data.date,
        };

        this.trades.push(newTrade);
        this.refreshPrices();
        return newTrade;
    }

    async updateTrade(id, tradeData) {
        const n = this.normalizeTradeInput(tradeData);
        this.validateTrade(n, id);

        const { data, error } = await db()
            .from('trades')
            .update({
                portfolio_id: n.portfolioId,
                type: n.type,
                symbol: n.symbol,
                qty: n.qty,
                price: n.price,
                amount: n.amount,
                fees: n.fees,
                fx_rate: n.fxRate,
                date: n.date,
            })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;

        const updatedTrade = {
            id: data.id,
            portfolioId: data.portfolio_id,
            type: data.type,
            symbol: data.symbol,
            qty: Number(data.qty),
            price: Number(data.price),
            amount: Number(data.amount),
            fees: Number(data.fees) || 0,
            fxRate: Number(data.fx_rate) || null,
            date: data.date,
        };

        const idx = this.trades.findIndex((t) => t.id === id);
        if (idx !== -1) this.trades[idx] = updatedTrade;

        this.refreshPrices();
        return updatedTrade;
    }

    async removeTrade(id) {
        const { error } = await db().from('trades').delete().eq('id', id);
        if (error) throw error;

        this.trades = this.trades.filter((t) => t.id !== id);
        this.refreshPrices();
    }

    async addTradesBulk(tradesDataArray) {
        const rows = tradesDataArray.map((td) => {
            const n = this.normalizeTradeInput(td);
            return {
                user_id: this.userId,
                portfolio_id: n.portfolioId,
                type: n.type,
                symbol: n.symbol,
                qty: n.qty,
                price: n.price,
                amount: n.amount,
                fees: n.fees,
                fx_rate: n.fxRate,
                date: n.date,
            };
        });

        const { data, error } = await db().from('trades').insert(rows).select();
        if (error) throw error;

        const newTrades = data.map((d) => ({
            id: d.id,
            portfolioId: d.portfolio_id,
            type: d.type,
            symbol: d.symbol,
            qty: Number(d.qty),
            price: Number(d.price),
            amount: Number(d.amount),
            fees: Number(d.fees) || 0,
            fxRate: Number(d.fx_rate) || null,
            date: d.date,
        }));

        this.trades.push(...newTrades);
        this.refreshPrices();
        return newTrades.length;
    }

    exportToCSV() {
        const headers = [
            'date',
            'type',
            'symbol',
            'qty',
            'price',
            'currency',
            'fees',
            'amount',
            'portfolio',
        ];
        const lines = [headers.join(';')];

        this.trades
            .slice()
            .sort((a, b) => Utils.parseDate(a.date).getTime() - Utils.parseDate(b.date).getTime())
            .forEach((t) => {
                const port = this.getPortfolioById(t.portfolioId);
                const currency = Utils.getCurrency(t.symbol);
                lines.push(
                    [
                        t.date,
                        t.type,
                        t.symbol,
                        Utils.csvNumber(t.qty),
                        Utils.csvNumber(t.price),
                        currency,
                        Utils.csvNumber(t.fees || 0),
                        Utils.csvNumber(t.amount),
                        port.name,
                    ]
                        .map(Utils.csvCell)
                        .join(';')
                );
            });

        return lines.join('\n');
    }

    async importFromCSV(csvText) {
        const rows = Utils.parseCSV(csvText);
        if (!rows.length) return { added: 0, errors: ['Fichier CSV vide'] };

        const errors = [];
        const portfolioNameToId = {};
        this.portfolios.forEach((p) => {
            portfolioNameToId[p.name.toLowerCase()] = p.id;
        });

        for (const row of rows) {
            const pname = (row.portfolio || '').trim();
            if (pname && !portfolioNameToId[pname.toLowerCase()]) {
                const created = await this.createPortfolio(pname);
                portfolioNameToId[pname.toLowerCase()] = created.id;
            }
        }

        const defaultPortfolioId =
            this.activePortfolioId !== 'GLOBAL'
                ? this.activePortfolioId
                : this.portfolios[0] && this.portfolios[0].id;

        const tradesData = [];
        rows.forEach((row, idx) => {
            try {
                if (!row.date || !row.type) throw new Error('date/type manquant');

                const type = row.type.toUpperCase();
                const symbol = (row.symbol || '').toUpperCase().trim();
                let price = Utils.parseCSVNumber(row.price);
                let fees = Utils.parseCSVNumber(row.fees);

                if ((type === 'BUY' || type === 'SELL') && row.currency) {
                    const enteredCurrency = row.currency.toUpperCase();
                    const nativeCurrency = Utils.getCurrency(symbol);
                    if (enteredCurrency !== nativeCurrency) {
                        price = this.convertCurrency(price, enteredCurrency, nativeCurrency);
                        fees = this.convertCurrency(fees, enteredCurrency, nativeCurrency);
                    }
                }

                const pname = (row.portfolio || '').trim();
                const portfolioId = pname
                    ? portfolioNameToId[pname.toLowerCase()]
                    : defaultPortfolioId;

                const rowTrade = {
                    portfolioId,
                    type,
                    symbol,
                    qty: Utils.parseCSVNumber(row.qty),
                    price,
                    amount: Utils.parseCSVNumber(row.amount),
                    fees,
                    date: row.date,
                };

                const normalized = this.normalizeTradeInput(rowTrade);
                this.validateTrade(normalized);
                tradesData.push(rowTrade);
            } catch (e) {
                errors.push(`Ligne ${idx + 2} : ${e.message}`);
            }
        });

        if (tradesData.length === 0) return { added: 0, errors };

        const added = await this.addTradesBulk(tradesData);
        return { added, errors };
    }

    getQtyHeldOnDate(symbol, dateStr) {
        let qty = 0;
        this.trades
            .filter(
                (t) =>
                    t.symbol === symbol &&
                    t.date <= dateStr &&
                    (t.type === 'BUY' || t.type === 'SELL')
            )
            .forEach((t) => {
                qty += t.type === 'BUY' ? t.qty : -t.qty;
            });
        return qty;
    }

    async syncDividends() {
        const symbols = [
            ...new Set(this.trades.filter((t) => t.type === 'BUY').map((t) => t.symbol)),
        ];
        const existingKeys = new Set(
            this.trades.filter((t) => t.type === 'DIVIDEND').map((t) => `${t.symbol}_${t.date}`)
        );

        let added = 0;
        for (const symbol of symbols) {
            const buys = this.trades
                .filter((t) => t.symbol === symbol && t.type === 'BUY')
                .sort(
                    (a, b) => Utils.parseDate(a.date).getTime() - Utils.parseDate(b.date).getTime()
                );
            if (!buys.length) continue;

            const from = buys[0].date;
            const to = Utils.getDateString();
            const events = await APIService.getDividends(symbol, from, to);

            for (const ev of events) {
                if (existingKeys.has(`${symbol}_${ev.date}`)) continue;
                const qty = this.getQtyHeldOnDate(symbol, ev.date);
                if (qty <= 0) continue;

                await this.addTrade({
                    portfolioId: buys[0].portfolioId,
                    type: 'DIVIDEND',
                    symbol,
                    amount: qty * ev.amountPerShare,
                    date: ev.date,
                });
                existingKeys.add(`${symbol}_${ev.date}`);
                added++;
            }
        }
        return added;
    }

    convertCurrency(val, fromCurrency, targetCurrency) {
        const from = (fromCurrency || 'USD').toUpperCase();
        const target = (targetCurrency || 'USD').toUpperCase();
        if (from === target) return val;

        const rates = this.fxRates || {};
        const usdPerUnit = (cur) => {
            if (cur === 'USD') return 1;
            // EUR : this.fxRate fait foi (taux live, maj par refreshPrices ; sync avec fxRates.EUR).
            if (cur === 'EUR') return this.fxRate || rates.EUR || 1.08;
            if (rates[cur] > 0) return rates[cur];
            return null;
        };

        const fromRate = usdPerUnit(from);
        const targetRate = usdPerUnit(target);
        if (fromRate === null || targetRate === null) {
            console.warn(
                `convertCurrency: taux manquant pour ${from}->${target}, valeur non convertie`
            );
            return val;
        }
        return val * (fromRate / targetRate);
    }

    calculatePortfolio(targetCurrency = 'USD') {
        const FX = this.fxRate || 1.08;
        const sortedTrades = this.getSortedTrades();

        let displayCashUSD = 0;
        let totalDepositsUSD = 0;
        let totalWithdrawalsUSD = 0;
        let totalBuyCostUSD = 0;
        let realizedPnLUSD = 0;
        let totalDividendsUSD = 0;
        let totalFeesUSD = 0;
        let runningNetContribUSD = 0;
        let peakNetContribUSD = 0;
        const holdings = {};
        const firstTradeDate = this.getFirstTradeDate();

        sortedTrades.forEach((trade) => {
            const currency = Utils.getCurrency(trade.symbol);
            const toUSD = (val) => this.convertCurrency(val, currency, 'USD');

            switch (trade.type) {
                case 'DEPOSIT': {
                    const amtUSD = toUSD(trade.amount);
                    displayCashUSD += amtUSD;
                    totalDepositsUSD += amtUSD;
                    runningNetContribUSD += amtUSD;
                    peakNetContribUSD = Math.max(peakNetContribUSD, runningNetContribUSD);
                    break;
                }
                case 'WITHDRAWAL': {
                    const amtUSD = toUSD(trade.amount);
                    displayCashUSD -= amtUSD;
                    totalWithdrawalsUSD += amtUSD;
                    runningNetContribUSD -= amtUSD;
                    break;
                }
                case 'BUY': {
                    const feeUSD = toUSD(trade.fees || 0);
                    // Base de cout = prix des parts uniquement ; les frais sont suivis a part
                    // (totalFeesUSD) et deduits une seule fois du P&L total.
                    const sharesCostUSD = toUSD(trade.qty * trade.price);
                    displayCashUSD -= sharesCostUSD + feeUSD;
                    totalFeesUSD += feeUSD;
                    totalBuyCostUSD += sharesCostUSD + feeUSD;

                    if (!holdings[trade.symbol]) {
                        holdings[trade.symbol] = {
                            qty: 0,
                            totalCostUSD: 0,
                            avgPriceNative: 0,
                            currency,
                            portfolios: new Set(),
                        };
                    }
                    const h = holdings[trade.symbol];
                    h.qty += trade.qty;
                    h.totalCostUSD += sharesCostUSD;
                    h.avgPriceNative = this.convertCurrency(
                        h.totalCostUSD / h.qty,
                        'USD',
                        currency
                    );
                    h.portfolios.add(trade.portfolioId);
                    break;
                }
                case 'SELL': {
                    const feeUSD = toUSD(trade.fees || 0);
                    const h = holdings[trade.symbol];
                    // Clamp a la quantite reellement detenue dans ce perimetre : un SELL sans
                    // position correspondante (mauvais portefeuille, anteriorite) ne doit pas
                    // crediter de cash fantome ni de P&L realise.
                    const sellQty = Math.min(trade.qty, h ? Math.max(0, h.qty) : 0);
                    if (sellQty > 0) {
                        const grossRevenueUSD = toUSD(sellQty * trade.price);
                        displayCashUSD += grossRevenueUSD - feeUSD;
                        totalFeesUSD += feeUSD;

                        const costOfSoldUSD = (h.totalCostUSD / h.qty) * sellQty;
                        realizedPnLUSD += grossRevenueUSD - costOfSoldUSD;

                        h.qty -= sellQty;
                        h.totalCostUSD -= costOfSoldUSD;
                        if (h.qty <= 0.00001) {
                            h.qty = 0;
                            h.totalCostUSD = 0;
                        }
                    }
                    break;
                }
                case 'DIVIDEND': {
                    const divUSD = toUSD(trade.amount);
                    displayCashUSD += divUSD;
                    totalDividendsUSD += divUSD;
                    break;
                }
                case 'FEE': {
                    const feeUSD = toUSD(trade.amount);
                    totalFeesUSD += feeUSD;
                    break;
                }
            }
        });

        let holdingsTotalValueUSD = 0;
        let holdingsTotalCostUSD = 0;
        let unrealizedPnLUSD = 0;

        const holdingsList = Object.entries(holdings)
            .map(([symbol, data]) => {
                if (data.qty < 0.0001) return null;

                const currentPriceNative = this.marketPrices[symbol] || data.avgPriceNative;
                const valueNative = data.qty * currentPriceNative;
                const costNative = data.qty * data.avgPriceNative;
                const gainNative = valueNative - costNative;
                const gainPercent = costNative > 0 ? (gainNative / costNative) * 100 : 0;

                const valueUSD = this.convertCurrency(valueNative, data.currency, 'USD');
                const costUSD = this.convertCurrency(costNative, data.currency, 'USD');
                const gainUSD = valueUSD - costUSD;

                holdingsTotalValueUSD += valueUSD;
                holdingsTotalCostUSD += costUSD;
                unrealizedPnLUSD += gainUSD;

                return {
                    symbol,
                    qty: data.qty,
                    avgPrice: data.avgPriceNative,
                    currentPrice: currentPriceNative,
                    valueNative,
                    costNative,
                    gainNative,
                    gainPercent,
                    valueUSD,
                    currency: data.currency,
                    weightPercent: 0,
                    portfolios: Array.from(data.portfolios || []),
                };
            })
            .filter(Boolean);

        holdingsList.forEach((h) => {
            h.weightPercent =
                holdingsTotalValueUSD > 0 ? (h.valueUSD / holdingsTotalValueUSD) * 100 : 0;
        });

        const totalPortfolioValueUSD = displayCashUSD + holdingsTotalValueUSD;
        // Base de rendement = pic historique de capital net apporte (jamais 0/negatif meme si
        // les retraits ont depasse les depots), repli sur le cout d'achat cumule.
        const netInvestedCapitalUSD =
            peakNetContribUSD > 0 ? peakNetContribUSD : totalBuyCostUSD > 0 ? totalBuyCostUSD : 0;
        const totalPnLUSD = unrealizedPnLUSD + realizedPnLUSD + totalDividendsUSD - totalFeesUSD;
        const totalReturnPercent =
            netInvestedCapitalUSD > 0 ? (totalPnLUSD / netInvestedCapitalUSD) * 100 : 0;
        const unrealizedPercent =
            holdingsTotalCostUSD > 0 ? (unrealizedPnLUSD / holdingsTotalCostUSD) * 100 : 0;

        const toTarget = (usdVal) => this.convertCurrency(usdVal, 'USD', targetCurrency);

        return {
            targetCurrency,
            totalValue: toTarget(totalPortfolioValueUSD),
            holdingsValue: toTarget(holdingsTotalValueUSD),
            cash: toTarget(displayCashUSD),
            holdingsCost: toTarget(holdingsTotalCostUSD),
            totalDeposits: toTarget(totalDepositsUSD),
            totalWithdrawals: toTarget(totalWithdrawalsUSD),
            netInvestedCapital: toTarget(netInvestedCapitalUSD),
            unrealizedPnL: toTarget(unrealizedPnLUSD),
            unrealizedPercent,
            realizedPnL: toTarget(realizedPnLUSD),
            totalDividends: toTarget(totalDividendsUSD),
            totalFees: toTarget(totalFeesUSD),
            totalPnL: toTarget(totalPnLUSD),
            totalReturnPercent,
            holdings: holdingsList,
            firstTradeDate,
            fxRate: FX,
        };
    }

    getDailyMovers(targetCurrency = 'USD') {
        const stats = this.calculatePortfolio(targetCurrency);

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const yesterdayStr = Utils.getDateString(yesterday);

        const movers = stats.holdings
            .map((h) => {
                // Sans historique reel, la cloture de la veille est un point de marche
                // aleatoire : annoncer "+1,87 % sur la seance" serait une invention.
                if (APIService.isSyntheticHistory(this.dailyPriceCache[h.symbol])) return null;
                const currentPrice = h.currentPrice;
                const prevClose = this.getPriceOnDate(h.symbol, yesterdayStr, currentPrice);
                const dayChangePercent =
                    prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
                return { symbol: h.symbol, currency: h.currency, currentPrice, dayChangePercent };
            })
            .filter((m) => m && Math.abs(m.dayChangePercent) > 0.001);

        const gainers = movers
            .filter((m) => m.dayChangePercent > 0)
            .sort((a, b) => b.dayChangePercent - a.dayChangePercent)
            .slice(0, 3);
        const losers = movers
            .filter((m) => m.dayChangePercent < 0)
            .sort((a, b) => a.dayChangePercent - b.dayChangePercent)
            .slice(0, 3);

        return { gainers, losers };
    }

    getMonthlyPerformanceSummary(targetCurrency = 'USD') {
        const stats = this.calculatePortfolio(targetCurrency);
        const today = new Date();
        const monthAgo = new Date(today);
        monthAgo.setDate(today.getDate() - 30);
        const monthAgoStr = Utils.getDateString(monthAgo);

        const movers = stats.holdings
            .map((h) => {
                // Idem : pas de variation sur 30 jours a partir d'une serie simulee.
                if (APIService.isSyntheticHistory(this.dailyPriceCache[h.symbol])) return null;
                const currentPrice = h.currentPrice;
                const pastPrice = this.getPriceOnDate(h.symbol, monthAgoStr, currentPrice);
                const changePercent =
                    pastPrice > 0 ? ((currentPrice - pastPrice) / pastPrice) * 100 : 0;
                return { symbol: h.symbol, changePercent, weightPercent: h.weightPercent };
            })
            .filter((m) => m && Math.abs(m.changePercent) > 0.01);

        const topGainers = movers
            .filter((m) => m.changePercent > 0)
            .sort((a, b) => b.changePercent - a.changePercent)
            .slice(0, 3);
        const topLosers = movers
            .filter((m) => m.changePercent < 0)
            .sort((a, b) => a.changePercent - b.changePercent)
            .slice(0, 3);

        const timeline = this.getHistoricalTimeline('1M', 'PERF', targetCurrency);
        const portfolioPercent =
            (timeline && timeline.rangeStats && timeline.rangeStats['1M']) || 0;

        return { portfolioPercent, topGainers, topLosers };
    }

    // Estimation : pas de vrai calendrier de dividendes futurs disponible sans cle payante.
    // On projette la prochaine date a partir du dernier dividende verse + intervalle moyen constate.
    async getUpcomingDividends(targetCurrency = 'USD') {
        const stats = this.calculatePortfolio(targetCurrency);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const windowEnd = new Date(today);
        windowEnd.setDate(today.getDate() + 45);

        const results = [];
        for (const h of stats.holdings) {
            if (h.symbol.startsWith('$')) continue;

            const from = Utils.getDateString(
                new Date(today.getFullYear() - 2, today.getMonth(), today.getDate())
            );
            const to = Utils.getDateString(today);
            const events = await APIService.getDividends(h.symbol, from, to);
            if (events.length < 1) continue;

            const sorted = events.slice().sort((a, b) => a.date.localeCompare(b.date));
            const last = sorted[sorted.length - 1];

            let intervalDays = 91; // repli trimestriel si un seul versement connu
            if (sorted.length >= 2) {
                const prev = sorted[sorted.length - 2];
                intervalDays = Utils.daysBetween(
                    Utils.parseDate(prev.date),
                    Utils.parseDate(last.date)
                );
            }

            const estDate = Utils.parseDate(last.date);
            estDate.setDate(estDate.getDate() + intervalDays);

            if (estDate >= today && estDate <= windowEnd) {
                const amountNative = h.qty * last.amountPerShare;
                results.push({
                    symbol: h.symbol,
                    estimatedDate: Utils.getDateString(estDate),
                    amount: this.convertCurrency(amountNative, h.currency, targetCurrency),
                    yieldPercent:
                        h.currentPrice > 0 ? (last.amountPerShare / h.currentPrice) * 100 : 0,
                });
            }
        }

        results.sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate));
        return results;
    }

    // Calendrier reel via Finnhub (actions US uniquement, gratuit). La fenetre de
    // 90 jours est appliquee par le proxy (/earnings), qui ne renvoie que la
    // prochaine publication : rien a filtrer ici.
    async getUpcomingEarnings() {
        const stats = this.calculatePortfolio('USD');

        const results = [];
        for (const h of stats.holdings) {
            const data = await APIService.getEarnings(h.symbol);
            if (!data) continue;
            results.push({
                symbol: h.symbol,
                date: data.date,
                hour: data.hour,
                epsEstimate: data.epsEstimate,
                revenueEstimate: data.revenueEstimate,
            });
        }

        results.sort((a, b) => a.date.localeCompare(b.date));
        return results;
    }

    // --- etat incremental du resultat, partage avec la serie historique -----
    //
    // computeProfitAsOf et getHistoricalTimeline parcourent les memes
    // transactions dans le meme ordre. En isolant l'accumulation, la serie
    // quotidienne se calcule en une seule passe au lieu de tout reprendre a zero
    // chaque jour — et les deux chemins ne peuvent plus diverger, puisqu'il n'y a
    // qu'une seule implementation du calcul.

    _newProfitState() {
        return {
            realizedPnLUSD: 0,
            dividendsUSD: 0,
            feesUSD: 0,
            totalBuyUSD: 0,
            runningNetContribUSD: 0,
            peakNetContribUSD: 0,
            /** @type {Record<string, { qty: number, costUSD: number }>} */
            holdings: {},
        };
    }

    _applyTradeToProfitState(st, trade) {
        const currency = Utils.getCurrency(trade.symbol);
        const toUSD = (val) => this.convertCurrency(val, currency, 'USD');

        switch (trade.type) {
            case 'DEPOSIT': {
                const amtUSD = toUSD(trade.amount);
                st.runningNetContribUSD += amtUSD;
                st.peakNetContribUSD = Math.max(st.peakNetContribUSD, st.runningNetContribUSD);
                break;
            }
            case 'WITHDRAWAL': {
                const amtUSD = toUSD(trade.amount);
                st.runningNetContribUSD -= amtUSD;
                break;
            }
            case 'BUY': {
                const feeUSD = toUSD(trade.fees || 0);
                const sharesCostUSD = toUSD(trade.qty * trade.price);
                st.feesUSD += feeUSD;
                st.totalBuyUSD += sharesCostUSD + feeUSD;
                if (!st.holdings[trade.symbol]) st.holdings[trade.symbol] = { qty: 0, costUSD: 0 };
                st.holdings[trade.symbol].qty += trade.qty;
                st.holdings[trade.symbol].costUSD += sharesCostUSD;
                break;
            }
            case 'SELL': {
                const feeUSD = toUSD(trade.fees || 0);
                const h = st.holdings[trade.symbol];
                const sellQty = Math.min(trade.qty, h ? Math.max(0, h.qty) : 0);
                if (sellQty > 0) {
                    const grossRevenueUSD = toUSD(sellQty * trade.price);
                    st.feesUSD += feeUSD;
                    const costSoldUSD = (h.costUSD / h.qty) * sellQty;
                    st.realizedPnLUSD += grossRevenueUSD - costSoldUSD;
                    h.qty -= sellQty;
                    h.costUSD -= costSoldUSD;
                    if (h.qty <= 0.00001) {
                        h.qty = 0;
                        h.costUSD = 0;
                    }
                }
                break;
            }
            case 'DIVIDEND':
                st.dividendsUSD += toUSD(trade.amount);
                break;
            case 'FEE': {
                const amtUSD = toUSD(trade.amount);
                st.feesUSD += amtUSD;
                break;
            }
        }
    }

    /** Valorise l'etat a une date donnee et en tire resultat et apports. */
    _profitFromState(st, dateStr, targetCurrency) {
        let holdingsValueUSD = 0,
            holdingsCostUSD = 0;
        Object.entries(st.holdings).forEach(([symbol, h]) => {
            if (h.qty <= 0.0001) return;
            const currency = Utils.getCurrency(symbol);
            // `getPriceOnDate` renvoie un cours en devise de cotation, reconverti en
            // USD juste apres : le prix de repli doit donc etre natif lui aussi. Le
            // PRU stocke est en USD, d'ou la conversion inverse -- sans elle la
            // position etait convertie deux fois (+8 % de plus-value fantome sur
            // une valeur en euros au taux de 1,08).
            const fallbackNative = this.convertCurrency(h.costUSD / h.qty, 'USD', currency);
            const priceOnDay = this.getPriceOnDate(symbol, dateStr, fallbackNative);
            holdingsValueUSD += this.convertCurrency(h.qty * priceOnDay, currency, 'USD');
            holdingsCostUSD += h.costUSD;
        });

        const unrealizedPnLUSD = holdingsValueUSD - holdingsCostUSD;
        const totalPnLUSD = unrealizedPnLUSD + st.realizedPnLUSD + st.dividendsUSD - st.feesUSD;
        const netInvestedUSD =
            st.peakNetContribUSD > 0
                ? st.peakNetContribUSD
                : st.totalBuyUSD > 0
                  ? st.totalBuyUSD
                  : 0;

        return {
            totalPnL: this.convertCurrency(totalPnLUSD, 'USD', targetCurrency),
            netInvested: this.convertCurrency(netInvestedUSD, 'USD', targetCurrency),
        };
    }

    /**
     * Positions telles que la serie historique les suit : le prix de repli est
     * celui du tout premier achat du titre, et une vente n'est pas ecretee a la
     * quantite detenue (elle est ramenee a zero par le seuil plus bas). Distinct
     * de l'etat de resultat, qui ecrete pour ne pas realiser de gain fantome.
     */
    _applyTradeToDayHoldings(dayHoldings, trade) {
        const currency = Utils.getCurrency(trade.symbol);
        const toUSD = (v) => this.convertCurrency(v, currency, 'USD');

        if (trade.type === 'BUY') {
            if (!dayHoldings[trade.symbol]) {
                dayHoldings[trade.symbol] = { qty: 0, costUSD: 0, buyPrice: trade.price };
            }
            dayHoldings[trade.symbol].qty += trade.qty;
            dayHoldings[trade.symbol].costUSD += toUSD(trade.qty * trade.price);
        } else if (trade.type === 'SELL') {
            const h = dayHoldings[trade.symbol];
            if (h) {
                const costSold = h.qty > 0 ? (h.costUSD / h.qty) * trade.qty : 0;
                h.qty -= trade.qty;
                h.costUSD -= costSold;
                if (h.qty <= 0.00001) {
                    h.qty = 0;
                    h.costUSD = 0;
                }
            }
        }
    }

    computeProfitAsOf(dateStr, targetCurrency = 'USD') {
        const st = this._newProfitState();
        // Comparaison sur les dates analysees, comme le tri : une date non
        // canonique ('2026-1-5', '05/01/2026') se compare mal en texte et serait
        // soit ignoree pour toujours, soit comptee des le premier jour.
        const limit = Utils.parseDate(dateStr).getTime();
        this.getSortedTrades()
            .filter((t) => Utils.parseDate(t.date).getTime() <= limit)
            .forEach((trade) => this._applyTradeToProfitState(st, trade));
        return this._profitFromState(st, dateStr, targetCurrency);
    }

    getYearlyPerformance(targetCurrency = 'USD') {
        const firstTradeDate = this.getFirstTradeDate();
        if (!firstTradeDate) return { ytd: null, years: [] };

        const today = new Date();
        const todayStr = Utils.getDateString(today);
        const currentYear = today.getFullYear();
        const startYear = firstTradeDate.getFullYear();

        const profitAt = (dateStr) => this.computeProfitAsOf(dateStr, targetCurrency);

        const jan1Str = (y) => `${y}-01-01`;
        const dec31Str = (y) => `${y}-12-31`;

        const firstTradeStr = Utils.getDateString(firstTradeDate);

        // Denominateur du rendement : capital net moyen pondere par le temps ou il a
        // reellement ete investi (Dietz modifie). Fige a la valeur du 1er janvier, il
        // ignorait les apports faits en cours d'annee : 5 000 gagnes apres 10 000
        // apportes en janvier puis 90 000 en juillet donnaient +50 %, alors que le
        // capital moyen mobilise est d'environ 55 000, soit ~9 %.
        const weightedBasis = (fromStr, toStr, startingCapital) => {
            const startStr = fromStr < firstTradeStr ? firstTradeStr : fromStr;
            const totalDays = Math.max(1, Utils.daysBetween(startStr, toStr));
            let basis = startingCapital;
            this.getSortedTrades().forEach((t) => {
                if (t.date <= startStr || t.date > toStr) return;
                if (t.type !== 'DEPOSIT' && t.type !== 'WITHDRAWAL') return;
                const amount = this.convertCurrency(
                    t.amount,
                    Utils.getCurrency(t.symbol),
                    targetCurrency
                );
                const remaining = Utils.daysBetween(t.date, toStr) / totalDays;
                basis += (t.type === 'DEPOSIT' ? amount : -amount) * remaining;
            });
            return basis;
        };

        const buildRow = (label, fromStr, toStr) => {
            const from = profitAt(fromStr);
            const to = profitAt(toStr);
            const profit = to.totalPnL - from.totalPnL;
            const startingCapital = from.netInvested > 0 ? from.netInvested : 0;
            const basis = weightedBasis(fromStr, toStr, startingCapital);
            // Repli sur le capital de fin quand rien n'etait investi au depart et
            // qu'aucun flux pondere n'est exploitable (annee d'ouverture tres courte).
            const denom = basis > 0 ? basis : to.netInvested;
            const percent = denom > 0 ? (profit / denom) * 100 : 0;
            return { label, profit, percent };
        };

        const ytdRow = buildRow('Depuis 1er Janvier', jan1Str(currentYear), todayStr);

        const years = [];
        for (let y = currentYear; y >= startYear; y--) {
            const fromStr = y === startYear ? '0000-01-01' : jan1Str(y);
            const toStr = y === currentYear ? todayStr : dec31Str(y);
            years.push(buildRow(String(y), fromStr, toStr));
        }

        return { ytd: ytdRow, years };
    }

    resolveRangeStart(range, today, firstTradeDate) {
        let start;
        if (range === 'ALL') {
            start = firstTradeDate ? new Date(firstTradeDate) : new Date(today);
            if (!firstTradeDate) start.setDate(today.getDate() - 30);
        } else if (range === 'YTD') {
            start = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
        } else if (range === '1M') {
            start = new Date(today);
            start.setDate(today.getDate() - 30);
        } else if (range === '3M') {
            start = new Date(today);
            start.setDate(today.getDate() - 90);
        } else if (range === '6M') {
            start = new Date(today);
            start.setDate(today.getDate() - 180);
        } else if (range === '1Y') {
            start = new Date(today);
            start.setDate(today.getDate() - 365);
        } else {
            start = new Date(today);
            start.setDate(today.getDate() - 90);
        }
        start.setHours(0, 0, 0, 0);
        return start;
    }

    // Calcule la serie quotidienne complete (depuis la 1ere transaction jusqu'a aujourd'hui) une seule
    // fois. Les badges de periode (rangeStats/profitRangeStats) sont TOUJOURS calcules sur cette serie
    // complete, independamment de la fenetre actuellement affichee dans le graphe (`range`), pour que
    // leurs valeurs ne changent jamais quand l'utilisateur clique sur un autre bouton de periode.
    getHistoricalTimeline(range = 'ALL', _mode = 'VALUE', targetCurrency = 'USD') {
        const sortedTrades = this.getSortedTrades();
        const firstTradeDate = this.getFirstTradeDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const fullStartDate = this.resolveRangeStart('ALL', today, firstTradeDate);
        const fullTotalDays = Math.max(1, Utils.daysBetween(fullStartDate, today));

        const fullLabels = [];
        const fullRawDates = [];
        const fullValues = [];
        const fullPerfValues = [];
        const fullProfitValues = [];
        // Series en USD servant au rendement pondere dans le temps (cf. plus bas) :
        // valeur de marche des positions et flux nets investis du jour.
        const fullHoldingsUSD = [];
        const fullFlowsUSD = [];

        // Une seule passe : les transactions sont triees, donc un curseur qui
        // avance suffit. La version precedente refiltrait et rejouait tout
        // l'historique a chaque jour, et rappelait computeProfitAsOf (qui retriait
        // lui aussi) : le cout etait le produit des jours par les transactions.
        // Sur 400 transactions et 3 ans d'historique, cela representait 4,6 s par
        // appel, pour une ecriture DOM mesuree a 0,1 ms.
        /** @type {Record<string, { qty: number, costUSD: number, buyPrice: number }>} */
        const dayHoldings = {};
        const profitState = this._newProfitState();
        let cursor = 0;
        // Le curseur avance sur les memes dates analysees que celles qui ont servi
        // au tri, jamais sur une comparaison de chaines : une date non canonique
        // ('2026-1-5', '05/01/2026', un horodatage ISO) se trie correctement mais
        // se compare mal en texte, et bloquerait le curseur — donc perdrait
        // silencieusement toutes les transactions suivantes.
        const tradeTimes = sortedTrades.map((t) => Utils.parseDate(t.date).getTime());

        for (let i = 0; i <= fullTotalDays; i++) {
            const currDate = new Date(fullStartDate);
            currDate.setDate(fullStartDate.getDate() + i);
            currDate.setHours(0, 0, 0, 0);
            const dateStr = Utils.getDateString(currDate);

            // Flux du jour : ce qui entre (achats) ou sort (ventes) des positions.
            // Les frais en sont exclus, ils ne changent pas la valeur de marche.
            let dayFlowUSD = 0;

            const dayTime = currDate.getTime();
            while (cursor < sortedTrades.length && tradeTimes[cursor] <= dayTime) {
                const tradeTime = tradeTimes[cursor];
                const trade = sortedTrades[cursor++];
                this._applyTradeToDayHoldings(dayHoldings, trade);
                this._applyTradeToProfitState(profitState, trade);

                if (tradeTime === dayTime && (trade.type === 'BUY' || trade.type === 'SELL')) {
                    const flow = this.convertCurrency(
                        trade.qty * trade.price,
                        Utils.getCurrency(trade.symbol),
                        'USD'
                    );
                    dayFlowUSD += trade.type === 'BUY' ? flow : -flow;
                }
            }

            let dayHoldingsValueUSD = 0;
            let dayHoldingsCostUSD = 0;

            Object.entries(dayHoldings).forEach(([symbol, h]) => {
                if (h.qty > 0.0001) {
                    const priceOnDay = this.getPriceOnDate(symbol, dateStr, h.buyPrice);
                    const currency = Utils.getCurrency(symbol);
                    const valUSD = this.convertCurrency(h.qty * priceOnDay, currency, 'USD');
                    dayHoldingsValueUSD += valUSD;
                    dayHoldingsCostUSD += h.costUSD;
                }
            });

            const dayStockValueTarget = this.convertCurrency(
                dayHoldingsValueUSD,
                'USD',
                targetCurrency
            );

            fullHoldingsUSD.push(dayHoldingsValueUSD);
            fullFlowsUSD.push(dayFlowUSD);

            fullLabels.push(Utils.formatDateShort(dateStr));
            fullRawDates.push(dateStr);
            fullValues.push(dayStockValueTarget);

            const perfPct =
                dayHoldingsCostUSD > 0
                    ? ((dayHoldingsValueUSD - dayHoldingsCostUSD) / dayHoldingsCostUSD) * 100
                    : 0;
            fullPerfValues.push(perfPct);

            fullProfitValues.push(
                this._profitFromState(profitState, dateStr, targetCurrency).totalPnL
            );
        }

        // Recherche directe sur les dates de la serie plutot qu'un calcul arithmetique sur totalDays :
        // totalDays est artificiellement gonfle d'un jour (Math.max(1, ...) plus haut) quand tout
        // l'historique tient sur une seule journee, ce qui decale les index si on les recalcule par
        // soustraction de jours. Chercher la date directement dans fullRawDates est fiable dans tous les cas.
        const indexFromDate = (date) => {
            const dStr = Utils.getDateString(date);
            const idx = fullRawDates.findIndex((d) => d >= dStr);
            return idx === -1 ? fullRawDates.length - 1 : idx;
        };

        // Indice de rendement pondere dans le temps : chaque jour, la valeur des
        // positions est comparee a celle de la veille augmentee des flux du jour.
        // Sans cela, un simple ecart entre deux points de fullPerfValues (plus-value
        // rapportee au cout) melange performance et dilution : acheter une seconde
        // ligne au prix du marche fait chuter la plus-value moyenne sans qu'aucune
        // perte n'ait eu lieu -- le badge affichait alors -30 %.
        const twrIndex = [100];
        for (let i = 1; i < fullHoldingsUSD.length; i++) {
            const base = fullHoldingsUSD[i - 1] + fullFlowsUSD[i];
            const growth = base > 0.0001 ? fullHoldingsUSD[i] / base : 1;
            twrIndex.push(twrIndex[i - 1] * growth);
        }

        const rangeStats = {};
        const valueRangeStats = {};
        const profitRangeStats = {};
        const ranges = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

        ranges.forEach((r) => {
            const rStart = this.resolveRangeStart(r, today, firstTradeDate);
            const rStartIndex = r === 'ALL' ? 0 : indexFromDate(rStart);
            const startVal = fullValues[rStartIndex] || 0;
            const endVal = fullValues[fullValues.length - 1] || 0;

            // Badge "Performance" : rendement reel des positions sur la periode,
            // neutralise des apports et retraits (cf. twrIndex).
            const twrStart = twrIndex[rStartIndex];
            const twrEnd = twrIndex[twrIndex.length - 1];
            rangeStats[r] = twrStart > 0 && twrEnd != null ? (twrEnd / twrStart - 1) * 100 : 0;
            valueRangeStats[r] = endVal - startVal;

            const profitStartVal = fullProfitValues[rStartIndex] || 0;
            const profitEndVal = fullProfitValues[fullProfitValues.length - 1] || 0;
            profitRangeStats[r] = profitEndVal - profitStartVal;
        });

        // Fenetre affichee dans le graphe : simple decoupe de la serie complete deja calculee.
        let displayStartDate = this.resolveRangeStart(range, today, firstTradeDate);
        if (displayStartDate < fullStartDate) displayStartDate = fullStartDate;
        const sliceStartIndex = range === 'ALL' ? 0 : indexFromDate(displayStartDate);

        return {
            labels: fullLabels.slice(sliceStartIndex),
            rawDates: fullRawDates.slice(sliceStartIndex),
            values: fullValues.slice(sliceStartIndex),
            perfValues: fullPerfValues.slice(sliceStartIndex),
            profitValues: fullProfitValues.slice(sliceStartIndex),
            rangeStats,
            valueRangeStats,
            profitRangeStats,
        };
    }
}
