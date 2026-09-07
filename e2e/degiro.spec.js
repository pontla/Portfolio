/**
 * Import d'un releve de transactions Degiro : le fichier du courtier est
 * reconnu tel quel, le sens de l'operation se lit dans le signe de la quantite
 * et le titre n'est identifie que par son ISIN.
 */
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.js';

const HEADER =
    "Date,Heure,Produit,Code ISIN,Place boursière sectionnée,Lieu d'exécution,Quantité,Cours,," +
    'Montant devise locale,,Montant EUR,Taux de change,Frais conversion AutoFX,' +
    'Frais de courtage et/ou de parties,Montant négocié EUR,ID Ordre';

const LULU_BUY =
    '08-10-2024,16:12,LULULEMON ATHLETICA INC.,US5500211090,NDQ,SOHO,3,"176,3300",USD,' +
    '"-528,99",USD,"-454,80","1,1632","-1,14","-2,00","-457,94",9117115c';

const HUT_BUY =
    '04-04-2024,16:05,HUT 8 CORP,US44812J1043,NDQ,ARCX,25,"11,0000",USD,' +
    '"-275,00",USD,"-250,23","1,0990","-0,63","-2,00","-252,85",ec7834e6';

const HUT_SELL =
    '08-10-2024,15:30,HUT 8 CORP,US44812J1043,NDQ,XNAS,-10,"42,2700",USD,' +
    '"422,70",USD,"363,43","1,1631","-0,91","-2,00","360,52",db99561b';

/** ISIN israelien, mais negocie sur le Nasdaq : la cotation de Tel-Aviv est ecartee. */
const PERION_BUY =
    '20-02-2024,15:30,PERION NETWORK LTD,IL0010958192,NDQ,XNAS,16,"24,4900",USD,' +
    '"-391,84",USD,"-361,78","1,0831","-0,90","-2,00","-364,68",ba6883b0';

/** Radiation : le releve ne chiffre pas l'operation. */
const ZERO_PRICE =
    '06-02-2024,16:39,STRIVE INC CLASS A,US8629451027,NDQ,,-8,"0,0000",USD,' +
    '"0,00",USD,"0,00","1,1915","0,00",,"0,00",';

/** ISIN absent du referentiel de la source (titre radie). */
const UNKNOWN =
    '20-05-2024,15:30,SEMLER SCIENTIFIC INC,US81684M1045,NDQ,XNAS,4,"22,9700",USD,' +
    '"-91,88",USD,"-84,58","1,0863","-0,21","-2,00","-86,79",7711515c';

/**
 * Depose un CSV sur l'import et rend le texte de l'alerte finale.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} lines
 * @param {string|null} portfolioName nom saisi dans l'invite, ou null pour annuler
 */
async function importDegiro(page, lines, portfolioName = 'CTO Degiro') {
    /** @type {string[]} */
    const dialogs = [];
    page.on('dialog', async (d) => {
        dialogs.push(d.message());
        if (d.type() === 'prompt') {
            if (portfolioName === null) await d.dismiss();
            else await d.accept(portfolioName);
        } else {
            await d.accept();
        }
    });

    await page.locator('#settingsBtn:visible').first().click();
    await expect(page.locator('#settingsModal')).toHaveClass(/open/);
    await page.locator('#importCsvInput').setInputFiles({
        name: 'Transactions.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from([HEADER, ...lines].join('\n'), 'utf8'),
    });
    return dialogs;
}

/** Bascule sur un portefeuille par son nom. */
async function switchTo(page, name) {
    await page.locator('#portfolioSwitcherBtn').click();
    await page.locator('#portfolioDropdownList').getByText(name, { exact: true }).click();
    await expect(page.locator('#appTitle')).toHaveText(name);
}

test.beforeEach(async ({ page }) => {
    await bootApp(page);
});

test('un releve Degiro est reconnu et demande son portefeuille de destination', async ({
    page,
}) => {
    const dialogs = await importDegiro(page, [LULU_BUY]);
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[0]).toContain('Relevé Degiro détecté');
    expect(dialogs[1]).toContain('1 transaction(s) importée(s)');
});

test('les lignes importees portent le symbole resolu depuis l ISIN', async ({ page }) => {
    await importDegiro(page, [HUT_BUY, HUT_SELL]);
    await switchTo(page, 'CTO Degiro');
    await page.locator('button[data-tab="transactions"]:visible').first().click();
    await page.locator('#view-transactions').waitFor({ state: 'visible' });

    const rows = page.locator('#transactionsTableBody');
    await expect(rows).toContainText('HUT');
    // Le signe de la quantite donne le sens : 25 achetees puis 10 vendues.
    await expect(rows.locator('.badge-buy')).toHaveCount(1);
    await expect(rows.locator('.badge-sell')).toHaveCount(1);
    // Un releve de courtier n'apporte aucun depot : l'achat est finance en direct.
    await expect(rows).toContainText('Achat direct');
});

test('une place americaine ecarte la cotation etrangere du meme ISIN', async ({ page }) => {
    await importDegiro(page, [PERION_BUY]);
    await switchTo(page, 'CTO Degiro');
    await page.locator('button[data-tab="transactions"]:visible').first().click();
    await page.locator('#view-transactions').waitFor({ state: 'visible' });

    const rows = page.locator('#transactionsTableBody');
    await expect(rows).toContainText('PERI');
    await expect(rows).not.toContainText('PERI.TA');
});

test('les lignes non importables sont detaillees plutot que silencieuses', async ({ page }) => {
    const dialogs = await importDegiro(page, [LULU_BUY, ZERO_PRICE, UNKNOWN]);
    await expect.poll(() => dialogs.length).toBe(2);
    const report = dialogs[1];
    expect(report).toContain('1 transaction(s) importée(s)');
    expect(report).toContain('2 ligne(s) non importée(s)');
    expect(report).toContain('cours à 0');
    expect(report).toContain('aucun symbole coté trouvé');
});

test('annuler l invite n importe rien', async ({ page }) => {
    const dialogs = await importDegiro(page, [LULU_BUY], null);
    await expect.poll(() => dialogs.length).toBe(1);
    // L'invite annulee laisse l'utilisateur dans les reglages, sans rien ecrire.
    await page.locator('#closeSettingsBtn').click();
    await expect(page.locator('#settingsModal')).not.toHaveClass(/open/);
    await page.locator('#portfolioSwitcherBtn').click();
    await expect(page.locator('#portfolioDropdownList')).not.toContainText('CTO Degiro');
});
