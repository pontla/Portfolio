/**
 * Vue d'ensemble : cartes de synthese, positions, palmares, switcher de portefeuille, utilitaires de rendu.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { CONFIG } from '../core/config.js';
import { Utils } from '../core/utils.js';
import { Icons } from '../icons.js';

export const overview = {
    renderPortfolioSwitcher() {
        const active = this.service.getActivePortfolio();
        const isGlobal = this.service.activePortfolioId === 'GLOBAL';

        const bulletEl = document.getElementById('activePortfolioBullet');
        const titleEl = document.getElementById('appTitle');
        const globalItem = document.getElementById('globalPortfolioItem');
        const listEl = document.getElementById('portfolioDropdownList');
        const targetSelect = document.getElementById('targetPortfolioSelect');

        if (bulletEl) {
            bulletEl.classList.add('pf-ico');
            bulletEl.style.background = 'none';
            bulletEl.style.color = active.color || '#3b82f6';
            bulletEl.innerHTML = `<i data-lucide="${Utils.portfolioIcon(active)}"></i>`;
        }
        if (titleEl) {
            titleEl.textContent = active.name;
        }

        if (globalItem) {
            globalItem.classList.toggle('active', isGlobal);
        }

        // Render Portfolios List in Dropdown
        if (listEl) {
            listEl.innerHTML = this.service.portfolios
                .map((p) => {
                    const isSelected = p.id === this.service.activePortfolioId;
                    const countTrades = this.service.trades.filter(
                        (t) => t.portfolioId === p.id
                    ).length;

                    return `
                    <div class="portfolio-dropdown-item portfolio-item-select ${isSelected ? 'active' : ''}" data-id="${p.id}">
                        <div class="portfolio-item-left">
                            <span class="portfolio-bullet pf-ico" style="color:${p.color};"><i data-lucide="${Utils.portfolioIcon(p)}"></i></span>
                            <div class="portfolio-item-text">
                                <span class="portfolio-title">${p.name}</span>
                                <span class="portfolio-sub">${countTrades} opération${countTrades > 1 ? 's' : ''}</span>
                            </div>
                        </div>
                        <div class="portfolio-item-actions">
                            <button class="item-action-btn edit-portfolio-btn" data-id="${p.id}" title="Renommer">
                                <i data-lucide="edit-2" class="icon-xs"></i>
                            </button>
                            ${
                                this.service.portfolios.length > 1
                                    ? `
                            <button class="item-action-btn delete delete-portfolio-btn" data-id="${p.id}" title="Supprimer">
                                <i data-lucide="trash-2" class="icon-xs"></i>
                            </button>`
                                    : ''
                            }
                        </div>
                    </div>
                `;
                })
                .join('');
        }

        // Render Portfolios in desktop side nav
        const sideListEl = document.getElementById('sidePortfolioList');
        if (sideListEl) {
            sideListEl.innerHTML = this.service.portfolios
                .map((p) => {
                    const isSel = p.id === this.service.activePortfolioId;
                    const name = Utils.escapeHtml(p.name);
                    return `
                    <button class="side-portfolio portfolio-item-select ${isSel ? 'active' : ''}" data-id="${p.id}" title="${name}">
                        <i class="side-portfolio-ico" data-lucide="${Utils.portfolioIcon(p)}" style="color:${p.color};"></i>
                        <span class="side-label">${name}</span>
                    </button>`;
                })
                .join('');
        }

        // Render Target Portfolio Select options in Transaction Modal
        if (targetSelect) {
            targetSelect.innerHTML = this.service.portfolios
                .map((p) => {
                    const isSel =
                        (!isGlobal && p.id === this.service.activePortfolioId) ||
                        (isGlobal && p.id === this.service.portfolios[0].id);
                    return `<option value="${p.id}" ${isSel ? 'selected' : ''}>${p.name}</option>`;
                })
                .join('');
        }

        Icons.render();
    },

    /**
     * Avertit quand les montants affiches reposent sur des donnees de marche
     * incompletes. Sans cours, une position est valorisee a son prix de revient :
     * sa plus-value paraitrait nulle alors qu'elle est inconnue, et la valeur
     * totale du portefeuille est sous-estimee d'autant. Le taux de change de
     * repli, lui, decale toute la valorisation des lignes en devise etrangere.
     */
    renderDataNotice(stats) {
        const el = document.getElementById('dataNotice');
        if (!el) return;

        const noPrice = stats.unavailablePrices || [];
        const estimatedFx = stats.estimatedFxCurrencies || [];
        if (!noPrice.length && !estimatedFx.length) {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }

        const parts = [];
        if (noPrice.length) {
            const list = noPrice.map((s) => `<strong>${Utils.escapeHtml(s)}</strong>`).join(', ');
            parts.push(
                noPrice.length === 1
                    ? `Cours indisponible pour ${list} : la position est comptée à son prix de revient, sa plus-value latente n'est pas connue.`
                    : `Cours indisponibles pour ${list} : ces positions sont comptées à leur prix de revient, leurs plus-values latentes ne sont pas connues.`
            );
        }
        if (estimatedFx.length) {
            const list = estimatedFx
                .map((c) => `<strong>${Utils.escapeHtml(c)}</strong>`)
                .join(', ');
            parts.push(
                `Taux de change estimé pour ${list} : les montants convertis sont approximatifs.`
            );
        }
        parts.push('Les autres chiffres restent exacts. Réessaie plus tard.');

        el.innerHTML = `<span class="dn-icon" aria-hidden="true">!</span><div>${parts.join(' ')}</div>`;
        el.hidden = false;
    },

    render() {
        const curr = this.chartState.currency;
        const stats = this.service.calculatePortfolio(curr);
        if (!stats) return;

        // Render Switcher Dropdown
        this.renderPortfolioSwitcher();

        this.renderDataNotice(stats);

        // Titre de la carte graphique = nom du portefeuille selectionne
        const chartTitleEl = document.getElementById('chartPortfolioTitle');
        if (chartTitleEl) chartTitleEl.textContent = this.service.getActivePortfolio().name;

        // Sync Range Buttons Active State
        /** @type {NodeListOf<HTMLElement>} */ (
            document.querySelectorAll('#timeRangeSelector .range-btn')
        ).forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.range === this.chartState.range);
        });
        /** @type {NodeListOf<HTMLElement>} */ (
            document.querySelectorAll('#profitRangeSelector .range-btn')
        ).forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.range === this.chartState.profitRange);
        });

        // Sync Currency Toggle UI
        const currencyToggle = document.getElementById('currencyToggle');
        if (currencyToggle) {
            /** @type {NodeListOf<HTMLElement>} */ (
                currencyToggle.querySelectorAll('.toggle-btn')
            ).forEach((b) => {
                b.classList.toggle('active', b.dataset.currency === curr);
            });
        }

        // 1. STATS GRID RENDERING (WITH 3 DISTINCT VALUES IN CARD 1)
        const statsGrid = document.getElementById('statsGrid');
        if (statsGrid) {
            statsGrid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">Valeur du portefeuille</div>
                    <div class="stat-value">
                        ${Utils.formatCurrency(stats.totalValue, curr)}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px; margin-top:8px; padding-top:6px; border-top:1px solid var(--l1); font-size:12px; color:var(--text-secondary);">
                        <div style="display:flex; justify-content:space-between;">
                            <span>Portefeuille :</span>
                            <strong data-stat="holdingsValue" style="color:var(--text-primary);">${Utils.formatCurrency(stats.holdingsValue, curr)}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span>Cash :</span>
                            <strong data-stat="cash" style="color:var(--text-primary);">${Utils.formatCurrency(stats.cash, curr)}</strong>
                        </div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Gain non réalisé</div>
                    <div class="stat-value ${stats.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}">
                        ${stats.unrealizedPnL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.unrealizedPnL, curr)}
                        <span class="percent">(${Utils.formatPercent(stats.unrealizedPercent)})</span>
                    </div>
                    <div class="stat-sub">Coût d'achat actions : ${Utils.formatCurrency(stats.holdingsCost, curr)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Gain réalisé</div>
                    <div class="stat-value ${stats.realizedPnL >= 0 ? 'text-green' : 'text-red'}">
                        ${stats.realizedPnL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.realizedPnL, curr)}
                    </div>
                    <div class="stat-sub">Dividendes reçus : <strong>${Utils.formatCurrency(stats.totalDividends, curr)}</strong></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Gain total net</div>
                    <div class="stat-value ${stats.totalPnL >= 0 ? 'text-green' : 'text-red'}">
                        ${stats.totalPnL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.totalPnL, curr)}
                        <span class="percent">(${Utils.formatPercent(stats.totalReturnPercent)})</span>
                    </div>
                    <div class="stat-sub">Rendement global sur apport</div>
                </div>
            `;
        }

        // 2. HOLDINGS TABLE RENDERING
        const hBody = document.getElementById('holdingsTableBody');
        if (hBody) {
            hBody.innerHTML = stats.holdings.length
                ? stats.holdings
                      .map((h) => {
                          const isProfit = h.gainNative >= 0;
                          const isGlobal = this.service.activePortfolioId === 'GLOBAL';

                          let portTags = '';
                          if (isGlobal && h.portfolios && h.portfolios.length) {
                              portTags = h.portfolios
                                  .map((pId) => {
                                      const p = this.service.getPortfolioById(pId);
                                      return `<span class="portfolio-badge" style="font-size:10px; padding:1px 5px;"><span class="dot" style="background:${p.color}; width:6px; height:6px;"></span>${p.name}</span>`;
                                  })
                                  .join(' ');
                          }

                          const assetName = this.assetNameCache[h.symbol];
                          const isPriceUp = h.currentPrice >= h.avgPrice;
                          // Cours indisponible : la valorisation retombe sur le
                          // prix de revient, donc la plus-value affichee serait
                          // nulle. Elle est inconnue, pas nulle : on ne chiffre
                          // rien plutot que d'annoncer 0.
                          const noPrice = h.priceUnavailable;

                          return `
                    <tr>
                        <td data-label="Actif">
                            <div class="holding-asset-cell" data-symbol="${h.symbol}" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                <img class="perf-logo" src="${this.getLogoUrl(h.symbol)}" alt=""
                                    data-fallback="sibling">
                                <span class="perf-logo-fallback" style="display:none;">${h.symbol.substring(0, 1)}</span>
                                <div style="display:flex; flex-direction:column; gap:2px;">
                                    <span style="font-weight:700; color:var(--txt);">${h.symbol}</span>
                                    <span style="font-size:12px; color:var(--dim);">${assetName || Utils.getExchangeName(h.symbol)} · ${h.weightPercent.toFixed(1)}%</span>
                                    ${portTags ? `<div style="margin-top:2px; display:flex; gap:4px; flex-wrap:wrap;">${portTags}</div>` : ''}
                                </div>
                            </div>
                        </td>
                        <td data-label="Quantité">${h.qty.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
                        <td data-label="Prix Moyen">${Utils.formatCurrency(h.avgPrice, h.currency)}</td>
                        <td data-label="Prix Actuel" class="${noPrice ? 'price-stale' : isPriceUp ? 'text-green' : 'text-red'}"
                            ${noPrice ? 'title="Cours indisponible : valeur estimée au prix de revient"' : ''}>${noPrice ? Utils.formatCurrency(h.avgPrice, h.currency) : Utils.formatCurrency(h.currentPrice, h.currency)}</td>
                        <td data-label="Valeur" style="font-weight:700;">${Utils.formatCurrency(h.valueNative, h.currency)}</td>
                        <td data-label="+/- Latente" class="${noPrice ? 'val-unknown' : isProfit ? 'text-green' : 'text-red'}" style="font-weight:600;">
                            ${
                                noPrice
                                    ? '—<br><span style="font-size:12px;">cours indisponible</span>'
                                    : `${isProfit ? '+' : ''}${Utils.formatCurrency(h.gainNative, h.currency)}
                            <br><span style="font-size:12px;">(${Utils.formatPercent(h.gainPercent)})</span>`
                            }
                        </td>
                        <td data-label="Actions">
                            <button class="btn-sm btn-primary quick-sell-btn"
                                data-symbol="${h.symbol}"
                                data-qty="${h.qty}"
                                data-price="${h.currentPrice}">
                                Vendre
                            </button>
                        </td>
                    </tr>
                `;
                      })
                      .join('')
                : '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--dim);">Aucune position active dans ce portefeuille.</td></tr>';
            this.refreshAssetNames(
                stats.holdings.map((h) => h.symbol),
                curr
            );
        }

        // 2b. HOLDINGS CARDS (mobile) — meme design + glisser pour vendre
        const cardsList = document.getElementById('holdingsCardsList');
        const cntEl = document.getElementById('holdingsCount');
        const totEl = document.getElementById('holdingsCardsTotal');
        if (cntEl)
            cntEl.textContent = `${stats.holdings.length} position${stats.holdings.length > 1 ? 's' : ''}`;
        if (totEl) totEl.textContent = Utils.formatCurrency(stats.holdingsValue, curr);
        if (cardsList) {
            cardsList.innerHTML = stats.holdings.length
                ? stats.holdings
                      .map((h) => {
                          const isProfit = h.gainNative >= 0;
                          const isPriceUp = h.currentPrice >= h.avgPrice;
                          const noPrice = h.priceUnavailable;
                          const nm =
                              this.assetNameCache[h.symbol] || Utils.getExchangeName(h.symbol);
                          const barW = Math.max(2, Math.min(100, h.weightPercent || 0));
                          return `
                <div class="holding-swipe">
                    <button class="holding-swipe-action quick-sell-btn" data-symbol="${h.symbol}" data-qty="${h.qty}" data-price="${h.currentPrice}">Vendre</button>
                    <div class="holding-card">
                        <div class="hc-row1 holding-asset-cell" data-symbol="${h.symbol}">
                            <img class="hc-logo" src="${this.getLogoUrl(h.symbol)}" alt="" data-fallback="sibling">
                            <span class="hc-logo-fb" style="display:none;">${h.symbol.substring(0, 1)}</span>
                            <div class="hc-id">
                                <span class="hc-sym">${h.symbol}</span>
                                <span class="hc-weight">${h.weightPercent.toFixed(1).replace('.', ',')} %</span>
                            </div>
                            <span class="hc-value">${Utils.formatCurrency(h.valueNative, h.currency)}</span>
                        </div>
                        <div class="hc-row2">
                            <span class="hc-name">${Utils.escapeHtml(nm)}</span>
                            <span class="hc-gain ${noPrice ? 'val-unknown' : isProfit ? 'text-green' : 'text-red'}">${noPrice ? '— cours indisponible' : `${isProfit ? '+' : ''}${Utils.formatCurrency(h.gainNative, h.currency)} · ${Utils.formatPercent(h.gainPercent)}`}</span>
                        </div>
                        <div class="hc-bar"><i style="width:${barW}%"></i></div>
                        <div class="hc-grid">
                            <div><div class="hc-cell-label">Qté</div><div class="hc-cell-val">${h.qty.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</div></div>
                            <div><div class="hc-cell-label">PRU</div><div class="hc-cell-val">${Utils.formatCurrency(h.avgPrice, h.currency)}</div></div>
                            <div><div class="hc-cell-label">Cours</div><div class="hc-cell-val ${noPrice ? 'price-stale' : isPriceUp ? 'text-green' : 'text-red'}">${noPrice ? Utils.formatCurrency(h.avgPrice, h.currency) : Utils.formatCurrency(h.currentPrice, h.currency)}</div></div>
                        </div>
                    </div>
                </div>`;
                      })
                      .join('')
                : '<div class="hc-empty">Aucune position active dans ce portefeuille.</div>';
            this.initHoldingsSwipe();
        }

        // 3. TRANSACTIONS TABLE RENDERING
        this.renderTransactionsTable(curr);

        // 4. UPDATE DYNAMIC TIME RANGE BADGES
        const timelineData = this.service.getHistoricalTimeline(
            this.chartState.range,
            this.chartState.mode,
            curr
        );
        if (timelineData && timelineData.rangeStats) {
            const isPerf = this.chartState.mode === 'PERF';
            const badgeStats = isPerf ? timelineData.rangeStats : timelineData.valueRangeStats;
            Object.entries(badgeStats).forEach(([rangeKey, val]) => {
                const el = /** @type {HTMLElement} */ (
                    document.querySelector(`[data-range-val="${rangeKey}"]`)
                );
                if (el) {
                    const isPositive = val >= 0;
                    const fmt = (v) =>
                        isPerf
                            ? Utils.formatPercent(v)
                            : (v >= 0 ? '+' : '') + Utils.formatCurrency(v, curr);
                    const rangeBtn = el.closest('.range-btn');
                    const isActive = rangeBtn && rangeBtn.classList.contains('active');
                    if (isActive) {
                        const from =
                            typeof this._activeDeltaVal === 'number' ? this._activeDeltaVal : val;
                        if (from !== val) this.animateNumber(el, from, val, fmt);
                        else if (!el._animating) el.textContent = fmt(val);
                        this._activeDeltaVal = val;
                    } else if (!el._animating) {
                        el.textContent = fmt(val);
                    }
                    el.className = `value ${isPositive ? 'text-green' : 'text-red'}`;
                }
            });
        }

        // 4b. VALEUR DE TETE DE LA CARTE GRAPHIQUE
        // Mode "Valeur" : montant en blanc + performance % en vert/rouge.
        // Mode "Performance" : performance % en blanc + montant en vert/rouge.
        const headVal = document.getElementById('chartHeadlineValue');
        const headDelta = document.getElementById('chartHeadlineDelta');
        if (headVal && timelineData) {
            const isPerfHead = this.chartState.mode === 'PERF';
            const valSeries = timelineData.values || [];
            const perfSeries = timelineData.perfValues || [];
            const lastVal = valSeries.length
                ? valSeries[valSeries.length - 1]
                : stats
                  ? stats.holdingsValue
                  : 0;
            const lastPerf = perfSeries.length
                ? perfSeries[perfSeries.length - 1]
                : stats
                  ? stats.unrealizedPercent
                  : 0;

            const valTxt = Utils.formatCurrency(lastVal, curr);
            const perfTxt = Utils.formatPercent(lastPerf);

            headVal.textContent = isPerfHead ? perfTxt : valTxt;
            headDelta.textContent = isPerfHead ? valTxt : perfTxt;
            headDelta.className = `chart-headline-delta ${lastPerf >= 0 ? 'text-green' : 'text-red'}`;
        }

        // 5. UPDATE CHART
        this.updateChart(timelineData);

        // 6. UPDATE ANALYSIS TAB (repartition par actif / classe / devise)
        this.renderAnalysisCharts(stats, curr);
        this.renderPerfList(stats);
        this.renderProfitChart();
        this.renderYearlyTable();
        this.renderDailyMovers();

        // Etats transverses : masquer le squelette, basculer l'etat vide
        const cont = document.getElementById('appContainer');
        if (cont) cont.classList.remove('app-loading');
        const emptyEl = document.getElementById('emptyState');
        if (emptyEl) emptyEl.hidden = !!(this.service.trades && this.service.trades.length);

        Icons.render();
    },

    downloadCSV(filename, content) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    getLogoUrl(symbol) {
        const clean = symbol.split('.')[0].split('-')[0];
        return `https://img.logokit.com/ticker/${encodeURIComponent(clean)}?token=${CONFIG.LOGOKIT_TOKEN}`;
    },

    chartInk() {
        const cs = getComputedStyle(document.documentElement);
        const v = (n, fb) => (cs.getPropertyValue(n) || fb).trim();
        return {
            grid: v('--grid', 'rgba(255,255,255,.045)'),
            tick: v('--dim', '#8b93a1'),
            up: '#2ebd85',
            acc: '#00d3f2',
        };
    },

    // Anime un nombre de `from` a `to` (rAF, ~420ms, easing 1-(1-t)^3)
    animateNumber(el, from, to, fmt) {
        if (!el) return;
        const reduce =
            window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || document.hidden || typeof from !== 'number' || !isFinite(from)) {
            el.textContent = fmt(to);
            return;
        }
        const token = (el._animTok || 0) + 1;
        el._animTok = token;
        el._animating = true;
        const t0 = performance.now(),
            dur = 420;
        const step = (now) => {
            if (el._animTok !== token) return;
            const t = Math.min(1, (now - t0) / dur);
            const e = 1 - Math.pow(1 - t, 3);
            el.textContent = fmt(from + (to - from) * e);
            if (t < 1) requestAnimationFrame(step);
            else el._animating = false;
        };
        requestAnimationFrame(step);
    },

    renderPerfList(stats) {
        const listEl = document.getElementById('perfList');
        if (!listEl) return;

        const dividendSymbols = new Set(
            this.service
                .getFilteredTrades()
                .filter((t) => t.type === 'DIVIDEND')
                .map((t) => t.symbol)
        );

        let rows = (stats.holdings || []).slice();

        const filter = this.chartState.perfFilter;
        if (filter === 'up') rows = rows.filter((h) => h.gainPercent > 0);
        else if (filter === 'down') rows = rows.filter((h) => h.gainPercent < 0);
        else if (filter === 'dividends') rows = rows.filter((h) => dividendSymbols.has(h.symbol));

        rows.sort((a, b) => b.gainPercent - a.gainPercent);

        if (rows.length === 0) {
            listEl.innerHTML =
                '<p style="text-align:center; padding:20px; color:var(--text-secondary);">Aucune position à afficher.</p>';
            return;
        }

        const maxAbs = Math.max(...rows.map((h) => Math.abs(h.gainPercent)), 1);

        listEl.innerHTML = rows
            .map((h) => {
                const isPositive = h.gainPercent >= 0;
                const widthPct = (Math.abs(h.gainPercent) / maxAbs) * 100;
                const barClass = isPositive ? 'positive' : 'negative';
                const gainNativeStr =
                    (isPositive ? '+' : '') + Utils.formatCurrency(h.gainNative, h.currency);
                const valueStr = Utils.formatCurrency(h.valueNative, h.currency);

                return `
                <div class="perf-row">
                    <img class="perf-logo" src="${this.getLogoUrl(h.symbol)}" alt=""
                        data-fallback="sibling">
                    <span class="perf-logo-fallback" style="display:none;">${h.symbol.substring(0, 1)}</span>
                    <span class="perf-ticker">${h.symbol}</span>
                    <div class="perf-bar-track">
                        <div class="perf-bar-fill ${barClass}" style="width:${widthPct}%;"></div>
                    </div>
                    <span class="perf-pct ${isPositive ? 'text-green' : 'text-red'}">${Utils.formatPercent(h.gainPercent)}</span>
                    <div class="perf-tooltip">
                        <div class="tt-name">${h.symbol}</div>
                        <div class="tt-row"><span>Gain total %</span><span>${Utils.formatPercent(h.gainPercent)}</span></div>
                        <div class="tt-row"><span>Gain total</span><span>${gainNativeStr}</span></div>
                        <div class="tt-row"><span>Valeur totale</span><span>${valueStr}</span></div>
                    </div>
                </div>
            `;
            })
            .join('');
    },

    renderDailyMovers() {
        const gainersEl = document.getElementById('gainersList');
        const losersEl = document.getElementById('losersList');
        if (!gainersEl || !losersEl) return;

        const { gainers, losers } = this.service.getDailyMovers(this.chartState.currency);

        const renderList = (el, items, barClass) => {
            if (!items.length) {
                el.innerHTML =
                    '<p style="text-align:center; padding:12px; color:var(--text-secondary);">Aucune donnée du jour.</p>';
                return;
            }
            const maxAbs = Math.max(...items.map((m) => Math.abs(m.dayChangePercent)), 1);

            el.innerHTML = items
                .map((m) => {
                    const widthPct = (Math.abs(m.dayChangePercent) / maxAbs) * 100;
                    return `
                    <div class="perf-row">
                        <img class="perf-logo" src="${this.getLogoUrl(m.symbol)}" alt=""
                            data-fallback="sibling">
                        <span class="perf-logo-fallback" style="display:none;">${m.symbol.substring(0, 1)}</span>
                        <span class="perf-ticker">${m.symbol}</span>
                        <div class="perf-bar-track">
                            <div class="perf-bar-fill ${barClass}" style="width:${widthPct}%;"></div>
                        </div>
                        <span class="perf-pct ${barClass === 'positive' ? 'text-green' : 'text-red'}">${Utils.formatPercent(m.dayChangePercent)}</span>
                    </div>
                `;
                })
                .join('');
        };

        renderList(gainersEl, gainers, 'positive');
        renderList(losersEl, losers, 'negative');
    },
};
