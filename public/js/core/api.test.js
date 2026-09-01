/**
 * Accès aux données de marché : ce que fait APIService quand le proxy ne
 * répond pas.
 *
 * Règle du module : aucune donnée de marché n'est inventée. Un cours absent est
 * `null`, jamais une valeur codée en dur — sinon l'application affiche une
 * plus-value fausse avec la même autorité qu'une vraie. Le taux de change est
 * la seule exception, et elle est explicitement signalée : sans taux, aucune
 * conversion n'est possible et le portefeuille devient inaffichable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { APIService } from './api.js';
import { CONFIG } from './config.js';

const realFetch = globalThis.fetch;

/** Réponse HTTP minimale. */
function ok(body) {
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
}
function fail(status = 502) {
    return {
        ok: false,
        status,
        json: async () => ({ error: 'proxy indisponible' }),
        text: async () => '',
    };
}

/** Remplace fetch et note les URL demandées. */
function stubFetch(handler) {
    const urls = [];
    globalThis.fetch = /** @type {any} */ (
        async (url) => {
            urls.push(String(url));
            const res = handler(String(url));
            if (res instanceof Error) throw res;
            return res;
        }
    );
    return urls;
}

/** APIService est un singleton : ses caches doivent être vidés entre les tests. */
beforeEach(() => {
    APIService.quoteCache = {};
    APIService.cachedFxRates = {};
    APIService.fxEstimated = {};
});
afterEach(() => {
    globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe('APIService.getCurrentPrice', () => {
    it('renvoie le cours du proxy', async () => {
        stubFetch(() => ok({ price: 187.42 }));
        expect(await APIService.getCurrentPrice('AAPL')).toBe(187.42);
    });

    it('proxy en erreur : null, aucun cours de repli', async () => {
        stubFetch(() => fail());
        expect(await APIService.getCurrentPrice('AAPL')).toBeNull();
    });

    it('reseau injoignable : null', async () => {
        stubFetch(() => new Error('offline'));
        expect(await APIService.getCurrentPrice('AAPL')).toBeNull();
    });

    it('reponse sans prix exploitable : null', async () => {
        stubFetch(() => ok({ price: 0 }));
        expect(await APIService.getCurrentPrice('AAPL')).toBeNull();
    });

    it('un symbole connu de la liste locale ne recoit pas pour autant de cours', async () => {
        // AAPL figure dans KNOWN_SYMBOLS ; c'est une liste de tickers pour la
        // recherche hors ligne, elle ne contient aucun prix.
        expect(CONFIG.KNOWN_SYMBOLS).toContain('AAPL');
        stubFetch(() => fail());
        expect(await APIService.getCurrentPrice('AAPL')).toBeNull();
    });

    it('les lignes de tresorerie valent 1, sans appel reseau', async () => {
        const urls = stubFetch(() => ok({ price: 5 }));
        expect(await APIService.getCurrentPrice('$CASH')).toBe(1.0);
        expect(urls).toHaveLength(0);
    });

    it('un cours obtenu est mis en cache et resiste a une panne suivante', async () => {
        let live = true;
        stubFetch(() => (live ? ok({ price: 100 }) : fail()));
        expect(await APIService.getCurrentPrice('AAPL')).toBe(100);
        live = false;
        // Cache de 5 minutes : le dernier cours reel reste servi.
        expect(await APIService.getCurrentPrice('AAPL')).toBe(100);
    });
});

describe('APIService.getExchangeRate', () => {
    it('USD vaut 1 sans appel reseau', async () => {
        const urls = stubFetch(() => ok({ price: 9 }));
        expect(await APIService.getExchangeRate('USD')).toBe(1);
        expect(urls).toHaveLength(0);
    });

    it('renvoie le taux live et ne signale rien', async () => {
        stubFetch(() => ok({ price: 1.155 }));
        expect(await APIService.getExchangeRate('EUR')).toBe(1.155);
        expect(APIService.fxEstimatedCurrencies()).toEqual([]);
    });

    it('devise inconnue : null', async () => {
        stubFetch(() => ok({ price: 1 }));
        expect(await APIService.getExchangeRate('XYZ')).toBeNull();
    });

    it('panne sans taux connu : estimation de dernier recours, signalee', async () => {
        stubFetch(() => fail());
        expect(await APIService.getExchangeRate('EUR')).toBe(APIService.FX_FALLBACK.EUR);
        expect(APIService.fxEstimatedCurrencies()).toEqual(['EUR']);
        expect(APIService.fxEstimated.EUR).toBe('estimation');
    });

    it('panne apres un taux live : le dernier taux connu est conserve', async () => {
        let live = true;
        stubFetch(() => (live ? ok({ price: 1.2 }) : fail()));
        expect(await APIService.getExchangeRate('EUR')).toBe(1.2);

        // On force l'expiration du cache pour provoquer une nouvelle tentative.
        APIService.cachedFxRates.EUR.timestamp -= 3600001;
        live = false;
        const rate = await APIService.getExchangeRate('EUR');

        // 1,2 (dernier taux reel) plutot que la constante de repli.
        expect(rate).toBe(1.2);
        expect(rate).not.toBe(APIService.FX_FALLBACK.EUR);
        expect(APIService.fxEstimated.EUR).toBe('perime');
    });

    it('un taux perime n est pas re-horodate : la tentative suivante rappelle le reseau', async () => {
        let live = true;
        let calls = 0;
        stubFetch(() => {
            calls++;
            return live ? ok({ price: 1.2 }) : fail();
        });
        await APIService.getExchangeRate('EUR');
        APIService.cachedFxRates.EUR.timestamp -= 3600001;
        live = false;
        await APIService.getExchangeRate('EUR');
        const callsAfterFailure = calls;

        // Sans re-horodatage, l'appel suivant retente le reseau au lieu de
        // servir un taux de repli pendant une heure.
        await APIService.getExchangeRate('EUR');
        expect(calls).toBeGreaterThan(callsAfterFailure);
    });

    it('le retour du reseau efface le signalement', async () => {
        let live = false;
        stubFetch(() => (live ? ok({ price: 1.3 }) : fail()));
        await APIService.getExchangeRate('EUR');
        expect(APIService.fxEstimatedCurrencies()).toEqual(['EUR']);

        // Une panne sans taux connu n'ecrit rien en cache : l'appel suivant
        // repart directement sur le reseau.
        expect(APIService.cachedFxRates.EUR).toBeUndefined();
        live = true;
        expect(await APIService.getExchangeRate('EUR')).toBe(1.3);
        expect(APIService.fxEstimatedCurrencies()).toEqual([]);
    });
});

describe('APIService.getExchangeRates', () => {
    it('agrege les devises supportees, USD inclus', async () => {
        stubFetch(() => ok({ price: 1.1 }));
        const rates = await APIService.getExchangeRates();
        expect(rates.USD).toBe(1);
        for (const cur of Object.keys(APIService.FX_FALLBACK)) {
            expect(rates[cur]).toBe(1.1);
        }
    });
});

describe('APIService.generateRealisticDailyHistory', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 11);

    it('interpole entre deux ancres reelles', () => {
        const daily = APIService.generateRealisticDailyHistory('AAPL', start, end, 100, 120);
        const dates = Object.keys(daily).sort();
        expect(dates).toHaveLength(11);
        expect(daily[dates[0]]).toBe(100);
        expect(daily[dates[dates.length - 1]]).toBe(120);
    });

    it('une seule ancre : serie plate sur cette valeur', () => {
        const daily = APIService.generateRealisticDailyHistory('AAPL', start, end, 0, 120);
        const dates = Object.keys(daily).sort();
        expect(daily[dates[0]]).toBe(120);
        expect(daily[dates[dates.length - 1]]).toBe(120);
    });

    it('aucune ancre reelle : serie vide, aucun historique invente', () => {
        // Anciennement ancre sur CONFIG.MOCK_PRICES[symbol] ou 100 : la courbe
        // partait d'un cours arbitraire presente comme un fait de marche.
        expect(APIService.generateRealisticDailyHistory('AAPL', start, end, 0, 0)).toEqual({});
        expect(APIService.generateRealisticDailyHistory('INCONNU', start, end, 0, 0)).toEqual({});
    });
});

describe('APIService.searchSymbol', () => {
    it('renvoie les resultats du proxy', async () => {
        stubFetch(() => ok([{ displaySymbol: 'AAPL', description: 'Apple Inc' }]));
        const res = await APIService.searchSymbol('appl');
        expect(res[0].description).toBe('Apple Inc');
    });

    it('proxy en panne : repli sur la liste locale de tickers', async () => {
        stubFetch(() => fail());
        const res = await APIService.searchSymbol('aap');
        expect(res.map((r) => r.displaySymbol)).toContain('AAPL');
    });

    it('le repli local ne transporte aucun prix', async () => {
        stubFetch(() => fail());
        const res = await APIService.searchSymbol('a');
        expect(res.length).toBeGreaterThan(0);
        for (const entry of res) {
            expect(entry).not.toHaveProperty('price');
            expect(Object.values(entry).every((v) => typeof v !== 'number')).toBe(true);
        }
    });
});
