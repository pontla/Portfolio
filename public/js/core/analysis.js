/**
 * Agregation multi-sources -> objet StockAnalysis unique (valorisation,
 * croissance, sante, rentabilite, sentiment, technique, dividende, pairs,
 * score global). Aucune dependance au DOM.
 */

import { Utils } from './utils.js';
import { APIService } from './api.js';

// --- ANALYSE VALEUR : agregation multi-sources -> objet StockAnalysis unique ---
//
// Conventions de l'objet normalise (les composants UI ne connaissent que ca) :
//  - proportions (marges, ROE/ROA/ROIC, rendement, croissance, payout,
//    detention, short) => UNITES POURCENT (12.8 = 12,8 %), compatibles
//    Utils.formatPercent().
//  - multiples (P/E, PEG, EV/EBITDA, P/B, P/S, D/E, current/quick ratio,
//    interest coverage, netDebt/EBITDA) => nombre brut.
//  - montants => devise de reporting, valeur brute.
//  - toute donnee absente => null (jamais NaN, jamais undefined).
export const AnalysisUtils = {
    num: (v) => (typeof v === 'number' && isFinite(v) ? v : null),
    // fraction (0.128) -> pourcent (12.8)
    pctU: (v) => (typeof v === 'number' && isFinite(v) ? v * 100 : null),
    arr: (v) => (Array.isArray(v) ? v : []),
    avg: (list) => {
        const x = list.filter((n) => typeof n === 'number' && isFinite(n));
        return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
    },
    // Moyenne d'un multiple : les exercices ou il est nul ou negatif n'en font pas
    // partie, la valeur n'y est pas interpretable (cf. hist5y).
    avgPositive: (list) =>
        AnalysisUtils.avg(list.filter((n) => typeof n === 'number' && isFinite(n) && n > 0)),
    // CAGR en pourcent entre la 1re et la derniere valeur d'une serie.
    cagrPct: (first, last, years) =>
        first > 0 && last > 0 && years > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : null,
    // Tendance d'une serie ordonnee ancien -> recent.
    trend: (vals) => {
        const x = vals.filter((n) => typeof n === 'number' && isFinite(n));
        if (x.length < 2) return null;
        const chg = (x[x.length - 1] - x[0]) / Math.abs(x[0] || 1);
        if (chg > 0.05) return 'croissant';
        if (chg < -0.05) return 'décroissant';
        return 'stable';
    },
    year: (row) => (row && (row.calendarYear || row.date || '')).toString().slice(0, 4) || null,
};

export const AnalysisService = {
    _cache: {},

    // Analyse deja en cache et encore fraiche, sinon null : permet a l'UI de
    // reafficher une analyse sans reconsommer le quota FMP.
    cached(symbol) {
        const hit = this._cache[(symbol || '').trim().toUpperCase()];
        return hit && Date.now() - hit.ts < 900000 ? hit.data : null;
    },

    // Agrege toutes les sources pour un ticker et renvoie un StockAnalysis.
    // Cache 15 min sur l'agregat complet (les sous-appels ont leur propre TTL).
    async build(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return null;
        const now = Date.now();
        const hit = this._cache[symbol];
        if (hit && now - hit.ts < 900000) return hit.data;

        const nonUS = symbol.includes('.') || symbol.startsWith('$') || symbol.endsWith('-USD');
        const errors = [];
        const guard = (p, label) =>
            Promise.resolve(p).catch((e) => {
                console.warn(`AnalysisService: ${label} KO`, e);
                errors.push(label);
                return null;
            });

        const histStart = new Date();
        histStart.setMonth(histStart.getMonth() - 15);
        const histEnd = new Date();

        const [
            fund,
            qs,
            ratios,
            income,
            cashflow,
            keyMetricsTtm,
            ratiosTtm,
            estimatesFmp,
            profileFmp,
            reco,
            insider,
            peersRaw,
            earn,
            history,
            dividends,
        ] = await Promise.all([
            guard(APIService.getFundamentals(symbol), 'fundamentals'),
            guard(APIService.getQuoteSummary(symbol), 'quoteSummary'),
            guard(APIService.getFmp('ratios', symbol), 'fmp:ratios'),
            guard(APIService.getFmp('income', symbol), 'fmp:income'),
            guard(APIService.getFmp('cashflow', symbol), 'fmp:cashflow'),
            guard(APIService.getFmp('keyMetricsTtm', symbol), 'fmp:keyMetricsTtm'),
            guard(APIService.getFmp('ratiosTtm', symbol), 'fmp:ratiosTtm'),
            guard(APIService.getFmp('estimates', symbol), 'fmp:estimates'),
            guard(APIService.getFmp('profile', symbol), 'fmp:profile'),
            nonUS ? null : guard(APIService.getRecommendation(symbol), 'recommendation'),
            nonUS ? null : guard(APIService.getInsiderTransactions(symbol), 'insider'),
            guard(APIService.getPeers(symbol), 'peers'),
            guard(APIService.getEarnings(symbol), 'earnings'),
            guard(APIService.getDailyHistory(symbol, histStart, histEnd), 'history'),
            guard(
                APIService.getDividends(symbol, '2000-01-01', Utils.getDateString(histEnd)),
                'dividends'
            ),
        ]);

        const data = this._normalize({
            symbol,
            nonUS,
            fund,
            qs,
            ratios,
            income,
            cashflow,
            keyMetricsTtm,
            ratiosTtm,
            estimatesFmp,
            profileFmp,
            reco,
            insider,
            peersRaw,
            earn,
            history,
            dividends,
            errors,
        });
        this._cache[symbol] = { ts: now, data };
        return data;
    },

    // ---------- Comparaison sectorielle ----------
    // Une seule requete /quoteSummary par comparable (4 au maximum), deja mise en
    // cache 1 h cote client et 1 h au bord : consulter plusieurs fois la meme
    // valeur ne recoute rien. Appelee separement de build() pour ne pas retarder
    // l'affichage des sections principales.
    _peersCache: {},
    async buildPeers(analysis) {
        if (!analysis || !analysis.symbol) return null;
        const symbol = analysis.symbol;
        const now = Date.now();
        const hit = this._peersCache[symbol];
        if (hit && now - hit.ts < 900000) return hit.data;

        const peers = AnalysisUtils.arr(analysis.peersSymbols);
        const rows = peers.length
            ? await Promise.all(
                  peers.map(async (s) => {
                      const qs = await APIService.getQuoteSummary(s).catch(() => null);
                      return qs
                          ? this._peerRow(s, qs)
                          : {
                                symbol: s,
                                name: null,
                                marketCap: null,
                                peTTM: null,
                                netMargin: null,
                                revenueGrowth: null,
                                roe: null,
                            };
                  })
              )
            : [];

        // La valeur analysee sert de reference : ses metriques viennent de
        // l'analyse deja construite, pas d'une requete supplementaire.
        const self = {
            symbol,
            name: (analysis.identity && analysis.identity.name) || symbol,
            marketCap: analysis.price ? analysis.price.marketCap : null,
            peTTM: analysis.valuation ? analysis.valuation.peTTM : null,
            netMargin: analysis.profitability ? analysis.profitability.netMargin : null,
            revenueGrowth: analysis.growth ? analysis.growth.revenueGrowthYoyPct : null,
            roe: analysis.profitability ? analysis.profitability.roe : null,
            isSelf: true,
        };

        const data = { self, peers: rows, median: this._peerMedians([self, ...rows]) };
        this._peersCache[symbol] = { ts: now, data };
        return data;
    },

    _peerRow(symbol, qs) {
        const n = AnalysisUtils.num,
            pctU = AnalysisUtils.pctU;
        return {
            symbol,
            name: qs.name || symbol,
            marketCap: n(qs.marketCap),
            peTTM: n(qs.peTrailing),
            netMargin: pctU(n(qs.profitMargins)),
            revenueGrowth: pctU(n(qs.revenueGrowth)),
            roe: pctU(n(qs.returnOnEquity)),
        };
    },

    // Mediane par metrique, calculee sur les seules valeurs disponibles : un
    // comparable sans donnee ne tire pas la reference vers le bas.
    _peerMedians(rows) {
        const med = (key) => {
            const v = rows
                .map((r) => r[key])
                .filter((x) => x != null && isFinite(x))
                .sort((a, b) => a - b);
            if (!v.length) return null;
            const m = Math.floor(v.length / 2);
            return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
        };
        return {
            marketCap: med('marketCap'),
            peTTM: med('peTTM'),
            netMargin: med('netMargin'),
            revenueGrowth: med('revenueGrowth'),
            roe: med('roe'),
        };
    },

    _normalize(x) {
        const U = AnalysisUtils;
        const n = U.num,
            pctU = U.pctU;
        const qs = x.qs || {};
        const fund = x.fund || {};

        // FMP : tableaux annuels renvoyes du plus recent au plus ancien -> on
        // remet ancien -> recent pour les series temporelles.
        const ratiosAsc = U.arr(x.ratios).slice().reverse();
        const incomeAsc = U.arr(x.income).slice().reverse();
        const cashAsc = U.arr(x.cashflow).slice().reverse();
        const kmTtm = U.arr(x.keyMetricsTtm)[0] || {};
        const rTtm = U.arr(x.ratiosTtm)[0] || {};
        const profFmp = U.arr(x.profileFmp)[0] || {};
        const estAsc = U.arr(x.estimatesFmp).slice().reverse();
        const latestRatio = ratiosAsc[ratiosAsc.length - 1] || {};
        const fmpUnavailable =
            !!(x.ratios && x.ratios.unavailable) && !!(x.income && x.income.unavailable);

        const price = n(qs.price) ?? n(fund.price);
        const previousClose = n(qs.previousClose) ?? n(fund.previousClose);
        const marketCap = n(qs.marketCap) ?? n(fund.marketCap) ?? n(profFmp.mktCap);
        const currency = qs.currency || fund.currency || 'USD';

        // ---------- Identite ----------
        const identity = {
            name: qs.name || fund.name || profFmp.companyName || x.symbol,
            currency,
            exchange: qs.exchange || fund.exchange || profFmp.exchangeShortName || null,
            sector: profFmp.sector || qs.sector || null,
            industry: qs.industry || fund.industry || profFmp.industry || null,
            country: qs.country || fund.country || profFmp.country || null,
            ipo: fund.ipo || profFmp.ipoDate || null,
            website: qs.website || fund.weburl || profFmp.website || null,
            description: qs.longBusinessSummary || profFmp.description || null,
            employees: n(qs.fullTimeEmployees) ?? n(profFmp.fullTimeEmployees),
            logo: fund.logo || profFmp.image || null,
        };

        // ---------- Prix / niveaux ----------
        const priceBlock = {
            current: price,
            previousClose,
            change: price != null && previousClose != null ? price - previousClose : null,
            changePct:
                price != null && previousClose
                    ? ((price - previousClose) / previousClose) * 100
                    : null,
            fiftyTwoWeekHigh: n(qs.fiftyTwoWeekHigh) ?? n(fund.fiftyTwoWeekHigh),
            fiftyTwoWeekLow: n(qs.fiftyTwoWeekLow) ?? n(fund.fiftyTwoWeekLow),
            fiftyDayAverage: n(qs.fiftyDayAverage),
            twoHundredDayAverage: n(qs.twoHundredDayAverage),
            volume: n(fund.volume) ?? n(qs.regularMarketVolume),
            averageVolume: n(qs.averageVolume),
            marketCap,
            currency,
        };

        // ---------- Valorisation ----------
        const fcfLatest = cashAsc.length ? n(cashAsc[cashAsc.length - 1].freeCashFlow) : null;
        const valuation = {
            peTTM: n(fund.peTTM) ?? n(qs.peTrailing) ?? n(rTtm.peRatioTTM),
            peForward: n(qs.peForward),
            peg: n(qs.pegRatio) ?? n(rTtm.pegRatioTTM),
            pb: n(fund.pbAnnual) ?? n(qs.priceToBook) ?? n(rTtm.priceToBookRatioTTM),
            ps: n(fund.psTTM) ?? n(qs.priceToSales) ?? n(rTtm.priceToSalesRatioTTM),
            evEbitda:
                n(qs.enterpriseToEbitda) ??
                n(kmTtm.enterpriseValueOverEBITDATTM) ??
                n(rTtm.enterpriseValueMultipleTTM),
            evRevenue: n(qs.enterpriseToRevenue) ?? n(kmTtm.evToSalesTTM),
            fcfYield:
                pctU(n(kmTtm.freeCashFlowYieldTTM)) ??
                (fcfLatest != null && marketCap ? (fcfLatest / marketCap) * 100 : null),
            // Moyennes sur les seuls exercices ou le multiple a un sens. Un exercice
            // deficitaire donne un PER negatif qui, moyenne avec des PER positifs,
            // ecrase la reference : [-50, 25, 28, 30, 26, 27] donne 14,3 au lieu de
            // 27,2, et la valeur ressort a tort tres chere face a son historique.
            // Idem pour VE/EBITDA (EBITDA negatif) et l'actif net (fonds propres
            // negatifs). Le CA, lui, ne peut pas etre negatif : `ps` reste tel quel.
            hist5y: {
                pe: U.avgPositive(ratiosAsc.map((r) => n(r.priceEarningsRatio))),
                pb: U.avgPositive(ratiosAsc.map((r) => n(r.priceToBookRatio))),
                ps: U.avg(ratiosAsc.map((r) => n(r.priceToSalesRatio))),
                evEbitda: U.avgPositive(ratiosAsc.map((r) => n(r.enterpriseValueMultiple))),
            },
        };

        // ---------- Croissance ----------
        const revSeries = incomeAsc.map((r) => ({ year: U.year(r), value: n(r.revenue) }));
        const epsSeries = incomeAsc.map((r) => ({
            year: U.year(r),
            value: n(r.eps) ?? n(r.epsdiluted),
        }));
        const revVals = revSeries.map((p) => p.value).filter((v) => v != null);
        const epsVals = epsSeries.map((p) => p.value).filter((v) => v != null);
        const growth = {
            revenueAnnual: revSeries,
            epsAnnual: epsSeries,
            revenueCagrPct:
                revVals.length >= 2
                    ? U.cagrPct(revVals[0], revVals[revVals.length - 1], revVals.length - 1)
                    : null,
            epsCagrPct:
                epsVals.length >= 2
                    ? U.cagrPct(epsVals[0], epsVals[epsVals.length - 1], epsVals.length - 1)
                    : null,
            revenueGrowthYoyPct: pctU(n(qs.revenueGrowth)) ?? n(fund.revenueGrowthTTM),
            epsGrowthYoyPct: pctU(n(qs.earningsGrowth)),
            estimates: estAsc.map((e) => ({
                year: (e.date || '').toString().slice(0, 4),
                revenueAvg: n(e.estimatedRevenueAvg),
                epsAvg: n(e.estimatedEpsAvg),
                analysts:
                    n(e.numberAnalystsEstimatedEps) ??
                    n(e.numberAnalystEstimatedEps) ??
                    n(e.numberAnalystEstimatedRevenue),
            })),
            estimatesShortTerm: U.arr(qs.estimates), // Yahoo : 0q/+1q/0y/+1y
            analystCount: n(qs.numberOfAnalystOpinions),
            guidance: null, // Non disponible via les APIs gratuites retenues
        };

        // ---------- Sante financiere ----------
        const fcfHist = cashAsc.map((r) => ({ year: U.year(r), value: n(r.freeCashFlow) }));
        const yahooDE = n(qs.debtToEquity); // Yahoo exprime en % -> /100
        const health = {
            netDebtToEbitda: n(latestRatio.netDebtToEBITDA) ?? n(kmTtm.netDebtToEBITDATTM),
            debtToEquity:
                n(latestRatio.debtEquityRatio) ??
                n(rTtm.debtEquityRatioTTM) ??
                (yahooDE != null ? yahooDE / 100 : null),
            currentRatio:
                n(latestRatio.currentRatio) ?? n(qs.currentRatio) ?? n(rTtm.currentRatioTTM),
            quickRatio: n(latestRatio.quickRatio) ?? n(qs.quickRatio) ?? n(rTtm.quickRatioTTM),
            // FMP renvoie 0 quand il n'y a aucune charge d'interets a couvrir (division
            // par zero cote fournisseur). Une societe sans dette etait alors notee
            // 0/100 sur ce critere, avec la mention "interets couverts 0,0 x".
            interestCoverage: (() => {
                const ic =
                    n(latestRatio.interestCoverage) ??
                    n(rTtm.interestCoverageTTM) ??
                    n(kmTtm.interestCoverageTTM);
                return ic === 0 ? null : ic;
            })(),
            fcfHistory: fcfHist,
            fcfTrend: U.trend(fcfHist.map((p) => p.value)),
            totalCash: n(qs.totalCash),
            totalDebt: n(qs.totalDebt),
        };

        // ---------- Rentabilite ----------
        const marginHistory = {
            gross: ratiosAsc.map((r) => ({ year: U.year(r), value: pctU(n(r.grossProfitMargin)) })),
            operating: ratiosAsc.map((r) => ({
                year: U.year(r),
                value: pctU(n(r.operatingProfitMargin)),
            })),
            net: ratiosAsc.map((r) => ({ year: U.year(r), value: pctU(n(r.netProfitMargin)) })),
        };
        const lastOf = (s) => (s.length ? s[s.length - 1].value : null);
        const profitability = {
            roe: n(fund.roeTTM) ?? pctU(n(qs.returnOnEquity)) ?? pctU(n(rTtm.returnOnEquityTTM)),
            roa: pctU(n(qs.returnOnAssets)) ?? pctU(n(rTtm.returnOnAssetsTTM)),
            roic: pctU(n(kmTtm.roicTTM)) ?? pctU(n(kmTtm.returnOnInvestedCapitalTTM)),
            grossMargin: pctU(n(qs.grossMargins)) ?? lastOf(marginHistory.gross),
            operatingMargin: pctU(n(qs.operatingMargins)) ?? lastOf(marginHistory.operating),
            netMargin:
                n(fund.netMarginTTM) ?? pctU(n(qs.profitMargins)) ?? lastOf(marginHistory.net),
            marginHistory,
        };

        // ---------- Sentiment de marche & positionnement ----------
        const recoRow = U.arr(x.reco)[0] || null;
        const consensus = recoRow
            ? {
                  strongBuy: recoRow.strongBuy ?? null,
                  buy: recoRow.buy ?? null,
                  hold: recoRow.hold ?? null,
                  sell: recoRow.sell ?? null,
                  strongSell: recoRow.strongSell ?? null,
              }
            : qs.recommendationTrend && Object.values(qs.recommendationTrend).some((v) => v != null)
              ? qs.recommendationTrend
              : null;
        const insiderList = x.insider && Array.isArray(x.insider.data) ? x.insider.data : [];
        let insBought = 0,
            insSold = 0;
        insiderList.forEach((t) => {
            const c = n(t.change) || 0;
            if (c > 0) insBought += c;
            else insSold += Math.abs(c);
        });
        const sentiment = {
            consensus,
            recommendationKey: qs.recommendationKey || null,
            // Echelle 1 (achat fort) a 5 (vente forte) : un 0 n'est pas un consensus
            // mais l'absence de donnee renvoyee telle quelle par le fournisseur.
            // Non filtre, il etait note 100/100 avec la mention "consensus a 0,0 / 5".
            recommendationMean: (() => {
                const rm = n(qs.recommendationMean);
                return rm != null && rm >= 1 && rm <= 5 ? rm : null;
            })(),
            targetMean: n(qs.targetMeanPrice),
            targetLow: n(qs.targetLowPrice),
            targetHigh: n(qs.targetHighPrice),
            targetMedian: n(qs.targetMedianPrice),
            analystCount: n(qs.numberOfAnalystOpinions),
            ptRevisions: null, // Non disponible
            institutionalOwnership: pctU(n(qs.heldPercentInstitutions)),
            insiderOwnership: pctU(n(qs.heldPercentInsiders)),
            insider: insiderList.length
                ? {
                      windowDays: 180,
                      bought: insBought || 0,
                      sold: insSold || 0,
                      net: insBought - insSold,
                      count: insiderList.length,
                  }
                : null,
            shortPercentOfFloat: pctU(n(qs.shortPercentOfFloat)),
            shortRatio: n(qs.shortRatio),
        };

        // ---------- Dividende ----------
        const dividend = this._dividendBlock(U.arr(x.dividends), {
            yieldPct:
                n(fund.dividendYield) ??
                pctU(n(qs.dividendYield)) ??
                pctU(n(rTtm.dividendYieldTTM)),
            payoutRatio: n(qs.payoutRatio) ?? n(rTtm.payoutRatioTTM) ?? n(latestRatio.payoutRatio),
            ratePerShare: n(qs.dividendRate),
            avgYield5y: n(qs.fiveYearAvgDividendYield), // Yahoo : deja en unites de %
            exDate: qs.exDividendDate || null,
        });

        const technical = this._technicalBlock(x.history, priceBlock, qs);

        // ---------- Qualitatif / risques ----------
        // Rien n'est redige ici : la description vient telle quelle de l'emetteur
        // (Yahoo assetProfile ou FMP) et les risques se limitent aux scores
        // reellement publies par l'API. Si l'API ne fournit rien, le rendu laisse
        // la sous-section de cote plutot que d'inventer un contenu.
        const gov = qs.governance || {};
        const governance = {
            overall: n(gov.overall),
            audit: n(gov.audit),
            board: n(gov.board),
            compensation: n(gov.compensation),
            shareholderRights: n(gov.shareholderRights),
        };
        const risks = {
            beta: n(qs.beta) ?? n(fund.beta),
            governance,
            hasGovernance: Object.keys(governance).some((k) => governance[k] != null),
        };

        return {
            symbol: x.symbol,
            asOf: Utils.getDateString(new Date()),
            isUS: !x.nonUS,
            identity,
            price: priceBlock,
            valuation,
            growth,
            health,
            profitability,
            sentiment,
            dividend,
            risks,
            peersSymbols: this._peerSymbols(x.peersRaw, x.symbol),
            priceHistory: x.history || {}, // brut, series utilisees en phase 7
            earnings: x.earn || null,
            technical,
            score: this._scoreBlock({
                valuation,
                growth,
                health,
                profitability,
                sentiment,
                technical,
                price: priceBlock,
            }),
            meta: {
                errors: x.errors,
                fmpUnavailable,
                sources: {
                    quote: qs.source ? 'yahoo' : fund.price != null ? 'yahoo' : null,
                    ratios: fund.fundamentalsSource || null,
                    statements: U.arr(x.ratios).length ? 'fmp' : null,
                    analysts: U.arr(x.reco).length
                        ? 'finnhub'
                        : qs.numberOfAnalystOpinions != null
                          ? 'yahoo'
                          : null,
                },
            },
        };
    },

    // ---------- Score global ----------
    // Bareme volontairement explicite, pour pouvoir l'ajuster sans relire le code :
    //  1. chaque critere est note de 0 a 100 par interpolation lineaire entre deux
    //     bornes documentees — `lo` vaut la note 0, `hi` la note 100. Quand
    //     lo > hi, le sens est inverse (ex : le PER, ou plus bas vaut mieux).
    //  2. un sous-score est la MOYENNE SIMPLE des criteres reellement disponibles :
    //     une donnee absente est ignoree, elle ne penalise pas la valeur.
    //  3. le score global est la moyenne PONDEREE des sous-scores disponibles, les
    //     poids etant renormalises sur ceux qui ont pu etre calcules.
    // Pour ajuster le comportement : SCORE_WEIGHTS (importance relative de chaque
    // dimension), les bornes lo/hi de chaque critere ci-dessous, ou
    // SIGNAL_THRESHOLDS (points de bascule Achat / Conserver / Vente).
    SCORE_WEIGHTS: {
        valuation: 0.25, // cherete du titre
        growth: 0.2, // dynamique du chiffre d'affaires et du benefice
        health: 0.2, // solidite du bilan
        profitability: 0.25, // qualite economique de l'entreprise
        momentum: 0.1, // consensus des analystes + configuration technique
    },
    SIGNAL_THRESHOLDS: { buy: 65, hold: 45 }, // >= 65 Achat, >= 45 Conserver, sinon Vente
    SCORE_MIN_SUBS: 2, // en dessous, pas de score global

    // Note 0-100 d'une valeur entre deux bornes (`lo` = 0, `hi` = 100), bornee.
    _scoreLinear(v, lo, hi) {
        if (v == null || !isFinite(v)) return null;
        return Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
    },

    // Meme note, pour un multiple qui n'a de sens que positif (PER, PEG,
    // VE/EBITDA, dette / fonds propres). Ces criteres sont notes en sens
    // inverse (`lo` > `hi`), donc une valeur negative -- perte, EBITDA negatif,
    // fonds propres negatifs -- serait clampee a 100/100 alors que c'est le
    // pire cas possible. On la note donc 0 plutot que de l'ecarter : une perte
    // est une mauvaise nouvelle, pas une donnee manquante.
    _scoreLinearPositive(v, lo, hi) {
        if (v == null || !isFinite(v)) return null;
        return v <= 0 ? 0 : this._scoreLinear(v, lo, hi);
    },

    // Moyenne des criteres disponibles + justification en une ligne, construite
    // a partir du critere le plus favorable et du plus defavorable (chiffres
    // reels, jamais de commentaire generique).
    _scoreCriteria(list) {
        const kept = list.filter((c) => c && c.score != null && isFinite(c.score));
        if (!kept.length)
            return {
                value: null,
                note: 'Données insuffisantes pour noter cette dimension.',
                used: 0,
                total: list.length,
            };
        const value = kept.reduce((s, c) => s + c.score, 0) / kept.length;
        const sorted = kept.slice().sort((a, b) => b.score - a.score);
        const notes = [sorted[0].note];
        if (sorted.length > 1) notes.push(sorted[sorted.length - 1].note);
        return { value, note: notes.join(' ; '), used: kept.length, total: list.length };
    },

    // Un ratio de rentabilite dont le denominateur est negatif change de signe et
    // devient ininterpretable. On le detecte pour l'ecarter partout de la meme
    // facon : notation, donnees envoyees au modele, affichage.
    _profitabilityFlags(a) {
        const v = (a && a.valuation) || {},
            h = (a && a.health) || {},
            p = (a && a.profitability) || {};
        // Fonds propres negatifs (pertes accumulees ou rachats d'actions massifs) :
        // une perte divisee par des fonds propres negatifs ressort en ROE positif,
        // souvent enorme. Trois indices, dont la contradiction de signe avec la
        // marge nette, qui ne demande aucune donnee supplementaire.
        const negativeEquity =
            (v.pb != null && v.pb < 0) ||
            (h.debtToEquity != null && h.debtToEquity < 0) ||
            (p.roe > 0 && p.netMargin < 0);
        // Meme symptome sur le capital investi, plus rare : celui-ci reste positif
        // tant que la dette compense les fonds propres negatifs.
        const roicBroken = p.roic > 0 && p.netMargin < 0;
        return { negativeEquity, roeReliable: !negativeEquity, roicReliable: !roicBroken };
    },

    _scoreBlock(b) {
        const L = (v, lo, hi) => this._scoreLinear(v, lo, hi);
        const LP = (v, lo, hi) => this._scoreLinearPositive(v, lo, hi);
        const nf = (x, d = 1) =>
            new Intl.NumberFormat('fr-FR', {
                minimumFractionDigits: d,
                maximumFractionDigits: d,
            }).format(x);
        const mult = (x) => nf(x) + ' ×';
        const pct = (x) => Utils.formatPercent(x, false);
        const v = b.valuation || {},
            g = b.growth || {},
            h = b.health || {};
        const p = b.profitability || {},
            s = b.sentiment || {},
            t = b.technical || {};
        const h5 = v.hist5y || {};

        // Valorisation : bornes calees sur les extremes usuels des grandes capis.
        // Le rapport a l'historique n'a de sens qu'entre deux PER positifs :
        // sinon son signe s'inverse et la comparaison devient trompeuse.
        const peVsHist = v.peTTM > 0 && h5.pe > 0 ? v.peTTM / h5.pe : null;
        const valuation = this._scoreCriteria([
            {
                score: LP(v.peTTM, 45, 10),
                note:
                    v.peTTM == null
                        ? null
                        : `PER de ${mult(v.peTTM)}${v.peTTM <= 0 ? ' (bénéfice négatif)' : ''}`,
            },
            {
                score: LP(peVsHist, 1.5, 0.7),
                note:
                    peVsHist == null
                        ? null
                        : `PER ${peVsHist >= 1 ? 'au-dessus' : 'en dessous'} de sa moyenne 5 ans (${mult(h5.pe)})`,
            },
            { score: LP(v.peg, 3, 1), note: v.peg == null ? null : `PEG de ${mult(v.peg)}` },
            {
                score: LP(v.evEbitda, 25, 8),
                note:
                    v.evEbitda == null
                        ? null
                        : `VE/EBITDA de ${mult(v.evEbitda)}${v.evEbitda <= 0 ? ' (EBITDA négatif)' : ''}`,
            },
            {
                score: L(v.fcfYield, 0, 8),
                note:
                    v.fcfYield == null ? null : `rendement du free cash-flow de ${pct(v.fcfYield)}`,
            },
        ]);

        // Croissance : 20 %/an de CA ou de BPA = note maximale.
        const growth = this._scoreCriteria([
            {
                score: L(g.revenueGrowthYoyPct, 0, 20),
                note:
                    g.revenueGrowthYoyPct == null
                        ? null
                        : `chiffre d'affaires à ${Utils.formatPercent(g.revenueGrowthYoyPct)} sur un an`,
            },
            {
                score: L(g.revenueCagrPct, 0, 15),
                note:
                    g.revenueCagrPct == null
                        ? null
                        : `CA en croissance de ${Utils.formatPercent(g.revenueCagrPct)} par an sur l'historique`,
            },
            {
                score: L(g.epsCagrPct, 0, 20),
                note:
                    g.epsCagrPct == null
                        ? null
                        : `bénéfice par action à ${Utils.formatPercent(g.epsCagrPct)} par an`,
            },
        ]);

        // Sante : bornes alignees sur les seuils deja utilises par les pastilles.
        const fcfTrendScore = { croissant: 100, stable: 60, décroissant: 20 }[h.fcfTrend];
        // Ici une valeur negative est une bonne nouvelle (tresorerie nette), donc
        // pas de garde sur le signe -- SAUF si l'EBITDA lui-meme est negatif, ou
        // le ratio n'est plus interpretable dans un sens ni dans l'autre. Un
        // VE/EBITDA negatif signale un EBITDA negatif (la VE etant positive).
        const ebitdaNegatif = v.evEbitda != null && v.evEbitda <= 0;
        const health = this._scoreCriteria([
            {
                score: ebitdaNegatif ? null : L(h.netDebtToEbitda, 4, 0),
                note:
                    h.netDebtToEbitda == null || ebitdaNegatif
                        ? null
                        : `dette nette à ${mult(h.netDebtToEbitda)} l'EBITDA`,
            },
            // Pas de `LP` ici : zero dette est le meilleur cas, seul le negatif
            // (fonds propres negatifs) est pathologique.
            {
                score: h.debtToEquity < 0 ? 0 : L(h.debtToEquity, 2.5, 0.3),
                note:
                    h.debtToEquity == null
                        ? null
                        : `dette sur fonds propres à ${mult(h.debtToEquity)}${h.debtToEquity < 0 ? ' (fonds propres négatifs)' : ''}`,
            },
            {
                score: L(h.currentRatio, 0.8, 2),
                note:
                    h.currentRatio == null ? null : `liquidité générale à ${mult(h.currentRatio)}`,
            },
            {
                score: L(h.interestCoverage, 2, 15),
                note:
                    h.interestCoverage == null
                        ? null
                        : `intérêts couverts ${mult(h.interestCoverage)}`,
            },
            {
                score: fcfTrendScore == null ? null : fcfTrendScore,
                note: h.fcfTrend ? `free cash-flow ${h.fcfTrend}` : null,
            },
        ]);

        // ROE et ROIC ecartes (et non notes 0) quand leur denominateur est negatif :
        // le ratio ne dit alors rien de la rentabilite reelle, ni en bien ni en mal
        // -- une societe tres profitable qui rachete massivement ses actions est
        // dans ce cas. Les marges, insensibles au bilan, portent le sous-score.
        const prof = this._profitabilityFlags(b);
        const profitability = this._scoreCriteria([
            {
                score: prof.roeReliable ? L(p.roe, 5, 30) : null,
                note: p.roe == null || !prof.roeReliable ? null : `ROE de ${pct(p.roe)}`,
            },
            {
                score: prof.roicReliable ? L(p.roic, 4, 20) : null,
                note: p.roic == null || !prof.roicReliable ? null : `ROIC de ${pct(p.roic)}`,
            },
            {
                score: L(p.netMargin, 2, 25),
                note: p.netMargin == null ? null : `marge nette de ${pct(p.netMargin)}`,
            },
            {
                score: L(p.operatingMargin, 4, 30),
                note:
                    p.operatingMargin == null
                        ? null
                        : `marge opérationnelle de ${pct(p.operatingMargin)}`,
            },
        ]);

        // Momentum : consensus (1 = achat fort, 5 = vente forte) + technique.
        const price = b.price && b.price.current;
        const upside = price && s.targetMean ? ((s.targetMean - price) / price) * 100 : null;
        const trendScore = { haussière: 100, neutre: 55, baissière: 20 }[t.trend];
        // RSI : survente = potentiel de rebond, surachat = point d'entree tardif.
        const rsiScore =
            t.rsiZone == null ? null : { survente: 85, neutre: 60, surachat: 35 }[t.rsiZone];
        const momentum = this._scoreCriteria([
            {
                score: L(s.recommendationMean, 4, 1.5),
                note:
                    s.recommendationMean == null
                        ? null
                        : `consensus analystes à ${nf(s.recommendationMean)} / 5`,
            },
            {
                score: L(upside, -10, 30),
                note:
                    upside == null
                        ? null
                        : `objectif moyen à ${Utils.formatPercent(upside)} du cours`,
            },
            {
                score: trendScore == null ? null : trendScore,
                note: t.trend ? `tendance ${t.trend} (MM 50 / MM 200)` : null,
            },
            {
                score: rsiScore == null ? null : rsiScore,
                note: t.rsi14 == null ? null : `RSI à ${nf(t.rsi14, 0)} (${t.rsiZone})`,
            },
        ]);

        const defs = [
            { key: 'valuation', label: 'Valorisation', res: valuation },
            { key: 'growth', label: 'Croissance', res: growth },
            { key: 'health', label: 'Santé financière', res: health },
            { key: 'profitability', label: 'Rentabilité', res: profitability },
            { key: 'momentum', label: 'Sentiment & technique', res: momentum },
        ];
        const subs = defs.map((d) => ({
            key: d.key,
            label: d.label,
            weight: this.SCORE_WEIGHTS[d.key],
            value: d.res.value,
            note: d.res.note,
            used: d.res.used,
            total: d.res.total,
        }));

        const avail = subs.filter((x) => x.value != null);
        const wsum = avail.reduce((acc, x) => acc + x.weight, 0);
        const global =
            avail.length >= this.SCORE_MIN_SUBS && wsum > 0
                ? avail.reduce((acc, x) => acc + x.value * x.weight, 0) / wsum
                : null;
        const T = this.SIGNAL_THRESHOLDS;
        const signal =
            global == null
                ? null
                : global >= T.buy
                  ? 'Achat'
                  : global >= T.hold
                    ? 'Conserver'
                    : 'Vente';

        return { global, signal, subs, subsUsed: avail.length, weightCoverage: wsum };
    },

    // ---------- Donnees transmises au modele pour l'analyse redigee ----------
    // Rien n'est recalcule ni scrappe ici : on ne fait que re-exposer, sous une
    // forme lisible par un LLM, ce que les phases precedentes ont deja normalise
    // et note. Chaque metrique absente est listee dans `nonDisponible` pour que
    // le modele en fasse une limite de l'analyse plutot que de la deviner.
    _aiMetricGroups(a) {
        const v = a.valuation || {},
            h5 = v.hist5y || {},
            g = a.growth || {},
            h = a.health || {};
        const p = a.profitability || {},
            s = a.sentiment || {},
            t = a.technical || {};
        const d = a.dividend || {},
            pr = a.price || {},
            r = a.risks || {};
        const price = pr.current;
        // Meme garde que _scoreBlock : un objectif nul ou negatif n'en est pas un.
        const targetMean = s.targetMean != null && s.targetMean > 0 ? s.targetMean : null;
        const upside = price && targetMean ? ((targetMean - price) / price) * 100 : null;
        const prof = this._profitabilityFlags(a);
        return {
            valorisation: {
                'PER (12 derniers mois)': v.peTTM,
                'PER prévisionnel': v.peForward,
                "PER moyen sur l'historique disponible": h5.pe,
                PEG: v.peg,
                'Cours / actif net (P/B)': v.pb,
                "Cours / chiffre d'affaires (P/S)": v.ps,
                'VE / EBITDA': v.evEbitda,
                'Rendement du free cash-flow (%)': v.fcfYield,
            },
            croissance: {
                "Croissance du chiffre d'affaires sur 1 an (%)": g.revenueGrowthYoyPct,
                'Croissance du bénéfice par action sur 1 an (%)': g.epsGrowthYoyPct,
                "Croissance annualisée du chiffre d'affaires sur l'historique (%)":
                    g.revenueCagrPct,
                'Croissance annualisée du bénéfice par action (%)': g.epsCagrPct,
            },
            santeFinanciere: {
                'Dette nette / EBITDA': h.netDebtToEbitda,
                'Dette / fonds propres': h.debtToEquity,
                'Liquidité générale': h.currentRatio,
                'Liquidité réduite': h.quickRatio,
                'Couverture des intérêts': h.interestCoverage,
                'Tendance du free cash-flow': h.fcfTrend,
            },
            rentabilite: {
                // Signale explicitement au modele pourquoi le ratio est ecarte,
                // plutot que de le laisser croire a une donnee simplement absente.
                'ROE (%)': prof.roeReliable
                    ? p.roe
                    : p.roe == null
                      ? null
                      : 'non significatif (fonds propres négatifs)',
                'ROA (%)': p.roa,
                'ROIC (%)': prof.roicReliable
                    ? p.roic
                    : p.roic == null
                      ? null
                      : 'non significatif (capital investi négatif)',
                'Marge brute (%)': p.grossMargin,
                'Marge opérationnelle (%)': p.operatingMargin,
                'Marge nette (%)': p.netMargin,
            },
            sentimentTechnique: {
                'Consensus analystes (1 = achat fort, 5 = vente forte)': s.recommendationMean,
                "Nombre d'analystes suivant la valeur": s.analystCount,
                'Objectif de cours moyen': targetMean,
                'Écart entre objectif moyen et cours actuel (%)': upside,
                'Détention institutionnelle (%)': s.institutionalOwnership,
                'Vente à découvert (% du flottant)': s.shortPercentOfFloat,
                'Tendance (moyennes mobiles 50 / 200)': t.trend,
                'RSI 14 jours': t.rsi14,
                'Zone RSI': t.rsiZone,
                'Position dans le range 52 semaines (%)': t.rangePosition52,
                Bêta: r.beta,
            },
            dividende: {
                'Rendement du dividende (%)': d.yieldPct,
                'Rendement moyen sur 5 ans (%)': d.avgYield5y,
                'Taux de distribution (fraction du bénéfice)': d.payoutRatio,
                'Années consécutives de hausse du dividende': d.paysDividend
                    ? d.growthStreakYears
                    : null,
            },
        };
    },

    // Arrondi d'affichage : inutile d'envoyer 12 decimales au modele, et cela
    // reduit d'autant les tokens d'entree.
    _aiNum(x) {
        if (typeof x !== 'number' || !isFinite(x)) return null;
        return Math.round(x * 100) / 100;
    },

    buildAiPayload(a, news = []) {
        if (!a) return null;
        const groups = this._aiMetricGroups(a);
        const paysDividend = !!(a.dividend && a.dividend.paysDividend);
        const metriques = {};
        const nonDisponible = [];

        Object.keys(groups).forEach((section) => {
            const kept = {};
            Object.entries(groups[section]).forEach(([label, raw]) => {
                const value = typeof raw === 'number' ? this._aiNum(raw) : (raw ?? null);
                if (value === null || value === undefined || value === '') {
                    // Une valeur qui ne distribue rien n'a pas de metrique de
                    // dividende "manquante" : la signaler comme une limite de
                    // l'analyse serait faux.
                    if (section !== 'dividende' || paysDividend) nonDisponible.push(label);
                } else kept[label] = value;
            });
            metriques[section] = kept;
        });

        const sc = a.score || {};
        const id = a.identity || {},
            pr = a.price || {};
        // `poidsDansLeScorePct` est le poids REELLEMENT applique : les poids sont
        // renormalises sur les seules dimensions notees (cf. _scoreBlock), sans
        // quoi le modele recomposerait une moyenne differente du score affiche.
        const cover = sc.weightCoverage;
        const subs = AnalysisUtils.arr(sc.subs).map((s) => ({
            dimension: s.label,
            score: s.value == null ? null : Math.round(s.value),
            poidsDansLeScorePct:
                s.value == null || !cover ? null : Math.round((s.weight / cover) * 100),
            justificationCalculee: s.note,
            criteresDisponibles: `${s.used} sur ${s.total}`,
        }));

        return {
            symbol: a.symbol,
            nom: id.name || a.symbol,
            secteur: id.sector || null,
            industrie: id.industry || null,
            pays: id.country || null,
            devise: id.currency || null,
            capitalisation: this._aiNum(pr.marketCap),
            coursActuel: this._aiNum(pr.current),
            variationJourPct: this._aiNum(pr.changePct),
            dateDonnees: a.asOf,
            scoreGlobal: sc.global == null ? null : Math.round(sc.global),
            signal: sc.signal,
            seuilsSignal: `Achat à partir de ${this.SIGNAL_THRESHOLDS.buy}/100, Conserver à partir de ${this.SIGNAL_THRESHOLDS.hold}/100, Vente en dessous`,
            sousScores: subs,
            verseUnDividende: paysDividend,
            metriques,
            actualitesRecentes: AnalysisUtils.arr(news)
                .slice(0, 5)
                .map((n) => ({
                    titre: n.title || null,
                    source: n.source || null,
                    date: n.date || null,
                }))
                .filter((n) => n.titre),
            nonDisponible,
        };
    },

    _dividendBlock(divList, base) {
        const paysDividend = divList.length > 0 || (base.yieldPct != null && base.yieldPct > 0);
        const byYear = {};
        divList.forEach((d) => {
            const y = (d.date || '').slice(0, 4);
            if (y) byYear[y] = (byYear[y] || 0) + (Number(d.amountPerShare) || 0);
        });
        const years = Object.keys(byYear).sort();
        const fullYears = years.slice(0, -1); // l'annee courante est souvent incomplete
        let streak = 0;
        for (let i = fullYears.length - 1; i > 0; i--) {
            if (byYear[fullYears[i]] > byYear[fullYears[i - 1]] * 1.001) streak++;
            else break;
        }
        return {
            paysDividend,
            yieldPct: base.yieldPct,
            avgYield5y: base.avgYield5y ?? null,
            ratePerShare: base.ratePerShare,
            payoutRatio: base.payoutRatio, // fraction (0.42) — cf. formatage en phase 8
            growthStreakYears: paysDividend ? streak : 0,
            annualPerShare: years.map((y) => ({ year: y, value: byYear[y] })),
            lastPayment: divList.length ? divList[divList.length - 1] : null,
            exDate: base.exDate ?? null, // prochain (ou dernier) detachement connu
        };
    },

    // ---------- Analyse technique ----------
    // Tout est calcule en JS a partir de la serie de cloture deja telechargee
    // (15 mois glissants) : aucune requete supplementaire.
    // Conventions : `null` si la profondeur d'historique est insuffisante,
    // pourcentages en unites de % (12.8 = 12,8 %).

    // Moyenne mobile simple : renvoie une serie de meme longueur, null avant la
    // periode de chauffe (index < n-1).
    _sma(values, n) {
        const out = new Array(values.length).fill(null);
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i];
            if (i >= n) sum -= values[i - n];
            if (i >= n - 1) out[i] = sum / n;
        }
        return out;
    },

    // RSI 14 (lissage de Wilder) : 0 = survente extreme, 100 = surachat extreme.
    _rsi(values, n = 14) {
        if (values.length <= n) return null;
        let gain = 0,
            loss = 0;
        for (let i = 1; i <= n; i++) {
            const d = values[i] - values[i - 1];
            if (d >= 0) gain += d;
            else loss -= d;
        }
        gain /= n;
        loss /= n;
        for (let i = n + 1; i < values.length; i++) {
            const d = values[i] - values[i - 1];
            gain = (gain * (n - 1) + Math.max(d, 0)) / n;
            loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
        }
        if (loss === 0) return gain === 0 ? 50 : 100;
        return 100 - 100 / (1 + gain / loss);
    },

    _technicalBlock(history, price, qs) {
        // RSI, moyennes mobiles, tendance et croisements dates seraient du bruit
        // presente comme une lecture du marche : on prefere ne rien afficher.
        if (APIService.isSyntheticHistory(history)) return null;
        const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
        const dates = Object.keys(history || {})
            .sort()
            .filter((d) => n(Number(history[d])) != null);
        const closes = dates.map((d) => Number(history[d]));
        if (closes.length < 30) return null;

        const last = closes[closes.length - 1];
        const ma50s = this._sma(closes, 50);
        const ma200s = this._sma(closes, 200);
        const ma50 = ma50s[ma50s.length - 1];
        const ma200 = ma200s[ma200s.length - 1];

        // Croisement le plus recent des deux moyennes mobiles.
        // "golden cross" = MA50 repasse au-dessus de MA200 (signal haussier),
        // "death cross" = l'inverse. On remonte l'historique disponible.
        let cross = null,
            crossDate = null,
            crossDaysAgo = null;
        for (let i = closes.length - 1; i > 0; i--) {
            const a = ma50s[i],
                b = ma200s[i],
                pa = ma50s[i - 1],
                pb = ma200s[i - 1];
            if (a == null || b == null || pa == null || pb == null) break;
            if (pa - pb <= 0 && a - b > 0) {
                cross = 'golden';
                crossDate = dates[i];
                crossDaysAgo = closes.length - 1 - i;
                break;
            }
            if (pa - pb >= 0 && a - b < 0) {
                cross = 'death';
                crossDate = dates[i];
                crossDaysAgo = closes.length - 1 - i;
                break;
            }
        }

        // Tendance : alignement cours / MA50 / MA200, la lecture la plus courante.
        let trend = 'neutre';
        if (ma50 != null && ma200 != null) {
            if (last > ma50 && ma50 > ma200) trend = 'haussière';
            else if (last < ma50 && ma50 < ma200) trend = 'baissière';
        }

        const rsi = this._rsi(closes, 14);
        const window52 = closes.slice(-252);
        const high52 =
            price && price.fiftyTwoWeekHigh != null
                ? price.fiftyTwoWeekHigh
                : Math.max(...window52);
        const low52 =
            price && price.fiftyTwoWeekLow != null ? price.fiftyTwoWeekLow : Math.min(...window52);
        const range52 =
            high52 != null && low52 != null && high52 > low52
                ? ((last - low52) / (high52 - low52)) * 100
                : null;

        const volume = n(qs && qs.regularMarketVolume) ?? (price ? n(price.volume) : null);
        const avgVolume = n(qs && qs.averageVolume);

        return {
            lastClose: last,
            points: closes.length,
            ma50,
            ma200,
            priceVsMa50: ma50 == null ? null : ((last - ma50) / ma50) * 100,
            priceVsMa200: ma200 == null ? null : ((last - ma200) / ma200) * 100,
            maSeries: { dates, ma50: ma50s, ma200: ma200s },
            cross,
            crossDate,
            crossDaysAgo,
            trend,
            rsi14: rsi,
            rsiZone: rsi == null ? null : rsi < 30 ? 'survente' : rsi > 70 ? 'surachat' : 'neutre',
            high52,
            low52,
            pctFromHigh52: high52 ? ((last - high52) / high52) * 100 : null,
            pctFromLow52: low52 ? ((last - low52) / low52) * 100 : null,
            rangePosition52: range52,
            volume,
            avgVolume,
            volumeRatio: volume != null && avgVolume ? volume / avgVolume : null,
        };
    },

    _peerSymbols(peersRaw, symbol) {
        let list = [];
        if (Array.isArray(peersRaw)) {
            if (typeof peersRaw[0] === 'string') list = peersRaw;
            else if (peersRaw[0] && Array.isArray(peersRaw[0].peersList))
                list = peersRaw[0].peersList;
        } else if (peersRaw && Array.isArray(peersRaw.peersList)) {
            list = peersRaw.peersList;
        }
        return list.filter((s) => s && s !== symbol).slice(0, 4);
    },
};
