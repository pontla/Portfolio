/**
 * Cartes de marche de l'Explorer : sentiment, technique, dividende, score, analyse IA, pairs, profil.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { CONFIG, AI_PROVIDERS } from '../core/config.js';
import { Utils } from '../core/utils.js';
import { APIService } from '../core/api.js';
import { AnalysisUtils, AnalysisService } from '../core/analysis.js';

export const researchMarket = {
    // Repartition des recommandations analystes en barre empilee + legende chiffree.
    _consensusBar(c) {
        const defs = [
            ['sb', 'Achat fort', 'strongBuy'],
            ['b', 'Achat', 'buy'],
            ['h', 'Conserver', 'hold'],
            ['s', 'Vente', 'sell'],
            ['ss', 'Vente forte', 'strongSell'],
        ];
        const vals = defs.map(([cls, lab, key]) => ({ cls, lab, n: Number(c && c[key]) || 0 }));
        const total = vals.reduce((s, v) => s + v.n, 0);
        const head = `<div class="sent-title">Recommandations des analystes ${this._kvHelp("Nombre d'analystes derrière chaque recommandation. Un consensus très majoritairement à l'achat est souvent déjà intégré dans le cours.")}</div>`;
        if (!total)
            return `<div class="sent-block">${head}<div class="sent-empty">Non disponible</div></div>`;
        const bar = vals
            .map((v) =>
                v.n
                    ? `<span class="cons-seg ${v.cls}" style="width:${((v.n / total) * 100).toFixed(1)}%" title="${v.lab} : ${v.n}"></span>`
                    : ''
            )
            .join('');
        const legend = vals
            .filter((v) => v.n)
            .map(
                (v) =>
                    `<span class="cons-leg"><span class="cons-dot cons-seg ${v.cls}"></span>${v.lab} <b>${v.n}</b></span>`
            )
            .join('');
        return (
            `<div class="sent-block">${head}<div class="cons-bar">${bar}</div>` +
            `<div class="cons-legend">${legend}</div></div>`
        );
    },

    // Echelle objectif bas / moyen / haut, avec le cours actuel positionne dessus.
    _ptScale(s, price, cur) {
        const head = `<div class="sent-title">Objectif de cours à 12 mois ${this._kvHelp("Fourchette des objectifs publiés par les analystes. Le repère clair est le cours actuel, le repère cyan l'objectif moyen.")}</div>`;
        const lo = s.targetLow,
            hi = s.targetHigh,
            avg = s.targetMean;
        if (lo == null || hi == null || hi <= lo) {
            return `<div class="sent-block">${head}<div class="sent-empty">Non disponible</div></div>`;
        }
        const min = Math.min(lo, price != null ? price : lo);
        const max = Math.max(hi, price != null ? price : hi);
        const span = max - min || 1;
        const pos = (v) => ((v - min) / span) * 100;
        const money = (v) => Utils.formatCurrency(v, cur);
        const marks =
            `<span class="pt-span" style="left:${pos(lo).toFixed(1)}%;width:${(pos(hi) - pos(lo)).toFixed(1)}%"></span>` +
            (price != null
                ? `<span class="pt-mark cur" style="left:${pos(price).toFixed(1)}%" title="Cours actuel ${money(price)}"></span>`
                : '') +
            (avg != null
                ? `<span class="pt-mark avg" style="left:${pos(avg).toFixed(1)}%" title="Objectif moyen ${money(avg)}"></span>`
                : '');
        return (
            `<div class="sent-block">${head}<div class="pt-track">${marks}</div>` +
            `<div class="pt-legend"><span>Bas <b>${money(lo)}</b></span>` +
            `<span>Moyen <b>${avg == null ? '—' : money(avg)}</b></span>` +
            `<span>Haut <b>${money(hi)}</b></span></div></div>`
        );
    },

    renderResearchSentiment(a) {
        const card = document.getElementById('researchSentimentCard');
        const grid = document.getElementById('researchSentimentGrid');
        const top = document.getElementById('researchSentimentTop');
        const src = document.getElementById('researchSentimentSrc');
        if (!card || !grid || !top) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML =
                '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            top.innerHTML = '';
            return;
        }

        const s = a.sentiment || {};
        const price = (a.price && a.price.current) != null ? a.price.current : null;
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const money = (x) => (x == null || !isFinite(x) ? null : Utils.formatCurrency(x, cur));
        const pct = (x) => (x == null || !isFinite(x) ? null : Utils.formatPercent(x, false));
        const num1 = (x) =>
            x == null || !isFinite(x)
                ? null
                : new Intl.NumberFormat('fr-FR', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                  }).format(x);

        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;

        // Consensus : libelle Yahoo si present, sinon deduit de la note moyenne (1 = achat fort, 5 = vente forte).
        const keyMap = {
            strong_buy: 'Achat fort',
            buy: 'Achat',
            hold: 'Conserver',
            underperform: 'Sous-performance',
            sell: 'Vente',
            strong_sell: 'Vente forte',
        };
        const m = s.recommendationMean;
        let consLabel = keyMap[s.recommendationKey] || null;
        if (!consLabel && m != null) {
            consLabel =
                m <= 1.5
                    ? 'Achat fort'
                    : m <= 2.5
                      ? 'Achat'
                      : m <= 3.5
                        ? 'Conserver'
                        : m <= 4.5
                          ? 'Vente'
                          : 'Vente forte';
        }
        let consTag = '';
        if (m != null) {
            const cls = m <= 2.5 ? 'ok' : m <= 3.5 ? 'mid' : 'warn';
            consTag = `<span class="kv-tag ${cls}">${cls === 'ok' ? 'favorable' : cls === 'mid' ? 'neutre' : 'défavorable'}</span>`;
        }
        if (consLabel && s.analystCount != null) consLabel += ` (${s.analystCount} analystes)`;

        // Potentiel = ecart entre l'objectif moyen et le cours actuel.
        const upside =
            s.targetMean != null && price ? ((s.targetMean - price) / price) * 100 : null;
        const upsideTag =
            upside == null
                ? ''
                : `<span class="kv-cmp ${upside >= 0 ? 'up' : 'dn'}">potentiel ${Utils.formatPercent(upside)}</span>`;

        const shortPct = s.shortPercentOfFloat;
        const shortTag =
            shortPct == null
                ? ''
                : `<span class="kv-tag ${shortPct < 5 ? 'ok' : shortPct <= 10 ? 'mid' : 'warn'}">` +
                  `${shortPct < 5 ? 'faible' : shortPct <= 10 ? 'modérée' : 'élevée'}</span>`;

        const ins = s.insider;
        let insStr = null,
            insTag = '';
        if (ins && (ins.bought || ins.sold)) {
            insStr = `${Utils.formatCompact(ins.net)} titres`;
            insTag =
                `<span class="kv-cmp ${ins.net >= 0 ? 'up' : 'dn'}">` +
                `${Utils.formatCompact(ins.bought)} achetés / ${Utils.formatCompact(ins.sold)} vendus</span>`;
        }

        top.innerHTML = this._consensusBar(s.consensus) + this._ptScale(s, price, cur);

        grid.innerHTML =
            kv(
                'Consensus analystes',
                consLabel,
                'Recommandation majoritaire des analystes qui suivent la valeur. Indicatif : le consensus est souvent en retard sur le marché.',
                consTag
            ) +
            kv(
                'Note moyenne',
                m == null ? null : `${num1(m)} / 5`,
                'Moyenne des recommandations sur une échelle de 1 (achat fort) à 5 (vente forte). Sous 2,5 le consensus est acheteur.'
            ) +
            kv(
                'Objectif moyen',
                money(s.targetMean),
                'Moyenne des objectifs de cours à 12 mois. À relativiser : les objectifs sont révisés après coup, rarement avant.',
                upsideTag
            ) +
            kv(
                'Objectif médian',
                money(s.targetMedian),
                "Objectif du milieu de la fourchette : moins sensible qu'une moyenne aux prévisions extrêmes."
            ) +
            kv(
                "Fourchette d'objectifs",
                s.targetLow == null || s.targetHigh == null
                    ? null
                    : `${money(s.targetLow)} – ${money(s.targetHigh)}`,
                'Objectif le plus bas et le plus haut publiés. Un écart très large signale un désaccord profond sur la valeur.'
            ) +
            kv(
                "Révisions d'objectif",
                s.ptRevisions == null ? null : s.ptRevisions,
                "Sens des révisions d'objectifs sur les 3 derniers mois. Non fourni par les sources gratuites utilisées ici."
            ) +
            kv(
                'Détention institutionnelle',
                pct(s.institutionalOwnership),
                'Part du capital détenue par les fonds et investisseurs professionnels. Très élevée : les mouvements de flux peuvent amplifier les variations.'
            ) +
            kv(
                'Détention initiés',
                pct(s.insiderOwnership),
                'Part du capital détenue par les dirigeants et administrateurs. Une part significative aligne leurs intérêts sur ceux des actionnaires.'
            ) +
            kv(
                "Transactions d'initiés",
                insStr,
                'Solde net des achats et ventes déclarés par les dirigeants sur les 6 derniers mois. Des ventes sont fréquentes (rémunération en actions) ; les achats sont plus significatifs.',
                insTag
            ) +
            kv(
                'Vente à découvert',
                pct(shortPct),
                'Part du flottant vendue à découvert : les parieurs à la baisse. Au-dessus de 10 %, le pessimisme est marqué (et un rebond peut être violent).',
                shortTag
            ) +
            kv(
                'Jours de rachat',
                s.shortRatio == null ? null : `${num1(s.shortRatio)} j`,
                'Nombre de séances nécessaires aux vendeurs à découvert pour racheter leurs positions au volume habituel. Élevé : risque de "short squeeze".'
            );

        if (src) {
            const hasReco = !!(s.consensus || s.recommendationKey || s.targetMean != null);
            src.textContent = hasReco
                ? 'Yahoo Finance · consensus Finnhub'
                : a.isUS
                  ? 'Consensus analystes indisponible'
                  : 'Consensus analystes : actions US uniquement';
        }
    },

    // Jauge horizontale bornee (RSI, position dans un range) : trait = valeur courante.
    _gauge(title, tip, value, min, max, legend, cls = '') {
        const head = `<div class="sent-title">${title} ${this._kvHelp(tip)}</div>`;
        if (value == null || !isFinite(value)) {
            return `<div class="sent-block">${head}<div class="sent-empty">Non disponible</div></div>`;
        }
        const p = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
        return (
            `<div class="sent-block">${head}` +
            `<div class="gauge-track ${cls}"><span class="gauge-mark" style="left:${p.toFixed(1)}%"></span></div>` +
            `<div class="gauge-legend">${legend}</div></div>`
        );
    },

    renderResearchTechnical(a) {
        const card = document.getElementById('researchTechCard');
        const grid = document.getElementById('researchTechGrid');
        const top = document.getElementById('researchTechTop');
        const src = document.getElementById('researchTechSrc');
        if (!card || !grid || !top) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML =
                '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            top.innerHTML = '';
            return;
        }

        const t = a.technical;
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';

        if (!t) {
            top.innerHTML = '';
            grid.innerHTML = `<div class="research-kv"><span class="v">${ND}</span></div>`;
            if (src) src.textContent = 'Historique de cours insuffisant';
            return;
        }

        const money = (x) => (x == null || !isFinite(x) ? null : Utils.formatCurrency(x, cur));
        const pct = (x) => (x == null || !isFinite(x) ? null : Utils.formatPercent(x));
        const num1 = (x) =>
            x == null || !isFinite(x)
                ? null
                : new Intl.NumberFormat('fr-FR', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                  }).format(x);

        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;
        const gap = (x) =>
            x == null
                ? ''
                : `<span class="kv-cmp ${x >= 0 ? 'up' : 'dn'}">cours ${Utils.formatPercent(x)}</span>`;

        // Bloc gauche : rappel de l'overlay trace sur le graphe de cours.
        const maLegend =
            `<div class="sent-block"><div class="sent-title">Moyennes mobiles ${this._kvHelp('Cours moyen des 50 et 200 dernières séances, tracés sur le graphe ci-dessus. Le cours au-dessus des deux moyennes traduit une dynamique haussière.')}</div>` +
            `<div class="ma-legend">` +
            `<span class="ma-leg"><span class="ma-line"></span>MM 50 <b>${money(t.ma50) || '—'}</b></span>` +
            `<span class="ma-leg"><span class="ma-line ma200"></span>MM 200 <b>${money(t.ma200) || '—'}</b></span>` +
            `</div></div>`;

        top.innerHTML =
            maLegend +
            this._gauge(
                'RSI 14 séances',
                'Indicateur de momentum entre 0 et 100. Sous 30 le titre est dit survendu, au-dessus de 70 suracheté. À lire comme un excès de court terme, jamais comme un signal isolé.',
                t.rsi14,
                0,
                100,
                `<span>Survente <b>30</b></span><span><b>${num1(t.rsi14) || '—'}</b></span><span>Surachat <b>70</b></span>`,
                'rsi'
            );

        const trendTag = { haussière: 'ok', baissière: 'warn', neutre: 'mid' }[t.trend] || 'mid';
        const crossTxt = t.cross
            ? `${t.cross === 'golden' ? 'Golden cross' : 'Death cross'} · ${Utils.formatDateDisplay(t.crossDate)}`
            : null;
        const crossTag = t.cross
            ? `<span class="kv-tag ${t.cross === 'golden' ? 'ok' : 'warn'}">il y a ${t.crossDaysAgo} séances</span>`
            : '';
        const rsiTag = t.rsiZone
            ? `<span class="kv-tag ${t.rsiZone === 'neutre' ? 'mid' : t.rsiZone === 'survente' ? 'ok' : 'warn'}">${t.rsiZone}</span>`
            : '';
        const volTag =
            t.volumeRatio == null
                ? ''
                : `<span class="kv-tag ${t.volumeRatio >= 1.5 ? 'warn' : 'mid'}">${t.volumeRatio >= 1.5 ? 'activité inhabituelle' : 'activité normale'}</span>`;

        grid.innerHTML =
            kv(
                'Tendance',
                t.trend,
                "Lecture de l'alignement cours / MM 50 / MM 200. Haussière si le cours est au-dessus des deux moyennes et la MM 50 au-dessus de la MM 200.",
                `<span class="kv-tag ${trendTag}">${t.trend}</span>`
            ) +
            kv(
                'Moyenne mobile 50 j',
                money(t.ma50),
                'Cours moyen des 50 dernières séances : référence de tendance court/moyen terme.',
                gap(t.priceVsMa50)
            ) +
            kv(
                'Moyenne mobile 200 j',
                money(t.ma200),
                'Cours moyen des 200 dernières séances : référence de tendance long terme, très suivie par les gérants.',
                gap(t.priceVsMa200)
            ) +
            kv(
                'Dernier croisement',
                crossTxt,
                "Golden cross : la MM 50 repasse au-dessus de la MM 200 (lu comme haussier). Death cross : l'inverse. Signal retardé par construction.",
                crossTag
            ) +
            kv(
                'RSI 14',
                num1(t.rsi14),
                'Force relative sur 14 séances. Sous 30 : excès de baisse possible ; au-dessus de 70 : excès de hausse.',
                rsiTag
            ) +
            kv(
                'Position 52 semaines',
                t.rangePosition52 == null ? null : Utils.formatPercent(t.rangePosition52, false),
                'Où se situe le cours entre son plus bas et son plus haut des 52 dernières semaines. 0 % = au plus bas, 100 % = au plus haut.'
            ) +
            kv(
                'Écart au plus haut 52 sem.',
                pct(t.pctFromHigh52),
                "Distance qui sépare le cours de son plus haut annuel. Un écart important n'est pas une décote : il peut refléter une dégradation réelle."
            ) +
            kv(
                'Écart au plus bas 52 sem.',
                pct(t.pctFromLow52),
                'Distance qui sépare le cours de son plus bas annuel.'
            ) +
            kv(
                'Volume vs moyenne',
                t.volumeRatio == null ? null : `${num1(t.volumeRatio)} ×`,
                'Volume du jour rapporté au volume moyen. Au-delà de 1,5 ×, un événement mobilise le marché sur la valeur.',
                volTag
            );

        if (src) src.textContent = `Calculé sur ${t.points} séances de cotation`;
    },

    // Carte conditionnelle : masquee pour les valeurs qui ne versent pas de dividende.
    renderResearchDividend(a) {
        const card = document.getElementById('researchDivCard');
        const grid = document.getElementById('researchDivGrid');
        const series = document.getElementById('researchDivSeries');
        const src = document.getElementById('researchDivSrc');
        if (!card || !grid || !series) return;

        if (!a) {
            card.hidden = true;
            return;
        }

        const d = a.dividend || {};
        if (!d.paysDividend) {
            card.hidden = true;
            return;
        }
        card.hidden = false;

        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const money = (x) => (x == null || !isFinite(x) ? null : Utils.formatCurrency(x, cur));
        const pct = (x) => (x == null || !isFinite(x) ? null : Utils.formatPercent(x, false));

        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;

        // Taux de distribution : part du benefice reversee. Seuils explicites et
        // ajustables — au-dela de 80 % la marge de securite devient mince, le
        // dividende dependant alors de la stabilite parfaite des resultats.
        const payoutPct =
            d.payoutRatio == null || !isFinite(d.payoutRatio) ? null : d.payoutRatio * 100;
        const payoutTag =
            payoutPct == null
                ? ''
                : `<span class="kv-tag ${payoutPct > 80 ? 'warn' : payoutPct > 60 ? 'mid' : 'ok'}">` +
                  `${payoutPct > 80 ? 'peu soutenable' : payoutPct > 60 ? 'à surveiller' : 'soutenable'}</span>`;

        // Ecart au rendement moyen des 5 dernieres annees : au-dessus, le titre
        // rapporte plus que d'habitude (souvent parce que le cours a baisse).
        const vsAvg = d.yieldPct != null && d.avgYield5y ? d.yieldPct - d.avgYield5y : null;
        const vsAvgTag =
            vsAvg == null
                ? ''
                : `<span class="kv-cmp ${vsAvg >= 0 ? 'up' : 'dn'}">` +
                  `${vsAvg >= 0 ? '+' : '−'}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Math.abs(vsAvg))} pts vs moyenne 5 ans</span>`;

        const streak = d.growthStreakYears;
        const streakTag = !streak
            ? ''
            : `<span class="kv-tag ${streak >= 5 ? 'ok' : 'mid'}">${streak >= 5 ? 'régulier' : 'récent'}</span>`;

        const last = d.lastPayment;
        const annual = AnalysisUtils.arr(d.annualPerShare);
        const lastFull = annual.length > 1 ? annual[annual.length - 2] : null;

        grid.innerHTML =
            kv(
                'Rendement actuel',
                pct(d.yieldPct),
                'Dividende annuel rapporté au cours actuel. Un rendement très élevé traduit souvent un cours qui a chuté, pas une bonne affaire.',
                vsAvgTag
            ) +
            kv(
                'Rendement moyen 5 ans',
                pct(d.avgYield5y),
                'Rendement moyen des 5 dernières années : sert de repère pour situer le rendement actuel.'
            ) +
            kv(
                'Dividende par action',
                money(d.ratePerShare),
                'Montant annuel versé par action, sur la base du dernier taux connu.'
            ) +
            kv(
                'Versé sur le dernier exercice',
                lastFull == null ? null : money(lastFull.value),
                'Somme réellement versée par action sur le dernier exercice complet, tous détachements confondus.'
            ) +
            kv(
                'Taux de distribution',
                payoutPct == null ? null : pct(payoutPct),
                'Part du bénéfice reversée aux actionnaires. Au-delà de 80 %, le dividende absorbe presque tout le résultat : peu de marge en cas de mauvaise année.',
                payoutTag
            ) +
            kv(
                'Hausses consécutives',
                streak == null ? null : `${streak} an${streak > 1 ? 's' : ''}`,
                "Nombre d'exercices complets consécutifs où le dividende annuel a augmenté. Une longue série signale une politique de distribution assumée.",
                streakTag
            ) +
            kv(
                'Dernier versement',
                !last ? null : money(Number(last.amountPerShare)),
                'Montant et date du dernier détachement connu.',
                last && last.date
                    ? `<span class="kv-cmp">${Utils.formatDateDisplay(last.date)}</span>`
                    : ''
            ) +
            kv(
                'Historique disponible',
                annual.length ? `${annual.length} exercices` : null,
                "Profondeur de l'historique de versements récupéré (source Yahoo Finance)."
            );

        series.innerHTML = this._growthSeries(
            'Dividende annuel par action',
            annual,
            (x) => Utils.formatCurrency(x, cur),
            "Somme des détachements de chaque année civile. La dernière année est souvent incomplète : elle n'entre pas dans le calcul des hausses consécutives."
        );

        if (src)
            src.textContent = annual.length
                ? 'Yahoo Finance'
                : 'Historique de versements indisponible';
    },

    // ---------- Synthese / score global ----------
    // L'affichage ne recalcule rien : toute la logique de notation (bornes,
    // ponderations, seuils du signal) vit dans AnalysisService._scoreBlock.
    renderResearchScore(a) {
        const card = document.getElementById('researchScoreCard');
        const top = document.getElementById('researchScoreTop');
        const subsEl = document.getElementById('researchScoreSubs');
        const src = document.getElementById('researchScoreSrc');
        if (!card || !top || !subsEl) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            top.innerHTML = '<span class="research-kv-loading">Chargement…</span>';
            subsEl.innerHTML = '';
            return;
        }

        const sc = a.score || {};
        const subs = AnalysisUtils.arr(sc.subs);
        const T = AnalysisService.SIGNAL_THRESHOLDS;
        const r0 = (x) => Math.round(x);

        const signalCls = { Achat: 'buy', Conserver: 'hold', Vente: 'sell' }[sc.signal] || 'hold';
        const tipGlobal =
            `Moyenne pondérée des dimensions notées : valorisation ${r0(AnalysisService.SCORE_WEIGHTS.valuation * 100)} %, ` +
            `rentabilité ${r0(AnalysisService.SCORE_WEIGHTS.profitability * 100)} %, croissance ${r0(AnalysisService.SCORE_WEIGHTS.growth * 100)} %, ` +
            `santé financière ${r0(AnalysisService.SCORE_WEIGHTS.health * 100)} %, sentiment & technique ${r0(AnalysisService.SCORE_WEIGHTS.momentum * 100)} %. ` +
            `Signal : ${T.buy} et plus = Achat, ${T.hold} à ${T.buy} = Conserver, en dessous = Vente.`;

        if (sc.global == null) {
            top.innerHTML =
                `<div class="score-side"><span class="score-signal hold">Non disponible</span>` +
                `<span class="score-caption">Trop peu de données publiques sur cette valeur pour calculer un score fiable.</span></div>`;
            subsEl.innerHTML = '';
            if (src) src.textContent = '';
        } else {
            top.innerHTML =
                `<div class="score-dial"><span class="score-val">${r0(sc.global)}</span><span class="score-max">/ 100</span></div>` +
                `<div class="score-side"><span class="score-signal ${signalCls}">${sc.signal}</span>` +
                `<span class="score-caption">Synthèse de ${sc.subsUsed} dimension${sc.subsUsed > 1 ? 's' : ''} sur ${subs.length}. ` +
                `${this._kvHelp(tipGlobal)}</span></div>`;

            subsEl.innerHTML = subs
                .map((s) => {
                    const v = s.value;
                    const bar =
                        v == null
                            ? ''
                            : `<div class="score-bar"><i class="${v >= T.buy ? 'high' : v < T.hold ? 'low' : ''}" style="width:${Math.max(2, Math.min(100, v)).toFixed(0)}%"></i></div>`;
                    return (
                        `<div class="score-sub">` +
                        `<span class="score-sub-lab">${s.label} ${this._kvHelp(`Pondération ${r0(s.weight * 100)} % du score global. ${s.used} critère${s.used > 1 ? 's' : ''} disponible${s.used > 1 ? 's' : ''} sur ${s.total}.`)}</span>` +
                        `<span class="score-sub-val">${v == null ? 'Non disponible' : r0(v) + ' / 100'}</span>` +
                        bar +
                        `<span class="score-note">${Utils.escapeHtml(s.note)}</span>` +
                        `</div>`
                    );
                })
                .join('');
            if (src) src.textContent = `Mis à jour le ${Utils.formatDateDisplay(a.asOf)}`;
        }
    },

    // ---------- Analyse detaillee redigee par l'IA ----------
    // Le texte est produit cote worker (POST /ai/stock-analysis), a partir du seul
    // payload structure renvoye par AnalysisService.buildAiPayload : le modele ne
    // recoit aucune donnee brute et ne va rien chercher lui-meme.
    // Trois niveaux de cache evitent de rappeler le fournisseur : le cache local
    // ci-dessous (une generation par valeur et par jour), puis le cache KV du
    // worker, puis rien du tout si l'utilisateur force la regeneration.
    RESEARCH_AI_CACHE_MAX: 20,

    _researchAiCacheRead() {
        try {
            return JSON.parse(localStorage.getItem(CONFIG.RESEARCH_AI_CACHE_STORAGE) || '{}') || {};
        } catch (e) {
            return {};
        }
    },

    _researchAiCacheWrite(key, entry) {
        const all = this._researchAiCacheRead();
        all[key] = entry;
        const keys = Object.keys(all);
        if (keys.length > this.RESEARCH_AI_CACHE_MAX) {
            keys.sort((a, b) => (all[a].storedAt || 0) - (all[b].storedAt || 0))
                .slice(0, keys.length - this.RESEARCH_AI_CACHE_MAX)
                .forEach((k) => delete all[k]);
        }
        try {
            localStorage.setItem(CONFIG.RESEARCH_AI_CACHE_STORAGE, JSON.stringify(all));
        } catch (e) {
            /* quota localStorage : le cache worker prend le relais */
        }
    },

    _researchAiCacheKey(symbol, provider) {
        return `${symbol}:${provider}:${Utils.getDateString()}`;
    },

    _setResearchAiUpdated(iso) {
        const el = document.getElementById('researchAiUpdated');
        if (!el) return;
        if (!iso) {
            el.textContent = '';
            return;
        }
        const d = new Date(iso);
        el.textContent = isNaN(d.getTime())
            ? ''
            : `Analyse générée le ${Utils.formatDateDisplay(Utils.getDateString(d))} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },

    // Paragraphes + « Afficher plus » : meme pattern que le resume du portefeuille
    // (le gestionnaire de clic .insights-summary-toggle est deja delegue au document).
    _researchAiTextHtml(text) {
        const paras = String(text)
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean);
        const html = paras.map((p) => `<p>${Utils.escapeHtml(p)}</p>`).join('');
        if (paras.length <= 2 && text.length <= 400)
            return `<div class="research-ai-text">${html}</div>`;
        return (
            `<div class="research-ai-text is-clamped">${html}</div>` +
            `<button type="button" class="insights-summary-toggle">Afficher plus</button>`
        );
    },

    renderResearchAi(a) {
        const card = document.getElementById('researchAiCard');
        const body = document.getElementById('researchAiBody');
        const btn = document.getElementById('researchAiRefreshBtn');
        if (!card || !body) return;

        if (!a) {
            card.hidden = true;
            body.innerHTML = '';
            this._setResearchAiUpdated(null);
            if (btn) btn.hidden = true;
            return;
        }
        card.hidden = false;
        this.refreshResearchAiAnalysis(false);
    },

    async refreshResearchAiAnalysis(force = false) {
        const card = document.getElementById('researchAiCard');
        const body = document.getElementById('researchAiBody');
        const btn = /** @type {HTMLButtonElement} */ (
            document.getElementById('researchAiRefreshBtn')
        );
        const a = this.researchAnalysis;
        const symbol = this.researchSymbol;
        if (!card || !body || !a || !symbol) return;

        const provider = this.service.aiProvider;
        const hasKey =
            !!provider &&
            (this.service.aiConfigured || []).includes(provider) &&
            !!AI_PROVIDERS[provider];
        if (!hasKey) {
            body.innerHTML =
                '<div class="insights-plain-note">Analyse rédigée indisponible : ajoutez une clé IA dans les paramètres pour l\'activer.</div>';
            this._setResearchAiUpdated(null);
            if (btn) btn.hidden = true;
            return;
        }
        if (btn) btn.hidden = false;

        const cacheKey = this._researchAiCacheKey(symbol, provider);
        if (!force) {
            const hit = this._researchAiCacheRead()[cacheKey];
            if (hit && hit.text) {
                body.innerHTML = this._researchAiTextHtml(hit.text);
                this._setResearchAiUpdated(hit.generatedAt);
                return;
            }
        }

        if (this.researchAiRunning) return;
        this.researchAiRunning = true;
        if (btn) btn.disabled = true;
        body.innerHTML =
            '<div class="research-ai-skeleton"><span></span><span></span><span></span><span></span></div>';
        this._setResearchAiUpdated(null);
        try {
            const payload = AnalysisService.buildAiPayload(a, this.researchNewsItems || []);
            const out = await APIService.aiStockAnalysis(provider, payload, force);
            if (this.researchSymbol !== symbol) return; // l'utilisateur a change de valeur
            const text = (out && out.text) || '';
            if (!text.trim()) throw new Error('réponse vide');
            body.innerHTML = this._researchAiTextHtml(text);
            this._setResearchAiUpdated(out.generatedAt);
            this._researchAiCacheWrite(cacheKey, {
                text,
                generatedAt: out.generatedAt,
                storedAt: Date.now(),
            });
        } catch (e) {
            // Une analyse indisponible ne doit jamais casser le reste de la page.
            console.warn('Analyse IA indisponible', e);
            if (this.researchSymbol === symbol) {
                body.innerHTML = `<div class="insights-plain-note">Analyse temporairement indisponible (${Utils.escapeHtml(e.message || 'erreur inconnue')}).</div>`;
                this._setResearchAiUpdated(null);
            }
        } finally {
            this.researchAiRunning = false;
            if (btn) btn.disabled = false;
        }
    },

    // ---------- Comparaison sectorielle ----------
    // Sens de lecture explicite par metrique (`dir`), pour pouvoir l'ajuster :
    //   dir = -1 -> plus bas vaut mieux (PER : moins cher a benefices egaux)
    //   dir =  1 -> plus haut vaut mieux (marge, croissance, rentabilite)
    //   dir =  0 -> pas de "mieux" (la taille n'est pas un critere de qualite)
    // Seule la ligne de la valeur analysee est coloree, et toujours par rapport
    // a la mediane du groupe : un comparable isole ne fait pas reference.
    _peerCols() {
        const mult = (x) =>
            new Intl.NumberFormat('fr-FR', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
            }).format(x) + ' ×';
        const pct = (x) => Utils.formatPercent(x, false);
        return [
            {
                key: 'marketCap',
                label: 'Capitalisation',
                dir: 0,
                fmt: (x) => Utils.formatCompact(x, 'USD'),
                tip: 'Valeur totale des actions en circulation. Sert à situer la taille des entreprises comparées, pas leur qualité.',
            },
            {
                key: 'peTTM',
                label: 'PER',
                dir: -1,
                fmt: mult,
                tip: 'Cours rapporté au bénéfice des 12 derniers mois. Plus bas que le groupe : la valeur se paie moins cher — à condition que la rentabilité suive.',
            },
            {
                key: 'netMargin',
                label: 'Marge nette',
                dir: 1,
                fmt: pct,
                tip: "Part du chiffre d'affaires qui reste en bénéfice. Une marge nettement au-dessus du groupe traduit souvent un avantage concurrentiel.",
            },
            {
                key: 'revenueGrowth',
                label: 'Croissance CA',
                dir: 1,
                fmt: (x) => Utils.formatPercent(x),
                tip: "Croissance du chiffre d'affaires sur un an. À comparer au groupe : croître moins vite que son secteur est un signal à creuser.",
            },
            {
                key: 'roe',
                label: 'ROE',
                dir: 1,
                fmt: pct,
                tip: "Rentabilité des capitaux propres : ce que l'entreprise dégage pour 100 € apportés par les actionnaires.",
            },
        ];
    },

    async renderResearchPeers(a) {
        const card = document.getElementById('researchPeersCard');
        const table = document.getElementById('researchPeersTable');
        const src = document.getElementById('researchPeersSrc');
        if (!card || !table) return;
        card.hidden = false;

        const loading = (msg) =>
            `<tbody><tr><td class="research-kv-loading">${msg}</td></tr></tbody>`;
        if (!a) {
            if (src) src.textContent = '';
            table.innerHTML = loading('Chargement…');
            return;
        }

        const symbol = a.symbol;
        table.innerHTML = loading('Chargement des comparables…');
        const d = await AnalysisService.buildPeers(a).catch((e) => {
            console.warn('buildPeers KO', e);
            return null;
        });
        if (this.researchSymbol !== symbol) return; // course annulee entre-temps

        if (!d || !d.peers.length) {
            table.innerHTML = loading(
                'Non disponible — comparables sectoriels fournis pour les actions US uniquement.'
            );
            if (src) src.textContent = '';
            return;
        }

        const cols = this._peerCols();
        const ND = '<span class="research-kv-loading">—</span>';
        const med = d.median || {};

        const head =
            '<thead><tr><th>Valeur</th>' +
            cols
                .map((c) => `<th><span>${c.label} ${this._kvHelp(c.tip, 'tip-below')}</span></th>`)
                .join('') +
            '</tr></thead>';

        const cells = (r, colored) =>
            cols
                .map((c) => {
                    const v = r[c.key];
                    if (v == null || !isFinite(v)) return `<td>${ND}</td>`;
                    let cls = '';
                    const m = med[c.key];
                    if (colored && c.dir && m != null && isFinite(m) && v !== m) {
                        cls = v > m === c.dir > 0 ? ' class="better"' : ' class="worse"';
                    }
                    return `<td${cls}>${c.fmt(v)}</td>`;
                })
                .join('');

        const nameCell = (r) =>
            `<td><span class="peer-sym">${Utils.escapeHtml(r.symbol)}</span>` +
            `<span class="peer-name">${Utils.escapeHtml(r.name || r.symbol)}</span></td>`;

        const rows =
            `<tr class="self">${nameCell(d.self)}${cells(d.self, true)}</tr>` +
            d.peers.map((r) => `<tr>${nameCell(r)}${cells(r, false)}</tr>`).join('') +
            `<tr class="median"><td><span class="peer-sym">Médiane</span>` +
            `<span class="peer-name">${d.peers.length + 1} valeurs</span></td>${cells(med, false)}</tr>`;

        table.innerHTML = head + `<tbody>${rows}</tbody>`;
        if (src) src.textContent = `${d.peers.length} comparables · Finnhub + Yahoo Finance`;
    },

    // Sous-section de la carte "Profil & risques" : titre + contenu.
    _qualSec(title, tip, inner) {
        return `<div class="qual-sec"><div class="sent-title">${title} ${this._kvHelp(tip)}</div>${inner}</div>`;
    },

    // Carte qualitative. Regle de la phase : on n'ecrit aucune analyse maison.
    // La description est reprise telle quelle de l'emetteur, les risques se
    // limitent aux scores publies par l'API — si elle n'en fournit pas, la
    // sous-section "Risques" n'est tout simplement pas affichee.
    renderResearchQualitative(a) {
        const card = document.getElementById('researchQualCard');
        const body = document.getElementById('researchQualBody');
        const src = document.getElementById('researchQualSrc');
        if (!card || !body) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            body.innerHTML =
                '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            return;
        }

        const ND = 'Non disponible';
        const idn = a.identity || {};
        const r = a.risks || {};
        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;
        const secs = [];

        // ----- Activite : texte de l'emetteur, jamais reformule -----
        if (idn.description) {
            const long = idn.description.length > 420;
            secs.push(
                this._qualSec(
                    'Activité',
                    "Description de l'activité publiée par l'émetteur et reprise telle quelle par la source de données. Ce n'est pas une analyse.",
                    `<p class="qual-text${long ? ' clamp' : ''}" id="researchQualText">${Utils.escapeHtml(idn.description)}</p>` +
                        (long
                            ? '<button type="button" class="qual-more" id="researchQualMore">Lire la suite</button>'
                            : '') +
                        (idn.employees == null
                            ? ''
                            : `<div class="research-kv-grid" style="margin-top:16px">${kv(
                                  'Effectif',
                                  Utils.formatCompact(idn.employees) + ' salariés',
                                  "Nombre de salariés à temps plein déclaré par l'entreprise. Utile pour situer sa taille au-delà de la capitalisation."
                              )}</div>`)
                )
            );
        }

        // ----- Risques -----
        // Beta : 1 = amplitude du marche. Seuils explicites et ajustables :
        // < 0,8 defensif, 0,8-1,2 dans la moyenne, > 1,2 plus volatil.
        const beta = r.beta == null || !isFinite(r.beta) ? null : r.beta;
        const betaTag =
            beta == null
                ? ''
                : `<span class="kv-tag ${beta > 1.2 ? 'warn' : beta < 0.8 ? 'ok' : 'mid'}">` +
                  `${beta > 1.2 ? 'plus volatil' : beta < 0.8 ? 'défensif' : 'proche du marché'}</span>`;

        // Scores de gouvernance Yahoo : echelle 1 a 10, 1 = risque le plus faible.
        // Seuils explicites et ajustables : <= 3 faible, <= 6 modere, > 6 eleve.
        const govKv = (label, score, tip) => {
            const s = score == null || !isFinite(score) ? null : score;
            const tag =
                s == null
                    ? ''
                    : `<span class="kv-tag ${s > 6 ? 'warn' : s > 3 ? 'mid' : 'ok'}">` +
                      `${s > 6 ? 'élevé' : s > 3 ? 'modéré' : 'faible'}</span>`;
            return kv(label, s == null ? null : `${s} / 10`, tip, tag);
        };

        if (beta != null || r.hasGovernance) {
            let rows = '';
            if (beta != null) {
                rows += kv(
                    'Volatilité (bêta)',
                    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(beta),
                    'Amplitude des variations du titre par rapport au marché. 1 = même amplitude ; au-dessus, le titre bouge plus fort dans les deux sens.',
                    betaTag
                );
            }
            if (r.hasGovernance) {
                const g = r.governance || {};
                rows +=
                    govKv(
                        'Gouvernance (global)',
                        g.overall,
                        'Score de risque de gouvernance publié par la source de données, de 1 (risque le plus faible) à 10 (le plus élevé).'
                    ) +
                    govKv(
                        'Audit',
                        g.audit,
                        'Risque lié aux pratiques comptables et au contrôle des comptes, de 1 (faible) à 10 (élevé).'
                    ) +
                    govKv(
                        "Conseil d'administration",
                        g.board,
                        "Risque lié à la composition et à l'indépendance du conseil, de 1 (faible) à 10 (élevé)."
                    ) +
                    govKv(
                        'Rémunération des dirigeants',
                        g.compensation,
                        "Risque lié à l'alignement des rémunérations des dirigeants avec l'intérêt des actionnaires, de 1 (faible) à 10 (élevé)."
                    ) +
                    govKv(
                        'Droits des actionnaires',
                        g.shareholderRights,
                        'Risque lié au pouvoir réel des actionnaires minoritaires (droits de vote, protections statutaires), de 1 (faible) à 10 (élevé).'
                    );
            }
            secs.push(
                this._qualSec(
                    'Risques',
                    "Uniquement les indicateurs de risque publiés par les sources de données. Aucun risque n'est rédigé ni déduit ici ; les points non couverts par l'API sont simplement absents.",
                    `<div class="research-kv-grid">${rows}</div>`
                )
            );
        }

        // ----- Calendrier des catalyseurs -----
        const e = a.earnings || {};
        const hourLabel =
            { bmo: 'avant ouverture', amc: 'après clôture', dmh: 'en séance' }[e.hour] || null;
        const cur = (a.price && a.price.currency) || idn.currency || 'USD';
        const q0 = AnalysisUtils.arr(a.growth && a.growth.estimatesShortTerm).find(
            (x) => x.period === '0q'
        );
        const exDate = a.dividend && a.dividend.exDate;

        secs.push(
            this._qualSec(
                'Calendrier',
                'Prochaines échéances connues susceptibles de faire bouger le cours. Les dates viennent du calendrier des publications, disponible pour les actions américaines uniquement.',
                '<div class="research-kv-grid">' +
                    kv(
                        'Prochains résultats',
                        !e.date ? null : Utils.formatDateDisplay(e.date),
                        'Date de la prochaine publication de résultats trimestriels.',
                        hourLabel ? `<span class="kv-cmp">${hourLabel}</span>` : ''
                    ) +
                    kv(
                        'BPA attendu',
                        e.epsEstimate == null ? null : Utils.formatCurrency(e.epsEstimate, cur),
                        'Bénéfice par action attendu en moyenne par les analystes pour ce trimestre. Un écart à la publication déclenche souvent une forte réaction du cours.'
                    ) +
                    kv(
                        'CA attendu',
                        e.revenueEstimate == null
                            ? null
                            : Utils.formatCompact(e.revenueEstimate, cur),
                        "Chiffre d'affaires attendu en moyenne par les analystes pour ce trimestre."
                    ) +
                    kv(
                        'Fin du trimestre en cours',
                        q0 && q0.endDate ? Utils.formatDateDisplay(q0.endDate) : null,
                        'Date de clôture du trimestre dont les résultats seront publiés ensuite.'
                    ) +
                    kv(
                        'Détachement du dividende',
                        !exDate ? null : Utils.formatDateDisplay(exDate),
                        "Date à partir de laquelle le titre s'échange sans le prochain dividende. Acheter après cette date n'y donne pas droit."
                    ) +
                    '</div>'
            )
        );

        body.innerHTML = secs.join('');

        const more = document.getElementById('researchQualMore');
        if (more) {
            more.addEventListener('click', () => {
                const p = document.getElementById('researchQualText');
                if (!p) return;
                const open = p.classList.toggle('clamp');
                more.textContent = open ? 'Lire la suite' : 'Réduire';
            });
        }

        if (src)
            src.textContent = idn.description
                ? 'Profil : émetteur · Risques : Yahoo Finance'
                : 'Description indisponible';
    },
};
