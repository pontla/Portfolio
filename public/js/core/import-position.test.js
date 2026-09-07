/**
 * Adaptateur releve de position (assurance vie, PER...) : detection du format
 * et extraction des lignes. Module pur — ni reseau, ni DOM, ni resolution de
 * symbole (qui reste dans PortfolioService).
 */
import { describe, it, expect } from 'vitest';
import { isPositionCSV, parsePositionCSV } from './import-position.js';

const HEADER =
    'Nom du support\tISIN\tNombre de parts\tValeur liquidative\tMontant\tPoids\tPMPA\t' +
    '+/- value €\t+/- value %\tDate VL';

/** Section « GESTION LIBRE » : sous-total sans ISIN ni parts. */
const SUBTOTAL = 'GESTION LIBRE\t\t\t\t105 521,51 €\t100,00 %\t\t\t\t';

const PICTET =
    'Pictet TR-Atlas P EUR Acc\tLU1433232854\t231,6036\t142,24 €\t32 943,30 €\t31,22 %\t120,12 €\t' +
    '5 123,07 €\t+ 18,41 %\t03/09/2026';

const EDR =
    'EdR Fd Big Data A EUR\tLU1244893696\t32,7292\t405,21 €\t13 262,18 €\t12,57 %\t191,70 €\t' +
    '6 988,09 €\t+ 111,38 %\t03/09/2026';

const csv = (...lines) => [HEADER, ...lines].join('\n');

describe('isPositionCSV', () => {
    it('reconnait un releve de position (tabulations)', () => {
        expect(isPositionCSV(csv(PICTET))).toBe(true);
    });

    it('reconnait le meme releve exporte en point-virgule', () => {
        const semi = csv(PICTET).replace(/\t/g, ';');
        expect(isPositionCSV(semi)).toBe(true);
    });

    it('le CSV natif n est jamais confondu avec un releve de position', () => {
        expect(isPositionCSV('date;type;symbol;qty;price;currency;fees;amount;portfolio\n')).toBe(
            false
        );
    });

    it('un releve Degiro (sans PMPA) n est pas confondu', () => {
        const degiroHeader =
            "Date,Heure,Produit,Code ISIN,Place boursière sectionnée,Lieu d'exécution,Quantité,Cours";
        expect(isPositionCSV(degiroHeader + '\n15-06-2026,,,KYG386441037,NDQ,,10,35')).toBe(false);
    });

    it('texte vide', () => {
        expect(isPositionCSV('')).toBe(false);
    });
});

describe('parsePositionCSV', () => {
    it('extrait une ligne avec ses champs normalises', () => {
        const { rows } = parsePositionCSV(csv(PICTET));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            isin: 'LU1433232854',
            product: 'Pictet TR-Atlas P EUR Acc',
            qty: 231.6036,
            pmpa: 120.12,
            amount: 32943.3,
            valuationDate: '2026-09-03',
        });
    });

    it('calcule openDate comme la plus ancienne date de VL du releve', () => {
        const older = EDR.replace('03/09/2026', '02/09/2026');
        const { rows, openDate } = parsePositionCSV(csv(PICTET, older));
        expect(rows).toHaveLength(2);
        expect(openDate).toBe('2026-09-02');
    });

    it('une ligne de sous-total sans ISIN est ecartee sans avertissement', () => {
        const { rows, warnings } = parsePositionCSV(csv(SUBTOTAL, PICTET));
        expect(rows).toHaveLength(1);
        expect(warnings).toHaveLength(0);
    });

    it('un nombre de parts nul ou absent est signale et la ligne ecartee', () => {
        const line = PICTET.replace('231,6036', '');
        const { rows, warnings } = parsePositionCSV(csv(line));
        expect(rows).toHaveLength(0);
        expect(warnings[0]).toContain('parts');
    });

    it('un PMPA nul ou absent est signale et la ligne ecartee', () => {
        const line = PICTET.replace('120,12 €', '');
        const { rows, warnings } = parsePositionCSV(csv(line));
        expect(rows).toHaveLength(0);
        expect(warnings[0]).toContain('PMPA');
    });

    it('separateur point-virgule reconnu au meme titre que la tabulation', () => {
        const semi = csv(PICTET).replace(/\t/g, ';');
        const { rows } = parsePositionCSV(semi);
        expect(rows).toHaveLength(1);
        expect(rows[0].isin).toBe('LU1433232854');
    });

    it('un fichier sans ligne de donnees est refuse', () => {
        expect(parsePositionCSV(HEADER)).toEqual({
            rows: [],
            warnings: ['Relevé de position vide'],
            openDate: null,
        });
    });

    it('des colonnes attendues absentes sont refusees sans planter', () => {
        const res = parsePositionCSV('Nom\tISIN\nPictet\tLU1433232854');
        expect(res.rows).toHaveLength(0);
        expect(res.warnings[0]).toContain('introuvables');
    });

    it('openDate est null quand aucune ligne ne porte de date de VL', () => {
        const noDate = csv(PICTET).replace(/\t03\/09\/2026$/, '\t');
        const { rows, openDate } = parsePositionCSV(noDate);
        expect(rows).toHaveLength(1);
        expect(openDate).toBeNull();
    });
});
