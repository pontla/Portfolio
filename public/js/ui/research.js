/**
 * Onglet Explorer : recherche, orchestration de l'analyse, graphe de cours, position detenue, actualites.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { Utils } from '../core/utils.js';
import { APIService } from '../core/api.js';
import { AnalysisService } from '../core/analysis.js';
import { Icons } from '../icons.js';

export const research = {
    // ===== EXPLORER / ANALYSE D'UNE VALEUR =====
    initResearch() {
        const input = /** @type {HTMLInputElement} */ (document.getElementById('researchSearchInput'));
        const suggest = document.getElementById('researchSuggest');
        if (!input || this._researchReady) return;
        this._researchReady = true;

        let t, lastResults = [];
        const closeSuggest = () => { suggest.hidden = true; suggest.innerHTML = ''; };

        const renderSuggest = (results) => {
            lastResults = results || [];
            if (!lastResults.length) { closeSuggest(); return; }
            suggest.innerHTML = lastResults.slice(0, 8).map((item, i) => {
                const sym = item.displaySymbol || item.symbol;
                return `<div class="rs-row${i === 0 ? ' active' : ''}" data-sym="${sym}">
                    <img src="${this.getLogoUrl(sym)}" alt="" data-fallback="hide">
                    <span class="rs-txt"><span class="rs-sym">${sym}</span><span class="rs-desc">${(item.description || sym)} · ${Utils.getExchangeName(sym)}</span></span>
                </div>`;
            }).join('');
            suggest.hidden = false;
        };

        input.addEventListener('input', () => {
            const q = input.value.trim();
            clearTimeout(t);
            if (q.length < 1) { closeSuggest(); return; }
            t = setTimeout(async () => {
                const results = await APIService.searchSymbol(q);
                renderSuggest(results);
            }, 250);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const pick = lastResults[0];
                const sym = pick ? (pick.displaySymbol || pick.symbol) : input.value.trim().toUpperCase();
                if (sym) { closeSuggest(); this.runResearch(sym); }
            } else if (e.key === 'Escape') {
                closeSuggest();
            }
        });
        input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
        suggest.addEventListener('mousedown', (e) => {
            const row = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.rs-row'));
            if (row) { closeSuggest(); this.runResearch(row.dataset.sym); }
        });

        document.getElementById('researchQuick').addEventListener('click', (e) => {
            const btn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('button[data-sym]'));
            if (btn) this.runResearch(btn.dataset.sym);
        });

        /** @type {NodeListOf<HTMLElement>} */ (document.getElementById('researchRange').querySelectorAll('.range-btn')).forEach(btn => {
            btn.addEventListener('click', () => {
                /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#researchRange .range-btn')).forEach(b => b.classList.toggle('active', b === btn));
                this.chartState.researchRange = btn.dataset.range || '1Y';
                if (this.researchSymbol) this.renderResearchChart(this.researchSymbol);
            });
        });

        // Legende / interrupteurs des moyennes mobiles
        const maLegend = document.getElementById('researchMaLegend');
        if (maLegend) {
            maLegend.addEventListener('click', (e) => {
                const btn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.ma-toggle'));
                if (!btn || !btn.dataset.ma) return;
                const key = btn.dataset.ma;
                this.researchMaVisible[key] = !this.researchMaVisible[key];
                this.applyResearchMaOverlay();
            });
        }

        const deepBtn = document.getElementById('researchDeepBtn');
        if (deepBtn) deepBtn.onclick = () => this.runDeepAnalysis();

        const addBtn = document.getElementById('researchAddBtn');
        if (addBtn) addBtn.onclick = () => {
            (document.getElementById('addTransactionBtn') || document.getElementById('addTransactionFab'))?.click();
            setTimeout(() => {
                const si = /** @type {HTMLInputElement} */ (document.getElementById('symbolInputField'));
                if (si && this.researchSymbol) { si.value = this.researchSymbol; si.dispatchEvent(new Event('blur')); }
            }, 60);
        };
    },

    // Depuis une position détenue -> ouvre l'onglet Explorer sur cette valeur.
    goToResearch(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return;
        this.researchSymbol = symbol;
        /** @type {HTMLElement} */ (document.querySelector('.tab-btn[data-tab="research"]'))?.click();
        this.runResearch(symbol);
    },

    onResearchTabShown() {
        this.renderResearchQuick();
        if (this.researchSymbol) { if (this.researchChart) this.researchChart.resize(); return; }
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const top = (stats.holdings || []).slice().sort((a, b) => b.valueUSD - a.valueUSD)[0];
        if (top) this.runResearch(top.symbol);
    },

    renderResearchQuick() {
        const wrap = document.getElementById('researchQuick');
        if (!wrap) return;
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const syms = (stats.holdings || []).slice().sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 6).map(h => h.symbol);
        wrap.innerHTML = syms.map(s => `<button type="button" data-sym="${s}">${s}</button>`).join('');
    },

    perSymbolRealized(symbol) {
        const trades = this.service.getSortedTrades().filter(t => t.symbol === symbol);
        let q = 0, cost = 0, realized = 0, dividends = 0;
        for (const t of trades) {
            if (t.type === 'BUY') { q += t.qty; cost += t.qty * t.price; }
            else if (t.type === 'SELL') {
                const sq = Math.min(t.qty, q);
                if (sq > 0) { const c = (cost / q) * sq; realized += sq * t.price - c; q -= sq; cost -= c; if (q <= 1e-6) { q = 0; cost = 0; } }
            } else if (t.type === 'DIVIDEND') { dividends += t.amount || 0; }
        }
        return { realized, dividends };
    },

    async runResearch(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return;
        this.researchSymbol = symbol;

        document.getElementById('researchEmpty').hidden = true;
        document.getElementById('researchContent').hidden = false;
        const input = /** @type {HTMLInputElement} */ (document.getElementById('researchSearchInput'));
        if (input) input.value = '';

        const cur = Utils.getCurrency(symbol);
        document.getElementById('researchSymbol').textContent = symbol;
        document.getElementById('researchName').textContent = this.assetNameCache[symbol] || 'Chargement…';
        document.getElementById('researchMeta').textContent = '';
        /** @type {HTMLImageElement} */ (document.getElementById('researchLogo')).src = this.getLogoUrl(symbol);
        document.getElementById('researchLogo').style.visibility = '';

        // Le calendrier de resultats n'est plus appele ici : AnalysisService le
        // recupere deja pour la carte "Profil & risques" (une requete de moins).
        const [fund, name] = await Promise.all([
            APIService.getFundamentals(symbol),
            (this.assetNameCache[symbol] !== undefined ? Promise.resolve(this.assetNameCache[symbol]) : this.fetchAssetName(symbol))
        ]);
        this.assetNameCache[symbol] = name;
        if (this.researchSymbol !== symbol) return; // course annulee entre-temps

        const price = (fund && fund.price != null) ? fund.price : await APIService.getCurrentPrice(symbol);
        const displayName = (fund && fund.name) || name || symbol;

        document.getElementById('researchName').textContent = displayName;
        document.getElementById('researchMeta').textContent = [fund && fund.exchange, cur].filter(Boolean).join(' · ');
        document.getElementById('researchPrice').textContent = Utils.formatCurrency(price, cur);

        const chgEl = document.getElementById('researchChange');
        const pc = fund && fund.previousClose;
        if (pc && price) {
            const chg = price - pc, chgPct = (chg / pc) * 100;
            chgEl.textContent = `${chg >= 0 ? '+' : ''}${Utils.formatCurrency(chg, cur)} (${Utils.formatPercent(chgPct)})`;
            chgEl.className = `research-price-chg ${chg >= 0 ? 'text-green' : 'text-red'}`;
        } else {
            chgEl.textContent = '';
        }

        this.renderResearchPosition(symbol, cur, price);
        this.renderResearchKey(fund, cur, price);
        this.renderResearchAbout(fund);
        await this.renderResearchChart(symbol);
        this.renderResearchNews(symbol, displayName);
        this.renderResearchQuick();
        Icons.render();

        // Analyse approfondie (phases 2+) : elle consomme le quota FMP (250
        // requetes/jour), donc elle n'est plus declenchee automatiquement.
        // L'utilisateur la lance via le bouton dedie ; si elle est deja en
        // cache pour ce symbole, on la reaffiche sans nouvelle requete.
        this.clearResearchAnalysis();
        const cachedAnalysis = AnalysisService.cached(symbol);
        if (cachedAnalysis) this.applyResearchAnalysis(symbol, cachedAnalysis);
        else this.showResearchDeepCta();
    },

    // Cartes alimentees uniquement par l'analyse approfondie.
    DEEP_CARD_IDS: ['researchScoreCard', 'researchAiCard', 'researchValuationCard', 'researchGrowthCard',
        'researchHealthCard', 'researchProfitCard', 'researchSentimentCard', 'researchTechCard',
        'researchDivCard', 'researchPeersCard', 'researchQualCard'],

    // Remet les cartes d'analyse approfondie a vide et les masque : tant que
    // l'analyse n'est pas lancee, elles n'ont rien a montrer.
    clearResearchAnalysis() {
        this.researchAnalysis = null;
        this.renderResearchScore(null);
        this.renderResearchAi(null);
        this.renderResearchValuation(null);
        this.renderResearchGrowth(null);
        this.renderResearchHealth(null);
        this.renderResearchProfitability(null);
        this.renderResearchSentiment(null);
        this.renderResearchTechnical(null);
        this.renderResearchDividend(null);
        this.renderResearchQualitative(null);
        this.renderResearchPeers(null);
        for (const id of this.DEEP_CARD_IDS) {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        }
    },

    applyResearchAnalysis(symbol, a) {
        if (this.researchSymbol !== symbol || !a) return;
        this.researchAnalysis = a;
        this.renderResearchScore(a);
        this.renderResearchAi(a);
        this.renderResearchValuation(a);
        this.renderResearchGrowth(a);
        this.renderResearchHealth(a);
        this.renderResearchProfitability(a);
        this.renderResearchSentiment(a);
        this.renderResearchTechnical(a);
        this.renderResearchDividend(a);
        this.renderResearchQualitative(a);
        this.renderResearchPeers(a);
        this.applyResearchMaOverlay();
        this.hideResearchDeepCta();
    },

    showResearchDeepCta() {
        const card = document.getElementById('researchDeepCard');
        const btn = /** @type {HTMLButtonElement} */ (document.getElementById('researchDeepBtn'));
        if (!card || !btn) return;
        card.hidden = false;
        btn.disabled = false;
        btn.textContent = "Lancer l'analyse approfondie";
    },

    hideResearchDeepCta() {
        const card = document.getElementById('researchDeepCard');
        if (card) card.hidden = true;
    },

    // Declenchee uniquement par le bouton : c'est le seul point d'entree qui
    // consomme le quota FMP.
    async runDeepAnalysis() {
        const symbol = this.researchSymbol;
        if (!symbol || this.deepAnalysisRunning) return;
        const btn = /** @type {HTMLButtonElement} */ (document.getElementById('researchDeepBtn'));
        const msg = document.getElementById('researchDeepMsg');
        this.deepAnalysisRunning = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Analyse en cours…'; }
        try {
            // Etat "Chargement…" des cartes pendant la requete.
            this.renderResearchScore(null);
            this.renderResearchAi(null);
            this.renderResearchValuation(null);
            this.renderResearchGrowth(null);
            this.renderResearchHealth(null);
            this.renderResearchProfitability(null);
            this.renderResearchSentiment(null);
            this.renderResearchTechnical(null);
            this.renderResearchDividend(null);
            const a = await AnalysisService.build(symbol);
            if (this.researchSymbol !== symbol) return;
            if (a) { this.applyResearchAnalysis(symbol, a); Icons.render(); }
            else if (msg) msg.textContent = 'Analyse indisponible pour cette valeur.';
        } catch (e) {
            console.warn('AnalysisService.build KO', e);
            if (msg) msg.textContent = 'Analyse indisponible : erreur de récupération des données.';
        } finally {
            this.deepAnalysisRunning = false;
            if (btn && !document.getElementById('researchDeepCard')?.hidden) {
                btn.disabled = false;
                btn.textContent = 'Réessayer';
            }
        }
    },

    // Ancre la bulle a gauche ou a droite du "i" si la version centree sortirait de la carte.
    _placeTip(el) {
        el.classList.remove('tip-end', 'tip-start');
        const box = el.closest('.card');
        if (!box) return;
        const r = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const half = 124;   // demi-largeur max de la bulle (240px) + marge
        const c = r.left + r.width / 2;
        if (c + half > b.right) el.classList.add('tip-end');
        else if (c - half < b.left) el.classList.add('tip-start');
    },

    // Petit "i" d'aide reutilisable pour toutes les nouvelles metriques.
    _kvHelp(tip, cls = '') {
        const safe = String(tip).replace(/"/g, '&quot;');
        return `<span class="kv-help ${cls}" tabindex="0" aria-label="${safe}" data-tip="${safe}">i</span>`;
    },

    // Trace MM 50 / MM 200 par-dessus la courbe de cours existante. Les moyennes
    // viennent de l'analyse (15 mois d'historique) : rien n'est re-telecharge, et
    // les points hors de cette fenetre restent vides plutot qu'approximes.
    // Moyennes mobiles affichees par defaut, mais masquables : la legende sous le
    // graphe sert d'interrupteur. L'etat vit ici pour survivre a un changement de
    // plage ou de valeur, qui reconstruit les datasets.
    researchMaVisible: { ma50: true, ma200: true },

    applyResearchMaOverlay() {
        const chart = this.researchChart;
        if (!chart || !chart.data || !Array.isArray(chart.data.datasets) || !chart.data.datasets.length) return;
        const t = this.researchAnalysis && this.researchAnalysis.technical;
        const dates = this.researchChartDates || [];
        const ink = this.chartInk();
        const colors = { ma50: ink.acc, ma200: ink.tick };
        const available = { ma50: false, ma200: false };

        const extra = [];
        if (t && t.maSeries && dates.length) {
            const idx = {};
            t.maSeries.dates.forEach((d, i) => { idx[d] = i; });
            const pick = (serie) => dates.map(d => (idx[d] === undefined ? null : serie[idx[d]]));
            const add = (key, label, serie, dash) => {
                const data = pick(serie);
                if (!data.some(v => v != null)) return;
                // La moyenne existe : la legende doit l'annoncer meme si l'utilisateur
                // l'a masquee, sinon l'interrupteur devient introuvable.
                available[key] = true;
                if (!this.researchMaVisible[key]) return;
                extra.push({
                    label, data, borderColor: colors[key], backgroundColor: 'transparent',
                    borderWidth: 1.4, borderDash: dash, fill: false, tension: 0,
                    pointRadius: 0, pointHoverRadius: 0, spanGaps: false
                });
            };
            add('ma50', 'MM 50', t.maSeries.ma50, []);
            add('ma200', 'MM 200', t.maSeries.ma200, [5, 4]);
        }

        chart.data.datasets = [chart.data.datasets[0], ...extra];
        chart.update();
        this.renderResearchMaLegend(available, colors);
    },

    renderResearchMaLegend(available, colors) {
        const box = document.getElementById('researchMaLegend');
        if (!box) return;
        const any = available.ma50 || available.ma200;
        box.hidden = !any;
        if (!any) return;

        /** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll('.ma-toggle')).forEach(btn => {
            const key = btn.dataset.ma;
            btn.hidden = !available[key];
            const on = !!this.researchMaVisible[key];
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            const swatch = /** @type {HTMLElement} */ (btn.querySelector('.ma-swatch'));
            // Couleur posee seulement quand la courbe est visible : masquee, le
            // trait reprend le gris defini en CSS.
            if (swatch) swatch.style.borderTopColor = on ? colors[key] : '';
        });
    },

    renderResearchPosition(symbol, cur, price) {
        const card = document.getElementById('researchPositionCard');
        const notHeld = document.getElementById('researchNotHeld');
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const h = (stats.holdings || []).find(x => x.symbol === symbol);
        const { realized, dividends } = this.perSymbolRealized(symbol);

        if (!h) {
            card.hidden = true;
            notHeld.hidden = false;
            return;
        }
        notHeld.hidden = true;
        card.hidden = false;

        const ptfEl = document.getElementById('researchPositionPtf');
        if (this.service.activePortfolioId === 'GLOBAL' && h.portfolios && h.portfolios.length) {
            ptfEl.textContent = h.portfolios.map(id => (this.service.getPortfolioById(id) || {}).name).filter(Boolean).join(', ');
        } else ptfEl.textContent = '';

        const kv = (k, v, cls = '') => `<div class="research-kv"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
        const gainCls = h.gainNative >= 0 ? 'text-green' : 'text-red';
        document.getElementById('researchPositionGrid').innerHTML =
            kv('PRU', Utils.formatCurrency(h.avgPrice, cur)) +
            kv('Quantité', Utils.formatQty(h.qty)) +
            kv('Cours actuel', Utils.formatCurrency(h.currentPrice || price, cur)) +
            kv('Valeur', Utils.formatCurrency(h.valueNative, cur)) +
            kv('+/- value latente', `${h.gainNative >= 0 ? '+' : ''}${Utils.formatCurrency(h.gainNative, cur)} (${Utils.formatPercent(h.gainPercent)})`, gainCls) +
            kv('Poids portefeuille', Utils.formatPercent(h.weightPercent, false)) +
            kv('Dividendes reçus', Utils.formatCurrency(dividends, cur)) +
            kv('P&L réalisé (hors frais)', `${realized >= 0 ? '+' : ''}${Utils.formatCurrency(realized, cur)}`, realized >= 0 ? 'text-green' : 'text-red');
    },

    renderResearchKey(fund, cur, price) {
        const grid = document.getElementById('researchKeyGrid');
        const src = document.getElementById('researchKeySrc');
        const bar = document.getElementById('research52wBar');
        const kv = (k, v, cls = '') => `<div class="research-kv"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
        const n1 = (x, d = 2) => (x == null || isNaN(x)) ? '—' : Number(x).toFixed(d);
        const pct = (x) => (x == null || isNaN(x)) ? '—' : Utils.formatPercent(x, false);

        if (!fund) { grid.innerHTML = `<div class="research-kv"><span class="v">Données indisponibles.</span></div>`; src.textContent = ''; bar.hidden = true; return; }

        src.textContent = fund.fundamentalsSource === 'finnhub'
            ? 'Ratios : Finnhub'
            : 'Ratios fondamentaux : actions US uniquement';

        grid.innerHTML =
            kv('Capitalisation', Utils.formatCompact(fund.marketCap, 'USD')) +
            kv('PER (P/E TTM)', n1(fund.peTTM, 1)) +
            kv('BPA (TTM)', fund.epsTTM == null ? '—' : Utils.formatCurrency(fund.epsTTM, cur)) +
            kv('Bêta', n1(fund.beta)) +
            kv('Cours / Valeur compta. (P/B)', n1(fund.pbAnnual)) +
            kv('Cours / Ventes (P/S)', n1(fund.psTTM)) +
            kv('ROE', pct(fund.roeTTM)) +
            kv('Marge nette', pct(fund.netMarginTTM)) +
            kv('Croissance CA (1 an)', fund.revenueGrowthTTM == null ? '—' : Utils.formatPercent(fund.revenueGrowthTTM)) +
            kv('Volume du jour', Utils.formatCompact(fund.volume)) +
            kv('Clôture veille', fund.previousClose == null ? '—' : Utils.formatCurrency(fund.previousClose, cur));

        const lo = fund.fiftyTwoWeekLow, hi = fund.fiftyTwoWeekHigh;
        if (lo != null && hi != null && hi > lo && price) {
            const p = Math.max(0, Math.min(1, (price - lo) / (hi - lo)));
            document.getElementById('research52wDot').style.left = (p * 100).toFixed(1) + '%';
            document.getElementById('research52wLo').textContent = Utils.formatCurrency(lo, cur);
            document.getElementById('research52wHi').textContent = Utils.formatCurrency(hi, cur);
            bar.hidden = false;
        } else {
            bar.hidden = true;
        }
    },

    renderResearchAbout(fund) {
        const card = document.getElementById('researchAboutCard');
        const grid = document.getElementById('researchAboutGrid');
        const rows = [];
        const kv = (k, v) => rows.push(`<div class="research-kv"><span class="k">${k}</span><span class="v">${v}</span></div>`);
        if (fund && fund.industry) kv('Secteur', fund.industry);
        if (fund && fund.country) kv('Pays', fund.country);
        if (fund && fund.ipo) kv('Introduction en bourse', Utils.formatDateDisplay(fund.ipo));
        if (fund && fund.weburl) {
            let host = fund.weburl;
            try { host = new URL(fund.weburl).hostname.replace(/^www\./, ''); } catch (e) {}
            kv('Site', `<a href="${fund.weburl}" target="_blank" rel="noopener noreferrer">${host}</a>`);
        }
        if (!rows.length) { card.hidden = true; return; }
        card.hidden = false;
        grid.innerHTML = rows.join('');
    },

    // Libelle du tooltip du graphe de cours : la serie principale reste nue,
    // les moyennes mobiles sont prefixees par leur nom.
    _researchTip(ctx, cur) {
        if (ctx.parsed.y == null) return null;
        const v = Utils.formatCurrency(ctx.parsed.y, cur);
        return ctx.datasetIndex ? `${ctx.dataset.label} : ${v}` : v;
    },

    async renderResearchChart(symbol) {
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('researchChart'));
        if (!canvas) return;
        const range = this.chartState.researchRange || '1Y';
        const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 }[range] || 12;
        const end = new Date();
        const start = new Date();
        if (range === 'MAX') start.setFullYear(start.getFullYear() - 50);
        else start.setMonth(start.getMonth() - months);

        const cur = Utils.getCurrency(symbol);
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const h = (stats.holdings || []).find(x => x.symbol === symbol);

        const history = await APIService.getDailyHistory(symbol, start, end, h && h.avgPrice, h && h.currentPrice);
        if (this.researchSymbol !== symbol) return;
        const dates = Object.keys(history).sort();
        this.researchChartDates = dates;   // dates brutes : alignement de l'overlay MM
        const labels = dates.map(d => Utils.formatDateDisplay(d));
        const values = dates.map(d => history[d]);
        const rising = values.length && values[values.length - 1] >= values[0];
        const lineColor = rising ? '#2ebd85' : '#f6465c';
        const ink = this.chartInk();

        if (this.researchChart) {
            this.researchChart.data.labels = labels;
            this.researchChart.data.datasets[0].data = values;
            this.researchChart.data.datasets[0].borderColor = lineColor;
            this.researchChart.data.datasets[0].label = symbol;
            this.researchChart.options.plugins.tooltip.callbacks.label = (ctx) => this._researchTip(ctx, cur);
            this.researchChart.options.scales.y.ticks.callback = (v) => Utils.formatCurrency(v, cur);
            this.applyResearchMaOverlay();   // re-aligne les MM sur la nouvelle plage
            return;
        }

        this.researchChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [{ label: symbol, data: values, borderColor: lineColor, backgroundColor: 'transparent', fill: false, tension: 0.15, borderWidth: 2.2, borderCapStyle: 'round', pointRadius: 0, pointHoverRadius: 5 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', axis: 'x', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false, callbacks: { label: (ctx) => this._researchTip(ctx, cur) } }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { color: ink.tick, font: { size: 11 }, maxTicksLimit: 7 } },
                    y: { position: 'right', grid: { color: ink.grid, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { color: ink.tick, font: { size: 11 }, callback: (v) => Utils.formatCurrency(v, cur) } }
                }
            }
        });
        this.applyResearchMaOverlay();
    },

    async renderResearchNews(symbol, name) {
        const card = document.getElementById('researchNewsCard');
        const list = document.getElementById('researchNewsList');
        if (!card) return;
        card.hidden = true;
        this.researchNewsItems = [];
        try {
            const results = await APIService.webSearch(`${symbol} ${name} action bourse`);
            if (this.researchSymbol !== symbol || !results || !results.length) return;
            const shown = results.slice(0, 4).map(r => {
                let host = '';
                try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) {}
                return { ...r, host };
            });
            // Memorise les seuls titres affiches : c'est ce que recevra l'analyse
            // IA, jamais le contenu brut de la page.
            this.researchNewsItems = shown
                .filter(r => r.title)
                .map(r => ({ title: r.title, source: r.host || null, date: r.publishedDate || null }));
            list.innerHTML = shown.map(r => {
                const d = r.publishedDate ? Utils.formatDateDisplay(r.publishedDate) : '';
                return `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title || r.host}</a><span class="rn-meta">${[r.host, d].filter(Boolean).join(' · ')}</span></li>`;
            }).join('');
            card.hidden = false;
        } catch (e) { /* actualités indisponibles */ }
    },
};
