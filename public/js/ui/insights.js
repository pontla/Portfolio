/**
 * Resume IA du portefeuille, dividendes estimes et calendrier des resultats.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { CONFIG, AI_PROVIDERS } from '../core/config.js';
import { Utils } from '../core/utils.js';
import { APIService } from '../core/api.js';

export const insights = {
    async refreshUpcomingDividends() {
        const listEl = document.getElementById('upcomingDividendsList');
        if (!listEl) return;

        const items = await this.service.getUpcomingDividends(this.chartState.currency);
        const curr = this.chartState.currency;

        listEl.innerHTML = items.length
            ? items
                  .map(
                      (d) => `
            <div class="perf-row">
                <img class="perf-logo" src="${this.getLogoUrl(d.symbol)}" alt=""
                    data-fallback="sibling">
                <span class="perf-logo-fallback" style="display:none;">${d.symbol.substring(0, 1)}</span>
                <span class="perf-ticker">${d.symbol}</span>
                <span style="flex:1; color:var(--text-secondary); font-size:13px;">${Utils.formatDateDisplay(d.estimatedDate)} (est.)</span>
                <span style="width:90px; text-align:right; font-weight:600; font-size:13px;">${Utils.formatCurrency(d.amount, curr)}</span>
                <span style="width:60px; text-align:right; color:var(--text-secondary); font-size:12px;">${d.yieldPercent.toFixed(2)}%</span>
            </div>
        `
                  )
                  .join('')
            : '<p style="text-align:center; padding:12px; color:var(--text-secondary);">Aucun dividende estimé dans les 45 prochains jours.</p>';
    },

    // Resume IA : tronque a 4 lignes par defaut si le texte est long (coherence de design),
    // avec un bouton "Afficher plus".
    renderInsightsSummary(text) {
        const safe = Utils.escapeHtml(text);
        if (text.length <= 220) return `<div class="insights-summary">${safe}</div>`;
        return `<div class="insights-summary">
            <div class="insights-summary-text is-clamped">${safe}</div>
            <button type="button" class="insights-summary-toggle">Afficher plus</button>
        </div>`;
    },

    renderInsightsGroups(groups) {
        if (!groups.length)
            return '<p style="color:var(--text-secondary);">Aucun événement notable détecté.</p>';

        const sorted = groups.slice().sort((a, b) => {
            const dateA = a.items.reduce(
                (max, it) => (it.date && it.date > max ? it.date : max),
                ''
            );
            const dateB = b.items.reduce(
                (max, it) => (it.date && it.date > max ? it.date : max),
                ''
            );
            return dateB.localeCompare(dateA);
        });

        return (
            '<div class="insights-carousel">' +
            sorted
                .map((g) => {
                    const [firstItem, ...restItems] = g.items;

                    return `
            <div class="insights-group">
                <div class="insights-group-header">
                    <img class="insights-logo" src="${this.getLogoUrl(g.symbol)}" alt=""
                        data-fallback="sibling">
                    <span class="insights-logo-fallback" style="display:none;">${g.symbol.substring(0, 1)}</span>
                    <span class="insights-group-title">${Utils.escapeHtml(g.symbol)}</span>
                    ${g.name ? `<span class="insights-group-name">${Utils.escapeHtml(g.name)}</span>` : ''}
                </div>
                <div class="insights-item" style="border-bottom:none;">
                    <div class="insights-item-title">${Utils.escapeHtml(firstItem.title)}</div>
                </div>
                <div class="insights-more" style="display:none;">
                    <div class="insights-item">
                        ${firstItem.detail ? `<div class="insights-item-detail">${Utils.escapeHtml(firstItem.detail)}</div>` : ''}
                    </div>
                    ${restItems
                        .map(
                            (it) => `
                        <div class="insights-item">
                            <div class="insights-item-title">${Utils.escapeHtml(it.title)}</div>
                            ${it.detail ? `<div class="insights-item-detail">${Utils.escapeHtml(it.detail)}</div>` : ''}
                        </div>
                    `
                        )
                        .join('')}
                </div>
                ${
                    firstItem.detail || restItems.length
                        ? `
                    <button type="button" class="insights-toggle-btn">Afficher plus</button>
                `
                        : ''
                }
            </div>
        `;
                })
                .join('') +
            '</div>'
        );
    },

    setInsightsUpdatedAt(ts) {
        const el = document.getElementById('insightsUpdatedAt');
        if (!el) return;
        if (!ts) {
            el.hidden = true;
            return;
        }
        const diff = Math.max(0, Date.now() - ts);
        const min = Math.floor(diff / 60000);
        let label;
        if (min < 1) label = "à l'instant";
        else if (min < 60) label = `il y a ${min} min`;
        else if (min < 1440) label = `il y a ${Math.floor(min / 60)} h`;
        else label = `il y a ${Math.floor(min / 1440)} j`;
        el.textContent = label;
        el.hidden = false;
    },

    async refreshPortfolioInsights(force = false) {
        const bodyEl = document.getElementById('portfolioInsightsBody');
        if (!bodyEl) return;

        const stats = this.service.calculatePortfolio('USD');
        const holdings = stats.holdings.filter((h) => !h.symbol.startsWith('$'));
        if (!holdings.length) {
            bodyEl.innerHTML =
                '<p style="color:var(--text-secondary);">Aucune position à analyser.</p>';
            return;
        }

        const symbols = holdings.map((h) => h.symbol);
        const provider = this.service.aiProvider;
        const hasKey = !!provider && (this.service.aiConfigured || []).includes(provider);
        const cacheKey = `${hasKey ? 'ai-' + provider : 'plain'}:${symbols.slice().sort().join(',')}`;

        if (!force) {
            try {
                const cached = JSON.parse(
                    localStorage.getItem(CONFIG.INSIGHTS_CACHE_STORAGE) || 'null'
                );
                if (
                    cached &&
                    cached.cacheKey === cacheKey &&
                    Date.now() - cached.timestamp < 6 * 3600 * 1000
                ) {
                    bodyEl.innerHTML = cached.html;
                    this.setInsightsUpdatedAt(cached.timestamp);
                    return;
                }
            } catch (e) {
                /* cache corrompu, on ignore */
            }
        }

        if (!provider || !hasKey || !AI_PROVIDERS[provider]) {
            const html = await this.buildPlainInsights(holdings);
            bodyEl.innerHTML = html;
            localStorage.setItem(
                CONFIG.INSIGHTS_CACHE_STORAGE,
                JSON.stringify({ cacheKey, timestamp: Date.now(), html })
            );
            this.setInsightsUpdatedAt(Date.now());
            return;
        }

        bodyEl.innerHTML = '<p style="color:var(--text-secondary);">Analyse en cours...</p>';
        try {
            const namesList = await Promise.all(
                symbols.map(async (s) => {
                    const name =
                        this.assetNameCache[s] !== undefined
                            ? this.assetNameCache[s]
                            : await this.fetchAssetName(s);
                    this.assetNameCache[s] = name;
                    return name ? `${s} (${name})` : s;
                })
            );

            const monthly = this.service.getMonthlyPerformanceSummary('USD');
            const monthlyFacts = `Performance du portefeuille sur les 30 derniers jours : ${monthly.portfolioPercent >= 0 ? '+' : ''}${monthly.portfolioPercent.toFixed(2)}%.
Titres en hausse sur la période : ${monthly.topGainers.length ? monthly.topGainers.map((m) => `${m.symbol} ${m.changePercent >= 0 ? '+' : ''}${m.changePercent.toFixed(2)}%`).join(', ') : 'aucun'}.
Titres en baisse sur la période : ${monthly.topLosers.length ? monthly.topLosers.map((m) => `${m.symbol} ${m.changePercent.toFixed(2)}%`).join(', ') : 'aucun'}.`;

            let webContext = '';
            if (!AI_PROVIDERS[provider].usesLiveSearch) {
                webContext = await this.fetchWebNewsContext(symbols, namesList);
            }
            const webContextBlock = webContext
                ? `\n\nExtraits d'actualités récentes trouvés sur le web pour ces titres (source réelle, utilise-les tels quels et ne les invente pas, ignore les extraits hors-sujet) :\n${webContext}\n`
                : '';

            const prompt = `Voici mon portefeuille d'investissement : ${namesList.join(', ')}.

Données chiffrées exactes de mon portefeuille sur les 30 derniers jours (utilise CES chiffres tels quels, ne les recalcule pas) :
${monthlyFacts}
${webContextBlock}
Cherche les actualités récentes et importantes (résultats trimestriels avec chiffres précis, annonces majeures, changements de direction, mouvements de marché notables, procédures judiciaires ou réglementaires...) ainsi que les événements à venir (prochaine publication de résultats, prochain dividende) pour CHACUN de ces titres.

Réponds UNIQUEMENT avec un objet JSON valide (pas de texte avant/après, pas de bloc markdown \`\`\`), au format exact suivant :
{
  "summary": "Un paragraphe de 2 à 4 phrases, ton dynamique et personnel (tutoiement, style 'Très belle performance ce mois-ci avec +3%, portée par Apple et Microsoft, déception de Meta après un T3 décevant...'). Commence par la performance globale du mois (utilise le chiffre exact fourni), cite les titres qui l'ont le plus tirée vers le haut et vers le bas avec leur %, et explique brièvement le POURQUOI de ces mouvements en t'appuyant sur les actualités trouvées (résultats, annonces...).",
  "portfolio": [
    {
      "symbol": "TICKER",
      "items": [
        { "date": "AAAA-MM-JJ", "title": "Titre court et percutant de l'actualité", "detail": "2 à 4 phrases détaillées et informatives : chiffres précis, dates, contexte, impact. En français." }
      ]
    }
  ]
}

Pour chaque titre du portefeuille, donne 2 à 4 actualités/événements les plus pertinents et récents, avec le maximum de détails concrets (chiffres, dates, pourcentages). Trie les items de chaque titre du plus récent au plus ancien. "date" est la date de l'actualité ou de l'événement (format AAAA-MM-JJ). N'inclus un titre que si tu as trouvé une information réelle et récente à son sujet.`;

            const text = await APIService.aiInsights(
                provider,
                prompt,
                AI_PROVIDERS[provider].usesLiveSearch
            );

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('Réponse IA non structurée (pas de JSON trouvé)');
            const parsed = JSON.parse(jsonMatch[0]);

            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            const sixMonthsAgoStr = Utils.getDateString(sixMonthsAgo);

            const groups = (parsed.portfolio || [])
                .map((g) => ({
                    symbol: g.symbol,
                    name: this.assetNameCache[g.symbol],
                    items: (g.items || [])
                        // Dates produites par le modele : format non garanti.
                        .filter(
                            (it) => !it.date || Utils.compareDates(it.date, sixMonthsAgoStr) >= 0
                        )
                        .slice()
                        .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
                }))
                .filter((g) => g.items.length);

            const summaryHtml = parsed.summary ? this.renderInsightsSummary(parsed.summary) : '';
            let groupsHtml;
            let usedPlainFallback = false;
            if (groups.length) {
                groupsHtml = this.renderInsightsGroups(groups);
            } else {
                const plainGroups = await this.getPlainInsightsGroups(holdings);
                groupsHtml = this.renderInsightsGroups(plainGroups);
                usedPlainFallback = true;
            }

            const staleNoticeHtml =
                AI_PROVIDERS[provider].usesLiveSearch || webContext
                    ? ''
                    : `<div class="insights-stale-notice">⚠️ Aucune actualité web trouvée pour compléter ${AI_PROVIDERS[provider].label} : ces informations viennent des connaissances internes du modèle et peuvent dater de plusieurs mois.${usedPlainFallback ? ' Infos factuelles (sans IA) affichées à la place ci-dessous.' : ''}</div>`;

            const html = staleNoticeHtml + summaryHtml + groupsHtml;
            bodyEl.innerHTML = html;
            localStorage.setItem(
                CONFIG.INSIGHTS_CACHE_STORAGE,
                JSON.stringify({ cacheKey, timestamp: Date.now(), html })
            );
            this.setInsightsUpdatedAt(Date.now());
        } catch (err) {
            console.warn('Erreur résumé IA', err);
            const fallback = await this.buildPlainInsights(holdings);
            bodyEl.innerHTML =
                `<p style="color:var(--accent-red); font-size:12px;">Résumé IA indisponible (${Utils.escapeHtml(err.message)}). Résumé factuel affiché à la place :</p>` +
                fallback;
            this.setInsightsUpdatedAt(Date.now());
        }
    },

    async getPlainInsightsGroups(holdings) {
        const symbols = holdings.map((h) => h.symbol);
        const [dividends, earnings] = await Promise.all([
            this.service.getUpcomingDividends(this.chartState.currency),
            this.service.getUpcomingEarnings(),
        ]);
        const { gainers, losers } = this.service.getDailyMovers(this.chartState.currency);

        const bySymbol = {};
        const ensure = (symbol) => {
            if (!bySymbol[symbol])
                bySymbol[symbol] = { symbol, name: this.assetNameCache[symbol], items: [] };
            return bySymbol[symbol];
        };

        const today = Utils.getDateString();

        [...gainers, ...losers].forEach((m) => {
            ensure(m.symbol).items.push({
                date: today,
                title: `${m.dayChangePercent >= 0 ? '+' : ''}${m.dayChangePercent.toFixed(2)}% aujourd'hui`,
                detail: `Le titre ${m.symbol} évolue de ${m.dayChangePercent >= 0 ? '+' : ''}${m.dayChangePercent.toFixed(2)}% sur la séance.`,
            });
        });

        earnings.forEach((e) => {
            ensure(e.symbol).items.push({
                date: e.date,
                title: `Résultats prévus le ${Utils.formatDateDisplay(e.date)}`,
                detail:
                    e.epsEstimate !== null
                        ? `BPA (bénéfice par action) estimé par les analystes : ${e.epsEstimate}.`
                        : '',
            });
        });

        dividends.forEach((d) => {
            ensure(d.symbol).items.push({
                date: d.estimatedDate,
                title: `Dividende estimé le ${Utils.formatDateDisplay(d.estimatedDate)}`,
                detail: `Montant estimé : ${Utils.formatCurrency(d.amount, this.chartState.currency)}, sur la base du dernier versement connu et de la fréquence habituelle.`,
            });
        });

        Object.values(bySymbol).forEach((g) =>
            g.items.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        );

        return symbols.filter((s) => bySymbol[s]).map((s) => bySymbol[s]);
    },

    async buildPlainInsights(holdings) {
        const groups = await this.getPlainInsightsGroups(holdings);
        const noteHtml =
            '<div class="insights-plain-note">Résumé factuel généré sans IA. Ajoute une clé IA dans les paramètres pour une analyse complète.</div>';

        if (!groups.length) {
            return noteHtml;
        }

        return noteHtml + this.renderInsightsGroups(groups);
    },

    async refreshUpcomingEarnings() {
        const listEl = document.getElementById('upcomingEarningsList');
        if (!listEl) return;

        const items = await this.service.getUpcomingEarnings();

        listEl.innerHTML = items.length
            ? items
                  .map(
                      (e) => `
            <div class="perf-row">
                <img class="perf-logo" src="${this.getLogoUrl(e.symbol)}" alt=""
                    data-fallback="sibling">
                <span class="perf-logo-fallback" style="display:none;">${e.symbol.substring(0, 1)}</span>
                <span class="perf-ticker">${e.symbol}</span>
                <span style="flex:1; color:var(--text-secondary); font-size:13px;">${Utils.formatDateDisplay(e.date)}</span>
                <span style="width:110px; text-align:right; color:var(--text-secondary); font-size:12px;">${e.epsEstimate !== null ? `EPS est. ${e.epsEstimate}` : ''}</span>
            </div>
        `
                  )
                  .join('')
            : '<p style="text-align:center; padding:12px; color:var(--text-secondary);">Aucune publication de résultats prévue dans les 90 prochains jours (actions US uniquement).</p>';
    },
};
