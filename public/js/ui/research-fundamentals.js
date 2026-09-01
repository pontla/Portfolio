/**
 * Cartes fondamentales de l'Explorer : valorisation, croissance, sante financiere, rentabilite.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { Utils } from '../core/utils.js';
import { AnalysisUtils, AnalysisService } from '../core/analysis.js';

export const researchFundamentals = {
    renderResearchValuation(a) {
        const card = document.getElementById('researchValuationCard');
        const grid = document.getElementById('researchValuationGrid');
        const src = document.getElementById('researchValuationSrc');
        if (!card || !grid) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            return;
        }

        const v = a.valuation || {};
        const h = v.hist5y || {};
        const ND = 'Non disponible';
        const mult = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x) + ' ×';

        const kv = (label, valueStr, tip, cmpHtml = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${cmpHtml}</div>`;

        // Repere visuel : valeur courante vs moyenne 5 ans du titre.
        const cmp = (cur, avg) => {
            if (cur == null || avg == null || !isFinite(cur) || !isFinite(avg) || avg <= 0) return '';
            const above = cur > avg;
            return `<span class="kv-cmp ${above ? 'above' : 'below'}">${above ? '▲' : '▼'} ` +
                `${above ? 'au-dessus' : 'sous'} la moy. 5 ans (${mult(avg)})</span>`;
        };

        grid.innerHTML =
            kv('PER (TTM)', mult(v.peTTM),
                'Cours rapporté au bénéfice par action des 12 derniers mois. Plus il est élevé, plus le marché paie cher chaque euro de bénéfice.',
                cmp(v.peTTM, h.pe)) +
            kv('PER prévisionnel', mult(v.peForward),
                'Cours rapporté au bénéfice par action attendu sur les 12 prochains mois. Nettement sous le PER TTM : le marché anticipe une hausse des bénéfices.') +
            kv('PEG', mult(v.peg),
                'PER divisé par la croissance attendue du bénéfice. Sous 1 : la croissance n\'est pas encore payée ; au-dessus de 2 : valorisation tendue.') +
            kv('P/B', mult(v.pb),
                'Cours rapporté à la valeur comptable des capitaux propres. Pertinent surtout pour les sociétés à forts actifs (banques, industrie).',
                cmp(v.pb, h.pb)) +
            kv('P/S', mult(v.ps),
                'Cours rapporté au chiffre d\'affaires par action. Utile pour comparer des sociétés peu ou pas bénéficiaires.',
                cmp(v.ps, h.ps)) +
            kv('VE / EBITDA', mult(v.evEbitda),
                'Valeur d\'entreprise (capitalisation + dette nette) sur l\'EBITDA. Comparable entre sociétés à endettement différent ; repère 8-12 pour une société mûre.',
                cmp(v.evEbitda, h.evEbitda)) +
            kv('VE / CA', mult(v.evRevenue),
                'Valeur d\'entreprise sur le chiffre d\'affaires. Alternative au P/S qui tient compte de la dette.') +
            kv('Rendement FCF', v.fcfYield == null ? null : Utils.formatPercent(v.fcfYield, false),
                'Free cash flow annuel rapporté à la capitalisation : le rendement de trésorerie réelle dégagée. Au-dessus de 5 % est confortable.');

        if (src) {
            const hasHist = [h.pe, h.pb, h.ps, h.evEbitda].some(x => x != null);
            src.textContent = hasHist
                ? 'Yahoo Finance · moyennes 5 ans FMP'
                : (a.isUS ? 'Yahoo Finance · historique 5 ans indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Historique annuel en barres (CA, BPA) : echelle sur la plus grande valeur absolue,
    // variation d'une annee sur l'autre affichee a droite.
    _growthSeries(title, points, fmt, tip) {
        const vals = (points || []).map(p => p.value).filter(v => v != null && isFinite(v));
        const head = `<div class="gs-title">${title} ${this._kvHelp(tip)}</div>`;
        if (!vals.length) return `<div class="gs-block">${head}<div class="gs-empty">Non disponible</div></div>`;

        const max = Math.max(...vals.map(Math.abs)) || 1;
        const rows = points.map((p, i) => {
            const prev = i > 0 ? points[i - 1].value : null;
            let yoy = '<span class="gs-yoy"></span>';
            if (p.value != null && prev != null && prev > 0) {
                const g = (p.value - prev) / prev * 100;
                yoy = `<span class="gs-yoy ${g >= 0 ? 'up' : 'dn'}">${Utils.formatPercent(g)}</span>`;
            }
            const w = p.value == null ? 0 : Math.max(2, Math.abs(p.value) / max * 100);
            return `<div class="gs-row"><span class="gs-year">${p.year || '—'}</span>` +
                `<span class="gs-bar-wrap"><span class="gs-bar${p.value < 0 ? ' neg' : ''}" style="width:${w.toFixed(1)}%"></span></span>` +
                `<span class="gs-val">${p.value == null ? '—' : fmt(p.value)}</span>${yoy}</div>`;
        }).join('');
        return `<div class="gs-block">${head}${rows}</div>`;
    },

    renderResearchGrowth(a) {
        const card = document.getElementById('researchGrowthCard');
        const grid = document.getElementById('researchGrowthGrid');
        const series = document.getElementById('researchGrowthSeries');
        const src = document.getElementById('researchGrowthSrc');
        if (!card || !grid || !series) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            series.innerHTML = '';
            return;
        }

        const g = a.growth || {};
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x);
        const money = (x) => Utils.formatCompact(x, cur);
        const eps = (x) => Utils.formatCurrency(x, cur);

        const kv = (label, valueStr, tip) =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span></div>`;

        // Consensus : estimations annuelles FMP en priorite, sinon l'exercice +1 de Yahoo.
        const estAnnual = AnalysisUtils.arr(g.estimates);
        const lastRevYear = Number((AnalysisUtils.arr(g.revenueAnnual).slice(-1)[0] || {}).year) || 0;
        const nextEst = estAnnual.find(e => Number(e.year) > lastRevYear) || estAnnual[estAnnual.length - 1] || null;
        const yahooY1 = AnalysisUtils.arr(g.estimatesShortTerm).find(e => e.period === '+1y') || null;
        const estRev = (nextEst && nextEst.revenueAvg != null) ? nextEst.revenueAvg : (yahooY1 ? yahooY1.revenueAvg : null);
        const estEps = (nextEst && nextEst.epsAvg != null) ? nextEst.epsAvg : (yahooY1 ? yahooY1.epsAvg : null);
        const estYear = (nextEst && nextEst.year) || (yahooY1 && yahooY1.endDate ? String(yahooY1.endDate).slice(0, 4) : null);
        const analysts = g.analystCount != null ? g.analystCount
            : (nextEst && nextEst.analysts != null ? nextEst.analysts : (yahooY1 ? yahooY1.analysts : null));

        grid.innerHTML =
            kv('TCAC CA 5 ans', pct(g.revenueCagrPct),
                'Taux de croissance annuel moyen du chiffre d\'affaires sur 5 ans. Lisse les à-coups d\'une année isolée.') +
            kv('TCAC BPA 5 ans', pct(g.epsCagrPct),
                'Taux de croissance annuel moyen du bénéfice par action sur 5 ans. Au-dessus du TCAC du CA : les marges progressent.') +
            kv('Croissance CA (1 an)', pct(g.revenueGrowthYoyPct),
                'Variation du chiffre d\'affaires sur les 12 derniers mois par rapport aux 12 précédents.') +
            kv('Croissance BPA (1 an)', pct(g.epsGrowthYoyPct),
                'Variation du bénéfice par action sur les 12 derniers mois. Plus volatile que le CA (effets exceptionnels, rachats d\'actions).') +
            kv(`CA attendu${estYear ? ' ' + estYear : ''}`, estRev == null ? null : money(estRev),
                'Chiffre d\'affaires moyen attendu par les analystes pour le prochain exercice. Une prévision, pas un engagement.') +
            kv(`BPA attendu${estYear ? ' ' + estYear : ''}`, estEps == null ? null : eps(estEps),
                'Bénéfice par action moyen attendu par les analystes pour le prochain exercice. Sert de base au PER prévisionnel.') +
            kv('Analystes suivis', analysts == null ? null : String(Math.round(analysts)),
                'Nombre d\'analystes couvrant la valeur. Sous 5, le consensus est fragile et peut bouger fortement.') +
            kv('Guidance direction', g.guidance,
                'Objectifs communiqués par la direction. Non fournis par les sources gratuites utilisées ici : à vérifier dans le communiqué de résultats.');

        series.innerHTML =
            this._growthSeries('Chiffre d\'affaires', AnalysisUtils.arr(g.revenueAnnual), money,
                'Chiffre d\'affaires annuel publié sur les 5 derniers exercices. La barre est proportionnelle au plus haut de la période.') +
            this._growthSeries('Bénéfice par action', AnalysisUtils.arr(g.epsAnnual), eps,
                'Bénéfice par action annuel publié sur les 5 derniers exercices. Une barre rouge signale un exercice en perte.');

        if (src) {
            const hasHist = AnalysisUtils.arr(g.revenueAnnual).some(p => p.value != null);
            src.textContent = hasHist
                ? 'FMP · consensus analystes Yahoo Finance'
                : (a.isUS ? 'Historique annuel indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Seuils de lecture rapide des ratios de solidite financiere.
    // Volontairement explicites et ajustables : [borne "confortable", borne "vigilance"].
    // `dir` = 'high' quand une valeur elevee est bonne, 'low' quand elle est mauvaise.
    _healthFlag(value, ok, warn, dir) {
        if (value == null || !isFinite(value)) return '';
        const good = dir === 'high' ? value >= ok : value <= ok;
        const bad = dir === 'high' ? value < warn : value > warn;
        const cls = good ? 'ok' : (bad ? 'warn' : 'mid');
        const txt = good ? 'confortable' : (bad ? 'vigilance' : 'correct');
        return `<span class="kv-tag ${cls}">${txt}</span>`;
    },

    renderResearchHealth(a) {
        const card = document.getElementById('researchHealthCard');
        const grid = document.getElementById('researchHealthGrid');
        const series = document.getElementById('researchHealthSeries');
        const src = document.getElementById('researchHealthSrc');
        if (!card || !grid || !series) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            series.innerHTML = '';
            return;
        }

        const h = a.health || {};
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const money = (x) => Utils.formatCompact(x, cur);
        const ratio = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
        const mult = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x) + ' ×';

        const kv = (label, valueStr, tip, tag = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${tag}</div>`;

        const netDebt = (h.totalDebt != null && h.totalCash != null) ? h.totalDebt - h.totalCash : null;

        grid.innerHTML =
            kv('Dette nette / EBITDA', mult(h.netDebtToEbitda),
                'Nombre d\'années d\'EBITDA nécessaires pour rembourser la dette nette. Sous 1 : très solide ; au-dessus de 3 : endettement lourd.',
                this._healthFlag(h.netDebtToEbitda, 1, 3, 'low')) +
            kv('Dette / Capitaux propres', ratio(h.debtToEquity),
                'Dette rapportée aux capitaux propres. Au-dessus de 2, la société dépend fortement de ses créanciers (normal pour les banques et les utilities).',
                this._healthFlag(h.debtToEquity, 1, 2, 'low')) +
            kv('Liquidité générale', ratio(h.currentRatio),
                'Actifs courants divisés par les dettes à moins d\'un an. Sous 1, la trésorerie court terme peut manquer.',
                this._healthFlag(h.currentRatio, 1.5, 1, 'high')) +
            kv('Liquidité réduite', ratio(h.quickRatio),
                'Même calcul en excluant les stocks, plus difficiles à transformer en cash. Sous 1 : dépendance aux ventes de stocks.',
                this._healthFlag(h.quickRatio, 1, 0.7, 'high')) +
            kv('Couverture des intérêts', mult(h.interestCoverage),
                'Résultat d\'exploitation divisé par les intérêts payés. Sous 3, la charge de la dette pèse ; au-dessus de 8, elle est indolore.',
                this._healthFlag(h.interestCoverage, 8, 3, 'high')) +
            kv('Trésorerie', h.totalCash == null ? null : money(h.totalCash),
                'Trésorerie et placements court terme au dernier bilan publié.') +
            kv('Dette totale', h.totalDebt == null ? null : money(h.totalDebt),
                'Dettes financières court et long terme au dernier bilan publié.') +
            kv('Dette nette', netDebt == null ? null : money(netDebt),
                'Dette totale moins la trésorerie. Négative : la société a plus de cash que de dettes.',
                netDebt == null ? '' : `<span class="kv-tag ${netDebt <= 0 ? 'ok' : 'mid'}">${netDebt <= 0 ? 'trésorerie nette' : 'endettée'}</span>`);

        const trendLabel = { croissant: 'en hausse', stable: 'stable', 'décroissant': 'en baisse' }[h.fcfTrend] || null;
        series.innerHTML = this._growthSeries(
            `Flux de trésorerie disponible${trendLabel ? ' — ' + trendLabel : ''}`,
            AnalysisUtils.arr(h.fcfHistory), money,
            'Cash restant après investissements sur les 5 derniers exercices. C\'est lui qui finance dividendes, rachats d\'actions et remboursement de dette.'
        );

        if (src) {
            const hasFcf = AnalysisUtils.arr(h.fcfHistory).some(p => p.value != null);
            src.textContent = hasFcf
                ? 'FMP · Yahoo Finance'
                : (a.isUS ? 'Historique de trésorerie indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Courbe miniature (SVG inline, compatible CSP) d'une serie annuelle.
    _sparkline(points) {
        const pts = AnalysisUtils.arr(points).filter(p => p.value != null && isFinite(p.value));
        if (pts.length < 2) return '';
        const w = 104, h = 26, pad = 3;
        const vals = pts.map(p => p.value);
        const min = Math.min(...vals);
        const span = (Math.max(...vals) - min) || 1;
        const coords = pts.map((p, i) => {
            const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
            const y = h - pad - ((p.value - min) / span) * (h - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${coords}"/></svg>`;
    },

    // Ligne "marge X : courbe 5 ans + niveau actuel + variation en points de %".
    _sparkRow(label, points, tip) {
        const pts = AnalysisUtils.arr(points).filter(p => p.value != null && isFinite(p.value));
        const head = `<span class="spark-lab">${label} ${this._kvHelp(tip)}</span>`;
        if (pts.length < 2) {
            return `<div class="spark-row">${head}<span class="spark-empty">Non disponible</span></div>`;
        }
        const first = pts[0].value;
        const last = pts[pts.length - 1].value;
        const d = last - first;
        const delta = `${d >= 0 ? '+' : '−'}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Math.abs(d))} pts`;
        return `<div class="spark-row">${head}${this._sparkline(pts)}` +
            `<span class="spark-val">${Utils.formatPercent(last, false)}</span>` +
            `<span class="spark-delta ${d >= 0 ? 'up' : 'dn'}" title="${pts[0].year} → ${pts[pts.length - 1].year}">${delta}</span></div>`;
    },

    renderResearchProfitability(a) {
        const card = document.getElementById('researchProfitCard');
        const grid = document.getElementById('researchProfitGrid');
        const sparks = document.getElementById('researchProfitSparks');
        const src = document.getElementById('researchProfitSrc');
        if (!card || !grid || !sparks) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            sparks.innerHTML = '';
            return;
        }

        const p = a.profitability || {};
        const mh = p.marginHistory || {};
        const ND = 'Non disponible';
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x, false);

        const kv = (label, valueStr, tip, tag = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${tag}</div>`;

        // Un denominateur negatif rend le ROE (et parfois le ROIC) trompeur : on
        // affiche la raison au lieu d'un pourcentage flatteur assorti d'une
        // pastille verte, pour rester coherent avec la notation et l'analyse IA.
        const prof = AnalysisService._profitabilityFlags(a);
        const NS = 'Non significatif';

        grid.innerHTML =
            kv('ROE', prof.roeReliable ? pct(p.roe) : (p.roe == null ? null : NS),
                'Résultat net rapporté aux capitaux propres : ce que la société génère avec l\'argent des actionnaires. Au-dessus de 15 % durablement, c\'est solide.' +
                (prof.roeReliable ? '' : ' Ici les fonds propres sont négatifs : le ratio change de signe et n\'est plus interprétable.'),
                prof.roeReliable ? this._healthFlag(p.roe, 15, 8, 'high') : '') +
            kv('ROA', pct(p.roa),
                'Résultat net rapporté au total du bilan : rentabilité de l\'ensemble des actifs, dette comprise. Moins flatteur que le ROE mais moins manipulable.',
                this._healthFlag(p.roa, 8, 3, 'high')) +
            kv('ROIC', prof.roicReliable ? pct(p.roic) : (p.roic == null ? null : NS),
                'Rentabilité du capital réellement investi (dette + fonds propres). S\'il dépasse durablement le coût du capital (~8-10 %), la société crée de la valeur.' +
                (prof.roicReliable ? '' : ' Ici le capital investi est négatif : le ratio n\'est plus interprétable.'),
                prof.roicReliable ? this._healthFlag(p.roic, 12, 6, 'high') : '') +
            kv('Marge brute', pct(p.grossMargin),
                'Part du chiffre d\'affaires restante après le coût de production. Une marge brute élevée et stable est un bon indice de pouvoir de fixation des prix.') +
            kv('Marge opérationnelle', pct(p.operatingMargin),
                'Part du chiffre d\'affaires restante après tous les coûts d\'exploitation. Mesure l\'efficacité du métier, hors dette et impôts.') +
            kv('Marge nette', pct(p.netMargin),
                'Part du chiffre d\'affaires qui finit en résultat net, une fois tout payé.');

        sparks.innerHTML =
            this._sparkRow('Marge brute (5 ans)', mh.gross,
                'Évolution de la marge brute sur les 5 derniers exercices. En hausse : les prix ou le mix produit s\'améliorent.') +
            this._sparkRow('Marge opérationnelle (5 ans)', mh.operating,
                'Évolution de la marge opérationnelle sur 5 ans. Une érosion continue signale une pression concurrentielle ou des coûts qui dérapent.') +
            this._sparkRow('Marge nette (5 ans)', mh.net,
                'Évolution de la marge nette sur 5 ans. Variation exprimée en points de pourcentage entre le premier et le dernier exercice.');

        if (src) {
            const hasHist = AnalysisUtils.arr(mh.net).some(x => x.value != null);
            src.textContent = hasHist
                ? 'Yahoo Finance · historique de marges FMP'
                : (a.isUS ? 'Yahoo Finance · historique de marges indisponible' : 'Historique complet : actions US uniquement');
        }
    },
};
