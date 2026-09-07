/**
 * Adaptateur Degiro : detection du format et traduction vers les colonnes
 * natives. Module pur — ni reseau, ni DOM, ni resolution de symbole (qui reste
 * dans PortfolioService).
 */
import { describe, it, expect } from 'vitest';
import { isDegiroCSV, parseDegiroCSV } from './import-degiro.js';

const HEADER =
    "Date,Heure,Produit,Code ISIN,Place boursière sectionnée,Lieu d'exécution,Quantité,Cours,," +
    'Montant devise locale,,Montant EUR,Taux de change,Frais conversion AutoFX,' +
    'Frais de courtage et/ou de parties,Montant négocié EUR,ID Ordre';

/** Ligne d'achat GigaCloud du relevé de référence. */
const BUY =
    '15-06-2026,18:35,GIGACLOUD TECHNOLOGY INC CLASS A,KYG386441037,NDQ,EDGX,10,"35,0000",USD,' +
    '"-350,00",USD,"-301,65","1,1603","-0,75","-2,00","-304,40",6e1cbf61';

/** Vente Power Solutions : quantite negative. */
const SELL =
    '15-06-2026,15:36,"POWER SOLUTIONS INTERNATIONAL, INC.",US73933G2021,NDQ,CDED,-15,"42,0000",USD,' +
    '"630,00",USD,"542,31","1,1617","-1,36","-2,00","538,96",54c2be6f';

const csv = (...lines) => [HEADER, ...lines].join('\n');

describe('isDegiroCSV', () => {
    it('reconnait un releve Degiro', () => {
        expect(isDegiroCSV(csv(BUY))).toBe(true);
    });

    it('le CSV natif de l application n est jamais confondu avec un releve', () => {
        expect(isDegiroCSV('date;type;symbol;qty;price;currency;fees;amount;portfolio\n')).toBe(
            false
        );
    });

    it('un CSV a virgules sans colonne ISIN n est pas un releve', () => {
        expect(isDegiroCSV('a,b,c\n1,2,3')).toBe(false);
    });

    it('texte vide', () => {
        expect(isDegiroCSV('')).toBe(false);
    });
});

describe('parseDegiroCSV', () => {
    it('quantite positive : achat, date et cours normalises', () => {
        const { rows } = parseDegiroCSV(csv(BUY), { portfolioName: 'CTO Degiro' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            date: '2026-06-15',
            type: 'BUY',
            qty: 10,
            price: 35,
            currency: 'USD',
            isin: 'KYG386441037',
            portfolio: 'CTO Degiro',
            expectedSuffix: '',
        });
    });

    it('quantite negative : vente, quantite ramenee en valeur absolue', () => {
        const { rows } = parseDegiroCSV(csv(SELL));
        expect(rows[0]).toMatchObject({ type: 'SELL', qty: 15, price: 42 });
    });

    it('les frais en euros sont ramenes dans la devise de cotation', () => {
        const { rows } = parseDegiroCSV(csv(BUY));
        // 0,75 (AutoFX) + 2,00 (courtage) = 2,75 EUR, au taux 1,1603 de la ligne.
        expect(rows[0].fees).toBeCloseTo(2.75 * 1.1603, 6);
    });

    it('une ligne deja libellee en euros garde ses frais tels quels', () => {
        const line =
            '02-05-2026,09:12,AIRBUS SE,NL0000235190,EPA,XPAR,4,"160,0000",EUR,' +
            '"-640,00",EUR,"-640,00","1,0000","0,00","-2,00","-642,00",abc';
        const { rows } = parseDegiroCSV(csv(line));
        expect(rows[0]).toMatchObject({ currency: 'EUR', fees: 2, expectedSuffix: '.PA' });
    });

    it('une place boursiere inconnue ne contraint aucun suffixe', () => {
        const { rows } = parseDegiroCSV(csv(BUY.replace(',NDQ,', ',ZZZ,')));
        expect(rows[0].expectedSuffix).toBeNull();
    });

    it('un cours a zero est ecarte et signale comme operation sur titre', () => {
        const line =
            '15-07-2026,10:14,CATALYST PHARMACEUTICALS INC,US14888U1016,NDQ,,-13,"0,0000",USD,' +
            '"0,00",USD,"0,00","1,1442","0,00",,"0,00",';
        const { rows, warnings } = parseDegiroCSV(csv(line));
        expect(rows).toHaveLength(0);
        expect(warnings[0]).toContain('CATALYST');
        expect(warnings[0]).toContain('cours à 0');
    });

    it('une date illisible est signalee avec son numero de ligne', () => {
        const { rows, warnings } = parseDegiroCSV(csv(BUY.replace('15-06-2026', '2026-06-15')));
        expect(rows).toHaveLength(0);
        expect(warnings[0]).toContain('Ligne 2');
    });

    it('les lignes sont rendues dans l ordre chronologique', () => {
        const older = BUY.replace('15-06-2026', '20-04-2025');
        const { rows } = parseDegiroCSV(csv(BUY, older));
        expect(rows.map((r) => r.date)).toEqual(['2025-04-20', '2026-06-15']);
        // Le numero de ligne reste celui du fichier d'origine, pas du tri.
        expect(rows[0].line).toBe(3);
    });

    it('un fichier sans ligne de donnees est refuse', () => {
        expect(parseDegiroCSV(HEADER)).toEqual({ rows: [], warnings: ['Relevé Degiro vide'] });
    });

    it('des colonnes attendues absentes sont refusees sans planter', () => {
        const res = parseDegiroCSV('Date,Produit,Code ISIN\n15-06-2026,X,US0000000000');
        expect(res.rows).toHaveLength(0);
        expect(res.warnings[0]).toContain('introuvables');
    });
});
