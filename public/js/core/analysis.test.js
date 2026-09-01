/**
 * Agregation d'analyse de valeur : normalisation multi-sources, dividende,
 * technique, pairs, score global, payload IA. Modules importes directement.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AnalysisUtils, AnalysisService } from './analysis.js';
import { APIService } from './api.js';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
    APIService.candleCache = {};
    APIService.quoteCache = {};
});

describe('AnalysisUtils', () => {
    const A = AnalysisUtils;

    it('num : ne garde que les nombres finis', () => {
        expect(A.num(3.2)).toBe(3.2);
        expect(A.num(NaN)).toBeNull();
        expect(A.num(Infinity)).toBeNull();
        expect(A.num('5')).toBeNull();
        expect(A.num(null)).toBeNull();
    });

    it('pctU : fraction -> unite pourcent', () => {
        expect(A.pctU(0.128)).toBeCloseTo(12.8, 6);
        expect(A.pctU(null)).toBeNull();
    });

    it('avg : moyenne en ignorant les trous', () => {
        expect(A.avg([2, 4, null, 6, NaN])).toBe(4);
        expect(A.avg([])).toBeNull();
    });

    it('cagrPct : taux annualise en pourcent', () => {
        expect(A.cagrPct(100, 200, 1)).toBeCloseTo(100, 6);
        expect(A.cagrPct(100, 100, 4)).toBeCloseTo(0, 6);
        expect(A.cagrPct(0, 200, 3)).toBeNull();
    });

    it('trend : classe une serie ancien -> recent', () => {
        expect(A.trend([10, 12, 15, 20])).toBe('croissant');
        expect(A.trend([20, 15, 10])).toBe('décroissant');
        expect(A.trend([10, 10.1, 9.9, 10])).toBe('stable');
        expect(A.trend([5])).toBeNull();
    });
});

describe('AnalysisService._normalize', () => {
    const S = AnalysisService;

    it('fusionne quoteSummary + FMP dans un StockAnalysis normalise', () => {
        const out = S._normalize({
            symbol: 'MSFT',
            nonUS: false,
            errors: [],
            fund: {
                price: 420,
                previousClose: 415,
                peTTM: 35,
                roeTTM: 38.1,
                netMarginTTM: 34,
                dividendYield: 0.72,
                fundamentalsSource: 'finnhub',
            },
            qs: {
                source: 'yahoo-quoteSummary',
                name: 'Microsoft',
                currency: 'USD',
                price: 420.5,
                previousClose: 415,
                forwardPE: undefined,
                peForward: 32,
                pegRatio: 2.1,
                enterpriseToEbitda: 24,
                grossMargins: 0.68,
                operatingMargins: 0.44,
                profitMargins: 0.35,
                revenueGrowth: 0.16,
                earningsGrowth: 0.2,
                heldPercentInstitutions: 0.73,
                shortPercentOfFloat: 0.006,
                numberOfAnalystOpinions: 45,
                targetMeanPrice: 480,
                targetLowPrice: 400,
                targetHighPrice: 550,
                dividendYield: 0.0072,
                payoutRatio: 0.25,
                debtToEquity: 30,
                exDividendDate: '2025-08-14',
                beta: 0.92,
                governance: {
                    overall: 1,
                    audit: 4,
                    board: 1,
                    compensation: 8,
                    shareholderRights: 1,
                },
                recommendationTrend: { strongBuy: 20, buy: 15, hold: 8, sell: 1, strongSell: 0 },
            },
            ratios: [
                {
                    calendarYear: '2023',
                    priceEarningsRatio: 34,
                    priceToBookRatio: 12,
                    priceToSalesRatio: 11,
                    enterpriseValueMultiple: 23,
                    grossProfitMargin: 0.69,
                    operatingProfitMargin: 0.45,
                    netProfitMargin: 0.36,
                    currentRatio: 1.8,
                    quickRatio: 1.7,
                    debtEquityRatio: 0.35,
                    interestCoverage: 45,
                },
                {
                    calendarYear: '2022',
                    priceEarningsRatio: 30,
                    priceToBookRatio: 11,
                    priceToSalesRatio: 10,
                    enterpriseValueMultiple: 21,
                    grossProfitMargin: 0.68,
                    operatingProfitMargin: 0.42,
                    netProfitMargin: 0.37,
                },
            ],
            income: [
                { calendarYear: '2023', revenue: 211000, eps: 9.7 },
                { calendarYear: '2022', revenue: 198000, eps: 9.2 },
                { calendarYear: '2021', revenue: 168000, eps: 8.0 },
            ],
            cashflow: [
                { calendarYear: '2023', freeCashFlow: 59000 },
                { calendarYear: '2022', freeCashFlow: 65000 },
                { calendarYear: '2021', freeCashFlow: 56000 },
            ],
            keyMetricsTtm: [
                { roicTTM: 0.29, freeCashFlowYieldTTM: 0.025, enterpriseValueOverEBITDATTM: 24.5 },
            ],
            ratiosTtm: [{ peRatioTTM: 35.5, returnOnAssetsTTM: 0.18 }],
            estimatesFmp: [
                {
                    date: '2025-06-30',
                    estimatedRevenueAvg: 250000,
                    estimatedEpsAvg: 12.1,
                    numberAnalystsEstimatedEps: 30,
                },
            ],
            profileFmp: [
                {
                    sector: 'Technology',
                    industry: 'Software',
                    description: 'MSFT desc',
                    website: 'https://microsoft.com',
                },
            ],
            reco: [
                { strongBuy: 22, buy: 14, hold: 7, sell: 1, strongSell: 0, period: '2025-01-01' },
            ],
            insider: { data: [{ change: 1000 }, { change: -400 }] },
            peersRaw: ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META'],
            earn: { date: '2025-07-24' },
            history: { '2025-01-02': 410, '2025-01-03': 415 },
            dividends: [
                { date: '2021-03-01', amountPerShare: 0.56 },
                { date: '2021-06-01', amountPerShare: 0.56 },
                { date: '2022-03-01', amountPerShare: 0.62 },
                { date: '2022-06-01', amountPerShare: 0.62 },
                { date: '2023-03-01', amountPerShare: 0.68 },
                { date: '2023-06-01', amountPerShare: 0.68 },
                { date: '2024-03-01', amountPerShare: 0.75 },
            ],
        });

        expect(out.symbol).toBe('MSFT');
        expect(out.identity.name).toBe('Microsoft');
        expect(out.identity.sector).toBe('Technology');
        expect(out.price.current).toBe(420.5);
        expect(out.price.changePct).toBeCloseTo(((420.5 - 415) / 415) * 100, 4);

        // valorisation : forward P/E de Yahoo, moyenne 5 ans depuis FMP
        expect(out.valuation.peForward).toBe(32);
        expect(out.valuation.hist5y.pe).toBe(32); // (34 + 30) / 2
        expect(out.valuation.evEbitda).toBe(24);

        // croissance : CAGR CA sur 2 pas (168000 -> 211000)
        expect(out.growth.revenueAnnual.map((p) => p.year)).toEqual(['2021', '2022', '2023']);
        expect(out.growth.revenueCagrPct).toBeCloseTo(
            (Math.pow(211000 / 168000, 1 / 2) - 1) * 100,
            4
        );
        expect(out.growth.estimates[0].analysts).toBe(30);
        expect(out.growth.guidance).toBeNull();

        // sante financiere : dette/EBITDA absent -> null, D/E depuis FMP
        expect(out.health.debtToEquity).toBe(0.35);
        expect(out.health.fcfTrend).toBe('croissant'); // 56000 -> 59000

        // rentabilite : marges en unites pourcent
        expect(out.profitability.grossMargin).toBeCloseTo(68, 6);
        expect(out.profitability.roic).toBeCloseTo(29, 6);
        expect(out.profitability.marginHistory.net.map((p) => p.value)).toEqual([37, 36]);

        // sentiment : consensus Finnhub prioritaire, detention instit. en pourcent
        expect(out.sentiment.consensus.strongBuy).toBe(22);
        expect(out.sentiment.institutionalOwnership).toBeCloseTo(73, 6);
        expect(out.sentiment.shortPercentOfFloat).toBeCloseTo(0.6, 6);
        expect(out.sentiment.insider.net).toBe(600);
        expect(out.sentiment.ptRevisions).toBeNull();

        // dividende : verse, 3 hausses consecutives (2021<2022<2023), 2024 exclue
        expect(out.dividend.paysDividend).toBe(true);
        expect(out.dividend.growthStreakYears).toBe(2);
        expect(out.dividend.exDate).toBe('2025-08-14');

        // risques : uniquement ce que l'API publie (beta + scores de gouvernance)
        expect(out.risks.beta).toBe(0.92);
        expect(out.risks.hasGovernance).toBe(true);
        expect(out.risks.governance.compensation).toBe(8);

        // peers : sans le ticker lui-meme, max 4
        expect(out.peersSymbols).toEqual(['AAPL', 'GOOGL', 'AMZN', 'META']);

        // 2 seules seances d'historique -> pas d'analyse technique possible
        expect(out.technical).toBeNull();
        // score global : moyenne ponderee des 5 sous-scores disponibles
        expect(out.score.subs.map((x) => x.key)).toEqual([
            'valuation',
            'growth',
            'health',
            'profitability',
            'momentum',
        ]);
        expect(out.score.subsUsed).toBe(5);
        expect(out.score.weightCoverage).toBeCloseTo(1, 6);
        expect(out.score.global).toBeGreaterThan(0);
        expect(out.score.global).toBeLessThan(100);
        expect(['Achat', 'Conserver', 'Vente']).toContain(out.score.signal);
        // chaque sous-score porte une justification chiffree
        out.score.subs.forEach((x) => expect(x.note.length).toBeGreaterThan(0));
        expect(out.meta.errors).toEqual([]);
    });

    it('donnees manquantes -> null partout, aucun NaN, pas d exception', () => {
        const out = S._normalize({
            symbol: 'XYZ',
            nonUS: true,
            errors: ['fmp:ratios'],
            fund: null,
            qs: null,
            ratios: { unavailable: true },
            income: { unavailable: true },
            cashflow: null,
            keyMetricsTtm: null,
            ratiosTtm: null,
            estimatesFmp: null,
            profileFmp: null,
            reco: null,
            insider: null,
            peersRaw: null,
            earn: null,
            history: null,
            dividends: null,
        });
        expect(out.valuation.peTTM).toBeNull();
        expect(out.valuation.hist5y.pe).toBeNull();
        expect(out.growth.revenueAnnual).toEqual([]);
        expect(out.profitability.roe).toBeNull();
        expect(out.sentiment.consensus).toBeNull();
        expect(out.dividend.paysDividend).toBe(false);
        expect(out.dividend.exDate).toBeNull();
        // aucune donnee de risque publiee -> sous-section laissee de cote au rendu
        expect(out.risks.beta).toBeNull();
        expect(out.risks.hasGovernance).toBe(false);
        expect(out.peersSymbols).toEqual([]);
        expect(out.meta.fmpUnavailable).toBe(true);
        expect(JSON.stringify(out)).not.toContain('NaN');
    });
});

// ---------------------------------------------------------------------------
// Bugs remontes par l'audit des calculs financiers
// ---------------------------------------------------------------------------

describe('_normalize : valeurs sentinelles 0 des fournisseurs', () => {
    const S = AnalysisService;
    const norm = (qs, ratios = []) =>
        S._normalize({
            symbol: 'X',
            nonUS: false,
            errors: [],
            fund: {},
            qs,
            ratios,
            income: [],
            cashflow: [],
            keyMetricsTtm: {},
            ratiosTtm: {},
            estimatesFmp: [],
            profileFmp: {},
            reco: [],
            insider: {},
            peersRaw: [],
            earn: null,
            history: {},
            dividends: [],
        });

    it('un consensus analystes a 0 est une absence de donnee, pas un achat fort', () => {
        // L'echelle va de 1 (achat fort) a 5 (vente forte) : 0 en est hors.
        expect(norm({ recommendationMean: 0 }).sentiment.recommendationMean).toBeNull();
        expect(norm({ recommendationMean: 7 }).sentiment.recommendationMean).toBeNull();
        expect(norm({ recommendationMean: 2.1 }).sentiment.recommendationMean).toBe(2.1);
    });

    it('le consensus a 0 ne rapporte plus 100/100 au sous-score', () => {
        const out = norm({ recommendationMean: 0, targetMeanPrice: 0, price: 100 });
        const mom = out.score.subs.find((s) => s.key === 'momentum');
        expect(mom.value).toBeNull(); // plus aucun critere notable
        expect(String(mom.note)).not.toContain('0,0 / 5');
    });

    it('une couverture des interets a 0 vaut absence de dette, pas 0/100', () => {
        // FMP divise par zero quand il n'y a aucune charge d'interets.
        const zero = norm({}, [
            { calendarYear: '2024', interestCoverage: 0, currentRatio: 3, debtEquityRatio: 0 },
        ]);
        expect(zero.health.interestCoverage).toBeNull();
        const vraie = norm({}, [{ calendarYear: '2024', interestCoverage: 12 }]);
        expect(vraie.health.interestCoverage).toBe(12);

        const sante = zero.score.subs.find((s) => s.key === 'health');
        expect(String(sante.note)).not.toContain('intérêts couverts 0,0');
        expect(sante.value).toBe(100); // aucune dette : que des points forts
    });
});

describe('AnalysisUtils.avgPositive : moyennes de multiples', () => {
    const U = AnalysisUtils;

    it('ecarte les exercices ou le multiple n a pas de sens', () => {
        // Un exercice deficitaire (PER negatif) ecrasait la reference historique.
        expect(U.avg([-50, 25, 28, 30, 26, 27])).toBeCloseTo(14.333, 3);
        expect(U.avgPositive([-50, 25, 28, 30, 26, 27])).toBeCloseTo(27.2, 3);
        expect(U.avgPositive([0, 20, 30])).toBe(25);
        expect(U.avgPositive([-5, -8])).toBeNull();
        expect(U.avgPositive([])).toBeNull();
    });

    it('_normalize : la moyenne historique ignore l exercice deficitaire', () => {
        const S = AnalysisService;
        const out = S._normalize({
            symbol: 'X',
            nonUS: false,
            errors: [],
            fund: {},
            qs: {},
            ratios: [
                { calendarYear: '2022', priceEarningsRatio: -50, enterpriseValueMultiple: -12 },
                { calendarYear: '2023', priceEarningsRatio: 25, enterpriseValueMultiple: 20 },
                { calendarYear: '2024', priceEarningsRatio: 29, enterpriseValueMultiple: 22 },
            ],
            income: [],
            cashflow: [],
            keyMetricsTtm: {},
            ratiosTtm: {},
            estimatesFmp: [],
            profileFmp: {},
            reco: [],
            insider: {},
            peersRaw: [],
            earn: null,
            history: {},
            dividends: [],
        });
        expect(out.valuation.hist5y.pe).toBe(27); // (25 + 29) / 2, pas 1,33
        expect(out.valuation.hist5y.evEbitda).toBe(21);
    });
});

describe('series de cours simulees (repli sans historique reel)', () => {
    const S = AnalysisService;
    const A = APIService;

    const serie = (n) => {
        const h = {};
        for (let i = 0; i < n; i++) {
            const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
            h[d] = 100 + Math.sin(i / 5) * 10;
        }
        return h;
    };

    it('le marqueur reste invisible pour les consommateurs de la serie', () => {
        const h = A.markSyntheticHistory(serie(3));
        expect(Object.keys(h)).toHaveLength(3); // aucune cle parasite
        expect(JSON.parse(JSON.stringify(h))).toEqual({ ...h });
        expect(A.isSyntheticHistory(h)).toBe(true);
        expect(A.isSyntheticHistory(serie(3))).toBe(false);
        expect(A.isSyntheticHistory(null)).toBe(false);
    });

    it('getDailyHistory marque la serie quand le proxy ne renvoie rien', async () => {
        // Proxy muet (reponse vide) -> repli sur la serie simulee, donc marquee.
        globalThis.fetch = /** @type {any} */ (
            async () => ({ ok: true, status: 200, json: async () => ({}) })
        );
        const h = await A.getDailyHistory(
            'ZZZZ',
            new Date('2025-01-01'),
            new Date('2025-03-01'),
            100,
            110
        );
        expect(Object.keys(h).length).toBeGreaterThan(0);
        expect(A.isSyntheticHistory(h)).toBe(true);

        // Une reponse exploitable du proxy n'est evidemment pas marquee. Le cache
        // est indexe par symbole + fenetre : on le vide pour rejouer le meme appel.
        A.candleCache = {};
        globalThis.fetch = /** @type {any} */ (
            async () => ({
                ok: true,
                status: 200,
                json: async () => ({ '2025-01-02': 10, '2025-01-03': 11 }),
            })
        );
        const reel = await A.getDailyHistory(
            'ZZZZ',
            new Date('2025-01-01'),
            new Date('2025-03-01'),
            100,
            110
        );
        expect(A.isSyntheticHistory(reel)).toBe(false);
    });

    it('aucune analyse technique n est deduite d une serie simulee', () => {
        const reelle = serie(120);
        const vraie = S._technicalBlock(reelle, { fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80 }, {});
        expect(vraie).not.toBeNull();
        expect(vraie.rsi14).not.toBeNull();
        expect(vraie.cross === null || typeof vraie.cross === 'string').toBe(true);

        // Meme serie, marquee simulee : ni RSI, ni tendance, ni croisement date.
        const simulee = A.markSyntheticHistory(serie(120));
        expect(S._technicalBlock(simulee, {}, {})).toBeNull();
    });
});

describe('AnalysisService._dividendBlock (phase 8)', () => {
    const S = AnalysisService;

    it('agrege par annee civile et compte les hausses sur exercices complets', () => {
        const out = S._dividendBlock(
            [
                { date: '2021-03-01', amountPerShare: 0.5 },
                { date: '2021-09-01', amountPerShare: 0.5 },
                { date: '2022-03-01', amountPerShare: 0.6 },
                { date: '2022-09-01', amountPerShare: 0.6 },
                { date: '2023-03-01', amountPerShare: 0.7 },
                { date: '2023-09-01', amountPerShare: 0.7 },
                { date: '2024-03-01', amountPerShare: 0.75 },
            ],
            { yieldPct: 2.4, payoutRatio: 0.42, ratePerShare: 1.5, avgYield5y: 1.9 }
        );

        expect(out.paysDividend).toBe(true);
        expect(out.avgYield5y).toBe(1.9);
        expect(out.annualPerShare.map((p) => p.year)).toEqual(['2021', '2022', '2023', '2024']);
        expect(out.annualPerShare[1].value).toBeCloseTo(1.2, 10);
        // 2024 incomplete -> exclue ; 2021 < 2022 < 2023 -> 2 hausses
        expect(out.growthStreakYears).toBe(2);
        expect(out.lastPayment.date).toBe('2024-03-01');
    });

    it('valeur sans dividende : rien a afficher, aucun NaN', () => {
        const out = S._dividendBlock([], { yieldPct: null, payoutRatio: null, ratePerShare: null });
        expect(out.paysDividend).toBe(false);
        expect(out.growthStreakYears).toBe(0);
        expect(out.avgYield5y).toBeNull();
        expect(out.annualPerShare).toEqual([]);
        expect(out.lastPayment).toBeNull();
        expect(JSON.stringify(out)).not.toContain('NaN');
    });
});

describe('AnalysisService : analyse technique (phase 7)', () => {
    const S = AnalysisService;

    it('_sma : moyenne mobile simple, null pendant la periode de chauffe', () => {
        const out = S._sma([1, 2, 3, 4, 5], 3);
        expect(out[0]).toBeNull();
        expect(out[1]).toBeNull();
        expect(out[2]).toBeCloseTo(2, 10);
        expect(out[4]).toBeCloseTo(4, 10);
    });

    it('_rsi : 100 quand la serie ne fait que monter, null si trop courte', () => {
        const up = Array.from({ length: 30 }, (_, i) => 100 + i);
        expect(S._rsi(up, 14)).toBe(100);
        const down = Array.from({ length: 30 }, (_, i) => 200 - i);
        expect(S._rsi(down, 14)).toBeCloseTo(0, 6);
        expect(S._rsi([1, 2, 3], 14)).toBeNull();
    });

    it('_technicalBlock : MM, RSI, position 52 semaines et ratio de volume', () => {
        // 300 seances lineairement haussieres : 100 -> 399
        const history = {};
        const start = new Date('2024-01-01T00:00:00Z');
        for (let i = 0; i < 300; i++) {
            const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
            history[d] = 100 + i;
        }
        const t = S._technicalBlock(
            history,
            { fiftyTwoWeekHigh: 399, fiftyTwoWeekLow: 100, volume: null },
            { regularMarketVolume: 12e6, averageVolume: 8e6 }
        );

        expect(t.points).toBe(300);
        expect(t.lastClose).toBe(399);
        expect(t.ma50).toBeCloseTo(374.5, 6); // moyenne de 350..399
        expect(t.ma200).toBeCloseTo(299.5, 6); // moyenne de 200..399
        expect(t.trend).toBe('haussière');
        expect(t.cross).toBeNull(); // aucun croisement sur une serie monotone
        expect(t.rsi14).toBe(100);
        expect(t.rsiZone).toBe('surachat');
        expect(t.rangePosition52).toBeCloseTo(100, 6);
        expect(t.pctFromHigh52).toBeCloseTo(0, 6);
        expect(t.volumeRatio).toBeCloseTo(1.5, 6);
        expect(t.maSeries.dates.length).toBe(300);
        expect(JSON.stringify(t)).not.toContain('NaN');
    });

    it('_technicalBlock : detecte un golden cross apres un retournement', () => {
        // 260 seances en baisse puis 120 en hausse : la MM50 repasse au-dessus de la MM200
        const history = {};
        const start = new Date('2023-01-01T00:00:00Z');
        const vals = [];
        for (let i = 0; i < 260; i++) vals.push(400 - i);
        for (let i = 0; i < 120; i++) vals.push(140 + i * 3);
        vals.forEach((v, i) => {
            history[new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10)] = v;
        });
        const t = S._technicalBlock(history, {}, {});
        expect(t.cross).toBe('golden');
        expect(t.crossDaysAgo).toBeGreaterThan(0);
        expect(t.crossDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('_technicalBlock : historique trop court -> null (pas de NaN)', () => {
        expect(S._technicalBlock({ '2025-01-02': 10, '2025-01-03': 11 }, {}, {})).toBeNull();
        expect(S._technicalBlock(null, {}, {})).toBeNull();
    });
});

describe('AnalysisService : comparaison sectorielle (phase 10)', () => {
    const S = AnalysisService;

    it('_peerMedians ignore les valeurs absentes metrique par metrique', () => {
        const med = S._peerMedians([
            { peTTM: 10, roe: 20, netMargin: null },
            { peTTM: 20, roe: null, netMargin: 5 },
            { peTTM: 30, roe: 40, netMargin: 15 },
        ]);
        expect(med.peTTM).toBe(20); // impair -> valeur centrale
        expect(med.roe).toBe(30); // pair sur 2 valeurs -> moyenne
        expect(med.netMargin).toBe(10);
        expect(med.marketCap).toBeNull(); // aucune valeur -> null, pas NaN
    });

    it('_peerRow normalise un quoteSummary en pourcentages', () => {
        const r = S._peerRow('MSFT', {
            name: 'Microsoft',
            marketCap: 3.1e12,
            peTrailing: 35,
            profitMargins: 0.36,
            revenueGrowth: 0.16,
            returnOnEquity: 0.39,
        });
        expect(r).toMatchObject({ symbol: 'MSFT', name: 'Microsoft', peTTM: 35 });
        expect(r.netMargin).toBeCloseTo(36, 6);
        expect(r.revenueGrowth).toBeCloseTo(16, 6);
        expect(r.roe).toBeCloseTo(39, 6);
    });

    it('buildPeers : la valeur analysee sert de reference et ne declenche aucune requete', async () => {
        const calls = [];
        const orig = APIService.getQuoteSummary;
        APIService.getQuoteSummary = (s) => {
            calls.push(s);
            return Promise.resolve({
                name: s,
                marketCap: 1e11,
                peTrailing: 20,
                profitMargins: 0.1,
                revenueGrowth: 0.05,
                returnOnEquity: 0.15,
            });
        };
        S._peersCache = {};

        const out = await S.buildPeers({
            symbol: 'AAPL',
            identity: { name: 'Apple Inc' },
            price: { marketCap: 3e12 },
            valuation: { peTTM: 31.2 },
            profitability: { netMargin: 25.3, roe: 150.2 },
            growth: { revenueGrowthYoyPct: 8 },
            peersSymbols: ['MSFT', 'GOOGL'],
        });

        expect(calls).toEqual(['MSFT', 'GOOGL']); // aucun appel pour AAPL
        expect(out.self).toMatchObject({ symbol: 'AAPL', peTTM: 31.2, roe: 150.2, isSelf: true });
        expect(out.peers.map((p) => p.symbol)).toEqual(['MSFT', 'GOOGL']);
        expect(out.median.peTTM).toBe(20); // 20, 20, 31.2
        expect(JSON.stringify(out)).not.toContain('NaN');

        // deuxieme appel : servi par le cache 15 min, aucune requete de plus
        await S.buildPeers({ symbol: 'AAPL', peersSymbols: ['MSFT', 'GOOGL'] });
        expect(calls).toEqual(['MSFT', 'GOOGL']);

        APIService.getQuoteSummary = orig;
    });

    it('buildPeers : sans comparables, renvoie une liste vide sans exception', async () => {
        S._peersCache = {};
        const out = await S.buildPeers({ symbol: 'XYZ.PA', peersSymbols: [] });
        expect(out.peers).toEqual([]);
        expect(out.self.symbol).toBe('XYZ.PA');
    });
});

describe('AnalysisService.buildLight : apercu Yahoo sans quota', () => {
    const S = AnalysisService;

    // Sources gratuites uniquement : toute requete FMP ou Finnhub est un echec.
    function stubApi(overrides = {}) {
        const calls = [];
        const track =
            (name, value) =>
            (...args) => {
                calls.push(name + ':' + args[0]);
                return Promise.resolve(typeof value === 'function' ? value(...args) : value);
            };
        const saved = {};
        const stubs = {
            getFundamentals: track('fundamentals', overrides.fund ?? null),
            getQuoteSummary: track('quoteSummary', overrides.qs ?? null),
            getDailyHistory: track('history', overrides.history ?? {}),
            getDividends: track('dividends', overrides.dividends ?? []),
            getFmp: track('fmp', () => {
                throw new Error('FMP ne doit pas etre appele');
            }),
            getRecommendation: track('reco', () => {
                throw new Error('Finnhub ne doit pas etre appele');
            }),
            getInsiderTransactions: track('insider', () => {
                throw new Error('Finnhub ne doit pas etre appele');
            }),
            getPeers: track('peers', () => {
                throw new Error('Finnhub ne doit pas etre appele');
            }),
            getEarnings: track('earnings', () => {
                throw new Error('Finnhub ne doit pas etre appele');
            }),
        };
        Object.keys(stubs).forEach((k) => {
            saved[k] = APIService[k];
            APIService[k] = stubs[k];
        });
        return {
            calls,
            restore: () => Object.keys(saved).forEach((k) => (APIService[k] = saved[k])),
        };
    }

    afterEach(() => {
        S._cache = {};
        S._lightCache = {};
    });

    it("n'interroge que les sources Yahoo et marque l'analyse comme partielle", async () => {
        const api = stubApi({
            qs: {
                name: 'Apple Inc',
                currency: 'USD',
                price: 192.5,
                marketCap: 3e12,
                peTrailing: 31.2,
                profitMargins: 0.25,
                targetMeanPrice: 220,
                numberOfAnalystOpinions: 38,
            },
        });
        S._cache = {};
        S._lightCache = {};

        const out = await S.buildLight('aapl');
        api.restore();

        expect(out.partial).toBe(true);
        expect(out.symbol).toBe('AAPL');
        expect(out.valuation.peTTM).toBe(31.2);
        expect(out.sentiment.targetMean).toBe(220);
        expect(api.calls.sort()).toEqual([
            'dividends:AAPL',
            'fundamentals:AAPL',
            'history:AAPL',
            'quoteSummary:AAPL',
        ]);
        // Les blocs alimentes par FMP restent vides, jamais inventes.
        expect(out.growth.revenueAnnual).toEqual([]);
        expect(out.health.fcfHistory).toEqual([]);
        expect(out.peersSymbols).toEqual([]);
        expect(out.earnings).toBeNull();
    });

    it('sert le cache puis cede la place a une analyse complete', async () => {
        const api = stubApi({ qs: { name: 'Apple Inc', price: 192.5 } });
        S._cache = {};
        S._lightCache = {};

        await S.buildLight('AAPL');
        await S.buildLight('AAPL');
        expect(api.calls.filter((c) => c.startsWith('quoteSummary'))).toHaveLength(1);

        // Une analyse complete en cache prime sur l'apercu.
        S._cache.AAPL = { ts: Date.now(), data: { symbol: 'AAPL', partial: false } };
        expect(S.cachedLight('AAPL')).toEqual({ symbol: 'AAPL', partial: false });
        api.restore();
    });

    it('une source Yahoo en panne laisse les champs vides sans lever', async () => {
        const api = stubApi({});
        APIService.getQuoteSummary = () => Promise.reject(new Error('proxy HTTP 500'));
        S._cache = {};
        S._lightCache = {};

        const out = await S.buildLight('AAPL');
        api.restore();

        expect(out.partial).toBe(true);
        expect(out.valuation.peTTM).toBeNull();
        expect(out.meta.errors).toContain('quoteSummary');
    });
});

describe('_normalize : replis calcules depuis les seules donnees Yahoo', () => {
    const S = AnalysisService;

    it('deduit le rendement FCF et la dette nette / EBITDA de quoteSummary', () => {
        const out = S._normalize({
            symbol: 'AAPL',
            nonUS: false,
            partial: true,
            errors: [],
            qs: {
                marketCap: 3000,
                freeCashflow: 150,
                totalDebt: 400,
                totalCash: 100,
                ebitda: 200,
            },
        });
        expect(out.valuation.fcfYield).toBeCloseTo(5, 6); // 150 / 3000
        expect(out.health.netDebtToEbitda).toBeCloseTo(1.5, 6); // (400 - 100) / 200
    });

    it("n'invente pas de ratio quand l'EBITDA est nul ou negatif", () => {
        const out = S._normalize({
            symbol: 'XYZ',
            nonUS: false,
            errors: [],
            qs: { marketCap: 0, freeCashflow: 10, totalDebt: 400, totalCash: 100, ebitda: -50 },
        });
        expect(out.valuation.fcfYield).toBeNull();
        expect(out.health.netDebtToEbitda).toBeNull();
        expect(out.partial).toBe(false);
    });
});

describe('AnalysisService : score global (phase 11)', () => {
    const S = AnalysisService;

    it('_scoreLinear interpole et borne, dans les deux sens', () => {
        expect(S._scoreLinear(10, 0, 20)).toBe(50);
        expect(S._scoreLinear(-5, 0, 20)).toBe(0); // borne basse
        expect(S._scoreLinear(50, 0, 20)).toBe(100); // borne haute
        // sens inverse (PER : plus bas vaut mieux)
        expect(S._scoreLinear(10, 45, 10)).toBe(100);
        expect(S._scoreLinear(45, 45, 10)).toBe(0);
        expect(S._scoreLinear(null, 0, 20)).toBeNull();
        expect(S._scoreLinear(NaN, 0, 20)).toBeNull();
    });

    it('_scoreCriteria ignore les criteres absents et justifie avec des chiffres', () => {
        const out = S._scoreCriteria([
            { score: 90, note: 'ROE de 40,0 %' },
            { score: 20, note: 'PER de 44,0 ×' },
            { score: null, note: null },
        ]);
        expect(out.value).toBe(55); // (90 + 20) / 2, le critere absent est ignore
        expect(out.used).toBe(2);
        expect(out.total).toBe(3);
        expect(out.note).toBe('ROE de 40,0 % ; PER de 44,0 ×');
    });

    it('sous-score sans aucune donnee -> null et message explicite', () => {
        const out = S._scoreCriteria([
            { score: null, note: null },
            { score: null, note: null },
        ]);
        expect(out.value).toBeNull();
        expect(out.note).toContain('Données insuffisantes');
    });

    it('_scoreBlock : ponderation renormalisee sur les dimensions disponibles', () => {
        // seules valorisation et rentabilite sont notables ici
        const out = S._scoreBlock({
            valuation: { peTTM: 10, peg: 1, evEbitda: 8, fcfYield: 8, hist5y: { pe: 20 } },
            growth: {},
            health: {},
            sentiment: {},
            technical: {},
            profitability: { roe: 30, roic: 20, netMargin: 25, operatingMargin: 30 },
            price: {},
        });
        expect(out.subsUsed).toBe(2);
        expect(out.weightCoverage).toBeCloseTo(
            S.SCORE_WEIGHTS.valuation + S.SCORE_WEIGHTS.profitability,
            6
        );
        expect(out.global).toBe(100); // tous les criteres au maximum
        expect(out.signal).toBe('Achat');
        expect(out.subs.find((s) => s.key === 'growth').value).toBeNull();
    });

    it('_scoreBlock : signal Vente sur des fondamentaux degrades', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 60, peg: 4, evEbitda: 30, fcfYield: -2, hist5y: { pe: 20 } },
            growth: { revenueGrowthYoyPct: -8, revenueCagrPct: -5, epsCagrPct: -10 },
            health: {
                netDebtToEbitda: 6,
                debtToEquity: 3,
                currentRatio: 0.5,
                interestCoverage: 1,
                fcfTrend: 'décroissant',
            },
            profitability: { roe: 1, roic: 1, netMargin: 0.5, operatingMargin: 1 },
            sentiment: { recommendationMean: 4.5, targetMean: 80 },
            technical: { trend: 'baissière', rsi14: 25, rsiZone: 'survente' },
            price: { current: 100 },
        });
        expect(out.global).toBeLessThan(S.SIGNAL_THRESHOLDS.hold);
        expect(out.signal).toBe('Vente');
        expect(JSON.stringify(out)).not.toContain('NaN');
    });

    // Bug corrige : sur un critere note en sens inverse (`lo` > `hi`), une valeur
    // negative sortait du segment par le haut et etait clampee a 100/100. Une
    // societe en perte decrochait ainsi la note maximale en valorisation.
    it('_scoreLinearPositive : un multiple negatif vaut 0, pas 100', () => {
        expect(S._scoreLinear(-12, 45, 10)).toBe(100); // comportement brut, d'ou la garde
        expect(S._scoreLinearPositive(-12, 45, 10)).toBe(0); // PER negatif = perte
        expect(S._scoreLinearPositive(0, 45, 10)).toBe(0);
        expect(S._scoreLinearPositive(10, 45, 10)).toBe(100); // cas normal inchange
        expect(S._scoreLinearPositive(45, 45, 10)).toBe(0);
        expect(S._scoreLinearPositive(null, 45, 10)).toBeNull();
        expect(S._scoreLinearPositive(NaN, 45, 10)).toBeNull();
    });

    it('_scoreBlock : societe en perte -> valorisation basse, pas maximale', () => {
        const out = S._scoreBlock({
            // PER, PEG et VE/EBITDA negatifs : perte nette ET EBITDA negatif.
            valuation: { peTTM: -12, peg: -2, evEbitda: -8, fcfYield: -3, hist5y: { pe: 20 } },
            growth: { revenueGrowthYoyPct: 30, revenueCagrPct: 25, epsCagrPct: 30 },
            health: {
                netDebtToEbitda: -3,
                debtToEquity: 0.4,
                currentRatio: 2,
                interestCoverage: 12,
                fcfTrend: 'stable',
            },
            profitability: { roe: -10, roic: -8, netMargin: -15, operatingMargin: -12 },
            sentiment: {},
            technical: {},
            price: { current: 100 },
        });
        const val = out.subs.find((s) => s.key === 'valuation');
        expect(val.value).toBe(0);
        expect(val.note).toContain('bénéfice négatif');
        // Le PER negatif rend la comparaison a l'historique ininterpretable :
        // le critere est ecarte au lieu d'etre note a l'envers.
        expect(val.used).toBe(4);
        // Dette nette / EBITDA : sans EBITDA positif le ratio ne veut rien dire,
        // il ne doit pas passer pour une tresorerie nette confortable.
        const hlt = out.subs.find((s) => s.key === 'health');
        expect(hlt.used).toBe(4); // 5 criteres moins la dette nette / EBITDA
        expect(hlt.note).not.toContain("l'EBITDA");
        expect(out.signal).not.toBe('Achat');
    });

    it('_scoreBlock : un VE/EBITDA negatif est signale et note 0', () => {
        const out = S._scoreBlock({
            valuation: { evEbitda: -8 },
            growth: {},
            health: {},
            sentiment: {},
            technical: {},
            profitability: { roe: 25 },
            price: {},
        });
        const val = out.subs.find((s) => s.key === 'valuation');
        expect(val.value).toBe(0);
        expect(val.note).toContain('EBITDA négatif');
    });

    it('_scoreBlock : tresorerie nette et zero dette restent des points forts', () => {
        const out = S._scoreBlock({
            // EBITDA positif : la dette nette negative est bien une tresorerie nette.
            valuation: { peTTM: 15, evEbitda: 10 },
            growth: {},
            sentiment: {},
            technical: {},
            health: {
                netDebtToEbitda: -1.5,
                debtToEquity: 0,
                currentRatio: 3,
                interestCoverage: 40,
                fcfTrend: 'croissant',
            },
            profitability: { roe: 25 },
            price: {},
        });
        const hlt = out.subs.find((s) => s.key === 'health');
        expect(hlt.value).toBe(100);
        expect(hlt.used).toBe(5);
    });

    it('_scoreBlock : fonds propres negatifs notes 0 sur la dette', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 15, evEbitda: 10 },
            growth: {},
            sentiment: {},
            technical: {},
            health: {
                debtToEquity: -1.8,
                currentRatio: 2,
                interestCoverage: 12,
                fcfTrend: 'stable',
            },
            profitability: { roe: 25 },
            price: {},
        });
        const hlt = out.subs.find((s) => s.key === 'health');
        expect(hlt.note).toContain('fonds propres négatifs');
        expect(hlt.value).toBeLessThan(100);
    });

    // Bug corrige : une perte divisee par des fonds propres negatifs ressort en
    // ROE positif et enorme, note 100/100 sur une societe qui detruit du capital.
    it('_scoreBlock : ROE ininterpretable sur fonds propres negatifs', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 15, evEbitda: 10, pb: -3.2 }, // P/B negatif = actif net negatif
            growth: {},
            sentiment: {},
            technical: {},
            health: {
                debtToEquity: -1.8,
                currentRatio: 2,
                interestCoverage: 12,
                fcfTrend: 'stable',
            },
            profitability: { roe: 180, roa: -6, netMargin: -15, operatingMargin: -12 },
            price: {},
        });
        const prof = out.subs.find((s) => s.key === 'profitability');
        expect(prof.note).not.toContain('ROE');
        expect(prof.used).toBe(2); // seules les deux marges sont notees
        expect(prof.value).toBe(0); // marges negatives : rentabilite nulle
        expect(out.signal).not.toBe('Achat');
    });

    // Detection sans P/B ni dette / fonds propres : un ROE positif ne peut pas
    // coexister avec une marge nette negative.
    it('_scoreBlock : ROE positif et marge nette negative -> incoherence detectee', () => {
        const out = S._scoreBlock({
            valuation: { peTTM: 15, evEbitda: 10 },
            growth: {},
            health: {},
            sentiment: {},
            technical: {},
            profitability: { roe: 95, roic: 40, netMargin: -8 },
            price: {},
        });
        const prof = out.subs.find((s) => s.key === 'profitability');
        expect(prof.used).toBe(1); // ROE et ROIC ecartes, reste la marge nette
        expect(prof.value).toBe(0);
    });

    it('_profitabilityFlags : une rentabilite saine reste notee normalement', () => {
        const flags = S._profitabilityFlags({
            valuation: { pb: 8 },
            health: { debtToEquity: 1.2 },
            profitability: { roe: 35, roic: 22, netMargin: 25 },
        });
        expect(flags.negativeEquity).toBe(false);
        expect(flags.roeReliable).toBe(true);
        expect(flags.roicReliable).toBe(true);
        // Fonds propres negatifs mais societe profitable (rachats d'actions) :
        // le ROE reste ecarte, ce n'est ni un bon ni un mauvais signal.
        const buyback = S._profitabilityFlags({
            valuation: { pb: -12 },
            health: {},
            profitability: { roe: 240, roic: 25, netMargin: 22 },
        });
        expect(buyback.roeReliable).toBe(false);
        expect(buyback.roicReliable).toBe(true); // capital investi toujours positif
    });

    it('_scoreBlock : moins de 2 dimensions notables -> pas de score global', () => {
        const out = S._scoreBlock({
            valuation: {},
            growth: {},
            health: {},
            sentiment: {},
            technical: {},
            profitability: { roe: 20 },
            price: {},
        });
        expect(out.subsUsed).toBe(1);
        expect(out.global).toBeNull();
        expect(out.signal).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Phase 13 — donnees envoyees au modele pour l'analyse redigee
// ---------------------------------------------------------------------------

describe('AnalysisService.buildAiPayload (phase 13)', () => {
    const S = AnalysisService;

    const richAnalysis = () => ({
        symbol: 'AAPL',
        asOf: '2026-08-31',
        identity: {
            name: 'Apple Inc.',
            sector: 'Technology',
            industry: 'Consumer Electronics',
            country: 'US',
            currency: 'USD',
        },
        price: { current: 200, changePct: 1.234567, marketCap: 3.1e12 },
        valuation: {
            peTTM: 30.123,
            peForward: 27,
            peg: 2.4,
            pb: 45,
            ps: 8,
            evEbitda: 22,
            fcfYield: 3.4,
            hist5y: { pe: 26 },
        },
        growth: {
            revenueGrowthYoyPct: 6.2,
            epsGrowthYoyPct: 9.1,
            revenueCagrPct: 8,
            epsCagrPct: 12,
        },
        health: {
            netDebtToEbitda: 0.4,
            debtToEquity: 1.5,
            currentRatio: 0.95,
            quickRatio: 0.8,
            interestCoverage: 30,
            fcfTrend: 'croissant',
        },
        profitability: {
            roe: 145,
            roa: 22,
            roic: 40,
            grossMargin: 46,
            operatingMargin: 31,
            netMargin: 25,
        },
        sentiment: {
            recommendationMean: 2.1,
            analystCount: 40,
            targetMean: 240,
            institutionalOwnership: 62,
            shortPercentOfFloat: 0.8,
        },
        technical: { trend: 'haussière', rsi14: 55.6, rsiZone: 'neutre', rangePosition52: 72 },
        dividend: {
            paysDividend: true,
            yieldPct: 0.5,
            avgYield5y: 0.7,
            payoutRatio: 0.15,
            growthStreakYears: 3,
        },
        risks: { beta: 1.2 },
        score: {
            global: 61.7,
            signal: 'Conserver',
            subs: [
                {
                    key: 'valuation',
                    label: 'Valorisation',
                    weight: 0.25,
                    value: 38.4,
                    note: 'PER de 30,1 ×',
                    used: 5,
                    total: 5,
                },
                {
                    key: 'growth',
                    label: 'Croissance',
                    weight: 0.2,
                    value: null,
                    note: 'Données insuffisantes pour noter cette dimension.',
                    used: 0,
                    total: 3,
                },
            ],
        },
    });

    it('un ROE fausse par des fonds propres negatifs est envoye comme non significatif', () => {
        const a = richAnalysis();
        a.valuation.pb = -12; // actif net negatif
        a.profitability.roe = 240;
        const out = S.buildAiPayload(a, []);
        // Ni le chiffre trompeur, ni un simple trou dans les donnees : le modele
        // recoit la raison, pour pouvoir la citer comme limite de l'analyse.
        expect(out.metriques.rentabilite['ROE (%)']).toBe(
            'non significatif (fonds propres négatifs)'
        );
        expect(out.nonDisponible).not.toContain('ROE (%)');
        // Le capital investi reste positif ici : le ROIC n'est pas touche.
        expect(out.metriques.rentabilite['ROIC (%)']).toBe(40);
    });

    it('reprend identite, score, sous-scores et metriques arrondies', () => {
        const p = S.buildAiPayload(richAnalysis(), []);
        expect(p.symbol).toBe('AAPL');
        expect(p.nom).toBe('Apple Inc.');
        expect(p.secteur).toBe('Technology');
        expect(p.scoreGlobal).toBe(62); // arrondi, comme a l'ecran
        expect(p.signal).toBe('Conserver');
        expect(p.variationJourPct).toBe(1.23); // 2 decimales max
        expect(p.metriques.valorisation['PER (12 derniers mois)']).toBe(30.12);
        expect(p.metriques.valorisation["PER moyen sur l'historique disponible"]).toBe(26);
        expect(p.metriques.rentabilite['ROE (%)']).toBe(145);
        expect(p.sousScores[0]).toMatchObject({
            dimension: 'Valorisation',
            score: 38,
            criteresDisponibles: '5 sur 5',
        });
        expect(p.sousScores[1].score).toBeNull();
        expect(p.seuilsSignal).toContain(String(S.SIGNAL_THRESHOLDS.buy));
    });

    it('transmet le poids reellement applique, pas le poids nominal', () => {
        // Une seule dimension notee sur cinq : elle porte 100 % du score global,
        // pas ses 25 % nominaux (les poids sont renormalises par _scoreBlock).
        const a = richAnalysis();
        a.score.subs = [
            {
                key: 'valuation',
                label: 'Valorisation',
                weight: 0.25,
                value: 38.4,
                note: 'PER de 30,1 ×',
                used: 5,
                total: 5,
            },
            {
                key: 'growth',
                label: 'Croissance',
                weight: 0.2,
                value: null,
                note: '—',
                used: 0,
                total: 3,
            },
        ];
        a.score.weightCoverage = 0.25;
        const p = S.buildAiPayload(a, []);

        expect(p.sousScores[0].poidsDansLeScorePct).toBe(100);
        expect(p.sousScores[1].poidsDansLeScorePct).toBeNull();
    });

    it('objectif de cours nul ou negatif : ni objectif ni ecart transmis', () => {
        const a = richAnalysis();
        a.sentiment.targetMean = 0;
        const p = S.buildAiPayload(a, []);

        expect(p.metriques.sentimentTechnique).not.toHaveProperty('Objectif de cours moyen');
        expect(p.nonDisponible).toContain('Objectif de cours moyen');
        expect(p.nonDisponible).toContain('Écart entre objectif moyen et cours actuel (%)');
    });

    it('liste explicitement les metriques absentes au lieu de les omettre en silence', () => {
        const a = richAnalysis();
        a.valuation.peg = null;
        a.profitability.roic = null;
        a.technical.rsi14 = null;
        const p = S.buildAiPayload(a, []);

        expect(p.nonDisponible).toContain('PEG');
        expect(p.nonDisponible).toContain('ROIC (%)');
        expect(p.nonDisponible).toContain('RSI 14 jours');
        // une metrique absente ne doit pas apparaitre aussi dans les valeurs
        expect(p.metriques.valorisation).not.toHaveProperty('PEG');
        expect(p.metriques.rentabilite).not.toHaveProperty('ROIC (%)');
    });

    it('ne transmet que les titres d actualite, jamais le contenu des pages', () => {
        const news = [
            {
                title: 'Résultats trimestriels',
                source: 'lesechos.fr',
                date: '2026-08-20',
                content: 'texte scrappé',
            },
            { title: '', source: 'x.fr' },
        ];
        const p = S.buildAiPayload(richAnalysis(), news);
        expect(p.actualitesRecentes).toEqual([
            { titre: 'Résultats trimestriels', source: 'lesechos.fr', date: '2026-08-20' },
        ]);
        expect(JSON.stringify(p)).not.toContain('texte scrappé');
    });

    it('valeur pauvre en donnees : payload exploitable, aucun NaN, limites listees', () => {
        const p = S.buildAiPayload(
            {
                symbol: 'XYZ.PA',
                asOf: '2026-08-31',
                identity: { name: 'Petite Valeur' },
                price: { current: 12 },
                valuation: {},
                growth: {},
                health: {},
                profitability: { roe: 8 },
                sentiment: {},
                technical: {},
                dividend: {},
                risks: {},
                score: { global: null, signal: null, subs: [] },
            },
            []
        );

        expect(p.scoreGlobal).toBeNull();
        expect(p.nonDisponible.length).toBeGreaterThan(20);
        expect(p.metriques.rentabilite['ROE (%)']).toBe(8);
        expect(JSON.stringify(p)).not.toContain('NaN');
        // borne de taille du payload cote worker (24 000 caracteres)
        expect(JSON.stringify(p).length).toBeLessThan(24000);
    });

    it('valeur sans dividende : rien n est presente comme une metrique manquante', () => {
        const a = richAnalysis();
        a.dividend = /** @type {any} */ ({
            paysDividend: false,
            yieldPct: null,
            avgYield5y: null,
            payoutRatio: null,
        });
        const p = S.buildAiPayload(a, []);

        expect(p.verseUnDividende).toBe(false);
        expect(p.nonDisponible.some((l) => /dividende|distribution/i.test(l))).toBe(false);
        expect(p.metriques.dividende).toEqual({});
    });

    it('valeur distributrice : un dividende reellement absent reste signale', () => {
        const a = richAnalysis();
        a.dividend.avgYield5y = null;
        const p = S.buildAiPayload(a, []);

        expect(p.verseUnDividende).toBe(true);
        expect(p.nonDisponible).toContain('Rendement moyen sur 5 ans (%)');
    });

    it('renvoie null sans analyse', () => {
        expect(S.buildAiPayload(null)).toBeNull();
    });
});
