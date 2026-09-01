/**
 * Graphiques Chart.js : courbe de valeur, plus-values, donuts de repartition, tableau annuel.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { CONFIG } from '../core/config.js';
import { Utils } from '../core/utils.js';
import { APIService } from '../core/api.js';

export const charts = {
    buildMonthlySummaryHtml() {
        const monthly = this.service.getMonthlyPerformanceSummary(this.chartState.currency);
        const sign = monthly.portfolioPercent >= 0 ? '+' : '';
        let summary = `Performance du portefeuille sur les 30 derniers jours : ${sign}${monthly.portfolioPercent.toFixed(2)}%.`;
        if (monthly.topGainers.length) {
            summary += ` Meilleure(s) performance(s) : ${monthly.topGainers.map(m => `${m.symbol} (+${m.changePercent.toFixed(2)}%)`).join(', ')}.`;
        }
        if (monthly.topLosers.length) {
            summary += ` Plus forte(s) baisse(s) : ${monthly.topLosers.map(m => `${m.symbol} (${m.changePercent.toFixed(2)}%)`).join(', ')}.`;
        }
        return `<div class="insights-summary">${Utils.escapeHtml(summary)}</div>`;
    },

    initProfitChart() {
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('profitChart'));
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const ink = this.chartInk();
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(0, 211, 242, 0.30)');
        gradient.addColorStop(1, 'rgba(0, 211, 242, 0)');

        this.profitChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Profit',
                    data: [],
                    borderColor: ink.acc,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.15,
                    borderWidth: 2.2,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    pointRadius: 0,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (ctx) => Utils.formatCurrency(ctx.parsed.y, this.chartState.currency)
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { color: ink.tick, font: { size: 11 }, maxTicksLimit: 10 } },
                    y: {
                        position: 'right',
                        grid: { color: ink.grid, lineWidth: 1, drawTicks: false },
                        border: { display: false },
                        ticks: {
                            color: ink.tick,
                            font: { size: 11 },
                            callback: (value) => Utils.formatCurrency(value, this.chartState.currency)
                        }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    },

    renderProfitChart() {
        if (!this.profitChart) return;
        const curr = this.chartState.currency;
        const timeline = this.service.getHistoricalTimeline(this.chartState.profitRange, 'VALUE', curr);

        this.profitChart.data.labels = timeline.labels;
        this.profitChart.data.datasets[0].data = timeline.profitValues;
        const ink = this.chartInk();
        if (this.profitChart.options && this.profitChart.options.scales) {
            this.profitChart.options.scales.y.grid.color = ink.grid;
            this.profitChart.options.scales.y.ticks.color = ink.tick;
            this.profitChart.options.scales.x.ticks.color = ink.tick;
        }
        this.profitChart.update();

        if (timeline.profitRangeStats) {
            Object.entries(timeline.profitRangeStats).forEach(([rangeKey, val]) => {
                const el = document.querySelector(`[data-profit-range-val="${rangeKey}"]`);
                if (el) {
                    el.textContent = (val >= 0 ? '+' : '') + Utils.formatCurrency(val, curr);
                    el.className = `value ${val >= 0 ? 'text-green' : 'text-red'}`;
                }
            });
        }
    },

    renderYearlyTable() {
        const tbody = document.getElementById('yearlyTableBody');
        if (!tbody) return;

        const curr = this.chartState.currency;
        const perf = this.service.getYearlyPerformance(curr);
        const rows = perf.ytd ? [perf.ytd, ...perf.years] : perf.years;

        tbody.innerHTML = rows.length ? rows.map(r => {
            const isPositive = r.profit >= 0;
            return `
                <tr>
                    <td style="font-weight:600;">${r.label}</td>
                    <td class="${isPositive ? 'text-green' : 'text-red'}">${Utils.formatPercent(r.percent)}</td>
                    <td class="${isPositive ? 'text-green' : 'text-red'}">${isPositive ? '+' : ''}${Utils.formatCurrency(r.profit, curr)}</td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-secondary);">Aucune donnée.</td></tr>';
    },

    initAnalysisCharts() {
        const makeDoughnut = (canvasId) => {
            const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById(canvasId));
            if (!canvas) return null;
            return new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: { legend: { display: false } }
                }
            });
        };

        this.assetChart = makeDoughnut('assetChart');
        this.classChart = makeDoughnut('classChart');
        this.currencyChart = makeDoughnut('currencyChart');
        this.sectorChart = makeDoughnut('sectorChart');
        this.sectorCache = this.sectorCache || {};
        this.initDonutCarousel();
    },

    initDonutCarousel() {
        const track = document.getElementById('donutCarousel');
        const dotsEl = document.getElementById('donutDots');
        if (!track || !dotsEl || dotsEl.children.length) return;

        const cards = Array.from(track.querySelectorAll('.analysis-card'));
        cards.forEach((_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            if (i === 0) b.classList.add('active');
            b.addEventListener('click', () => {
                cards[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            });
            dotsEl.appendChild(b);
        });

        let raf;
        track.addEventListener('scroll', () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
                let active = 0, best = Infinity;
                cards.forEach((c, i) => {
                    const r = c.getBoundingClientRect();
                    const d = Math.abs(r.left + r.width / 2 - mid);
                    if (d < best) { best = d; active = i; }
                });
                Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle('active', i === active));
            });
        }, { passive: true });
    },

    updateDoughnutChart(chart, legendId, totals, emptyLabel, centerConfig) {
        if (!chart) return;
        const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((sum, [, v]) => sum + v, 0);
        const colors = entries.map((_, i) => CONFIG.CHART_PALETTE[i % CONFIG.CHART_PALETTE.length]);

        chart.data.labels = entries.map(([label]) => label);
        chart.data.datasets[0].data = entries.map(([, v]) => v);
        chart.data.datasets[0].backgroundColor = colors;
        chart.update();

        const legendEl = document.getElementById(legendId);
        if (legendEl) {
            legendEl.innerHTML = entries.length ? entries.map(([label, v], i) => {
                const pct = total > 0 ? (v / total) * 100 : 0;
                return `
                    <li>
                        <span class="dot" style="background:${colors[i]};"></span>
                        <span class="label">${label}</span>
                        <span class="pct">${pct.toFixed(1)}%</span>
                    </li>
                `;
            }).join('') : `<li style="color:var(--text-secondary);">${emptyLabel || 'Aucune position active.'}</li>`;
        }

        if (centerConfig && centerConfig.el) {
            const el = centerConfig.el;
            if (!entries.length) {
                el.innerHTML = '';
            } else if (centerConfig.value !== undefined) {
                el.innerHTML = `<span class="ccl-value">${centerConfig.value}</span><span class="ccl-label">${centerConfig.label || ''}</span>`;
            } else {
                const [topLabel, topVal] = entries[0];
                const pct = total > 0 ? (topVal / total) * 100 : 0;
                el.innerHTML = `<span class="ccl-value">${pct.toFixed(0)}%</span><span class="ccl-label">${topLabel}</span>`;
            }
        }
    },

    renderAnalysisCharts(stats, _curr) {
        const holdings = stats.holdings || [];

        const groupBy = (keyFn) => {
            const totals = {};
            holdings.forEach(h => {
                const key = keyFn(h);
                totals[key] = (totals[key] || 0) + h.valueUSD;
            });
            return totals;
        };

        const byAsset = groupBy(h => h.symbol);
        const byClass = groupBy(h => Utils.getAssetClass(h.symbol));
        const byCurrency = groupBy(h => h.currency);

        this.updateDoughnutChart(this.assetChart, 'assetLegend', byAsset, undefined, {
            el: document.getElementById('assetChartCenter'),
            value: Object.keys(byAsset).length,
            label: Object.keys(byAsset).length > 1 ? 'actifs' : 'actif'
        });
        this.updateDoughnutChart(this.classChart, 'classLegend', byClass, undefined, { el: document.getElementById('classChartCenter') });
        this.updateDoughnutChart(this.currencyChart, 'currencyLegend', byCurrency, undefined, { el: document.getElementById('currencyChartCenter') });

        this.refreshSectorChart(stats);
    },

    async refreshSectorChart(stats) {
        if (!this.sectorChart) return;
        const holdings = stats.holdings || [];
        this.sectorCache = this.sectorCache || {};

        const uniqueSymbols = [...new Set(holdings.map(h => h.symbol))].filter(s => !(s in this.sectorCache));
        if (uniqueSymbols.length) {
            await Promise.all(uniqueSymbols.map(async sym => {
                this.sectorCache[sym] = await APIService.getSector(sym);
            }));
        }

        const totals = {};
        holdings.forEach(h => {
            const sector = this.sectorCache[h.symbol] || 'Non disponible';
            totals[sector] = (totals[sector] || 0) + h.valueUSD;
        });

        this.updateDoughnutChart(this.sectorChart, 'sectorLegend', totals, 'Secteur indisponible (actions non-US).', { el: document.getElementById('sectorChartCenter') });
    },

    initChart() {
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('portfolioChart'));
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const ink = this.chartInk();
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
        const gradient = ctx.createLinearGradient(0, 0, 0, 350);
        gradient.addColorStop(0, 'rgba(46, 189, 133, 0.34)');
        gradient.addColorStop(1, 'rgba(46, 189, 133, 0)');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Portefeuille',
                    data: [],
                    borderColor: ink.up,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.15,
                    borderWidth: 2.2,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    pointRadius: 0,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: isDesktop,
                        position: 'top',
                        align: 'end',
                        labels: {
                            boxWidth: 12,
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (ctx) => {
                                const label = ctx.dataset.label || '';
                                const val = ctx.parsed.y;
                                if (this.chartState.mode === 'PERF') {
                                    return `${label}: ${Utils.formatPercent(val)}`;
                                }
                                return `${label}: ${Utils.formatCurrency(val, this.chartState.currency)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { display: isDesktop, color: ink.tick, font: { size: 11 }, maxTicksLimit: 10 }
                    },
                    y: {
                        position: 'right',
                        grid: { color: ink.grid, lineWidth: 1, drawTicks: false },
                        border: { display: false },
                        ticks: {
                            display: isDesktop,
                            color: ink.tick,
                            font: { size: 11 },
                            callback: (value) => {
                                if (this.chartState.mode === 'PERF') return Number(value).toFixed(1) + '%';
                                if (Math.abs(Number(value)) >= 1000) {
                                    return (Number(value) / 1000).toFixed(1) + 'k ' + (this.chartState.currency === 'EUR' ? '€' : '$');
                                }
                                return Number(value).toFixed(0) + ' ' + (this.chartState.currency === 'EUR' ? '€' : '$');
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    },

    async updateChart(timelineData) {
        if (!this.chart || !timelineData) return;

        const isPerf = this.chartState.mode === 'PERF';
        const primaryData = isPerf ? timelineData.perfValues : timelineData.values;
        const activePort = this.service.getActivePortfolio();
        const ink = this.chartInk();
        const lineColor = ink.up; // ligne portefeuille : vert fixe (non thematise)

        this.chart.data.labels = timelineData.labels;

        const ctx = this.chart.ctx;
        const gradient = ctx.createLinearGradient(0, 0, 0, 350);
        gradient.addColorStop(0, 'rgba(46, 189, 133, 0.34)');
        gradient.addColorStop(1, 'rgba(46, 189, 133, 0)');

        const lastIdx = (primaryData ? primaryData.length : 0) - 1;

        this.chart.data.datasets = [{
            label: activePort.name,
            data: primaryData,
            borderColor: lineColor,
            backgroundColor: isPerf ? 'transparent' : gradient,
            fill: !isPerf,
            tension: 0.15,
            borderWidth: 2.2,
            borderCapStyle: 'round',
            borderJoinStyle: 'round',
            pointRadius: (c) => c.dataIndex === lastIdx ? 3.4 : 0,
            pointBackgroundColor: lineColor,
            pointBorderColor: 'rgba(46, 189, 133, 0.16)',
            pointBorderWidth: 6,
            pointHoverRadius: 5,
            yAxisID: 'y'
        }];

        // Rafraichir les couleurs d'axes (suivi du theme)
        if (this.chart.options && this.chart.options.scales) {
            this.chart.options.scales.y.grid.color = ink.grid;
            this.chart.options.scales.y.ticks.color = ink.tick;
            this.chart.options.scales.x.ticks.color = ink.tick;
        }

        const benchmarks = this.chartState.benchmarks || [];
        const rawDates = timelineData.rawDates || [];

        // Hors mode Performance, l'axe porte des montants : y tracer un indice
        // boursier en devise native n'aurait aucun sens. Le mode est force a
        // l'activation d'un benchmark, mais l'utilisateur peut revenir sur Valeur.
        if (isPerf && benchmarks.length > 0 && rawDates.length > 0) {
            const startDate = Utils.parseDate(rawDates[0]);
            const endDate = Utils.parseDate(rawDates[rawDates.length - 1]);

            const benchHistories = await Promise.all(benchmarks.map(async symbol => {
                const benchConfig = CONFIG.BENCHMARKS[symbol];
                if (!benchConfig) return null;
                const history = await APIService.getDailyHistory(symbol, startDate, endDate, benchConfig.basePrice, benchConfig.basePrice);
                return { symbol, benchConfig, history };
            }));

            benchHistories.forEach(entry => {
                if (!entry) return;
                const { benchConfig, history } = entry;
                const sortedDates = Object.keys(history).sort();
                if (sortedDates.length === 0) return;

                // Forward-fill : le marche ne cote pas tous les jours calendaires (weekends, feries)
                let lastKnown = null;
                const rawSeries = rawDates.map(dateStr => {
                    if (history[dateStr] !== undefined) {
                        lastKnown = history[dateStr];
                    } else {
                        const prior = sortedDates.filter(d => d <= dateStr).pop();
                        if (prior !== undefined) lastKnown = history[prior];
                    }
                    return lastKnown;
                });

                const baseline = rawSeries.find(v => v !== null && v !== undefined);
                // La courbe du portefeuille n'est pas rebasee a 0 : elle affiche la
                // plus-value cumulee vs prix de revient. On cale donc le benchmark
                // sur son point de depart, sinon un portefeuille a +50 % semble
                // ecraser un indice a +2 % alors qu'il a peut-etre sous-performe.
                // Ainsi l'ecart lu entre les deux courbes est bien l'ecart de
                // performance sur la fenetre affichee.
                const offset = primaryData && primaryData.length ? (primaryData[0] || 0) : 0;
                const bData = rawSeries.map(v => (v === null || v === undefined || !baseline)
                    ? null
                    : parseFloat((offset + ((v / baseline) - 1) * 100).toFixed(2)));

                this.chart.data.datasets.push({
                    label: benchConfig.name,
                    data: bData,
                    borderColor: ink.tick,
                    borderDash: [4, 4],
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.15,
                    borderWidth: 1.4,
                    pointRadius: 0,
                    yAxisID: 'y',
                    spanGaps: true
                });
            });
        }

        this.chart.update();
    },
};
