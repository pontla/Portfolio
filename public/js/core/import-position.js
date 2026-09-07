/**
 * Adaptateur d'import d'un releve de position (assurance vie, PER...) : un
 * tableau "photo" du portefeuille a un instant donne (support, ISIN, parts
 * detenues, PMPA, montant, date de VL), sans historique de transactions.
 *
 * Chaque ligne du releve devient une ligne d'achat (`BUY`, prix = PMPA) qui
 * fixe la quantite et le prix de revient. La resolution ISIN -> symbole, qui
 * demande le reseau, reste dans PortfolioService (cf. _resolveInsurancePositions) :
 * ce module reste pur, sans dependance au DOM ni au reseau, hormis Utils.
 */

import { Utils } from './utils.js';

/** Colonnes du releve, par libelles acceptes (accents et casse ignores). */
const COLUMNS = {
    product: ['nom du support', 'support', 'nom', 'produit', 'libelle'],
    isin: ['isin', 'code isin'],
    qty: ['nombre de parts', 'nb de parts', 'parts', 'quantite'],
    pmpa: ['pmpa', 'prix de revient', 'prix moyen pondere', 'prix moyen'],
    amount: ['montant', 'valorisation', 'valeur'],
    valuationDate: ['date vl', 'date de vl', 'date valeur liquidative', 'date'],
};

/** Delimiteurs essayes, dans cet ordre a egalite de score (collage tableur -> tabulation). */
const DELIMITERS = ['\t', ';', ','];

/** Index de la premiere colonne dont l'en-tete figure dans `labels`. */
function findColumn(headers, labels) {
    for (const label of labels) {
        const idx = headers.indexOf(label);
        if (idx !== -1) return idx;
    }
    return -1;
}

/**
 * Delimiteur le plus plausible pour la ligne d'en-tete : celui qui fait
 * reconnaitre le plus de colonnes attendues.
 */
function pickDelimiter(headerLine) {
    let best = { delimiter: DELIMITERS[0], score: -1, headers: [] };
    for (const d of DELIMITERS) {
        const headers = Utils.splitDelimited(headerLine, d).map(Utils.fold);
        if (headers.length < 2) continue;
        const score = Object.values(COLUMNS).filter(
            (labels) => findColumn(headers, labels) !== -1
        ).length;
        if (score > best.score) best = { delimiter: d, score, headers };
    }
    return best;
}

/**
 * Vrai si le texte ressemble a un releve de position : une colonne ISIN, une
 * quantite de parts et un PMPA — cette derniere absente de tout autre format
 * reconnu (natif, Degiro) et donc suffisante pour ne jamais s'y confondre.
 * @param {string} text
 */
export function isPositionCSV(text) {
    const first = String(text || '').split(/\r\n|\n|\r/)[0] || '';
    if (!first.trim()) return false;
    const { headers } = pickDelimiter(first);
    return (
        findColumn(headers, COLUMNS.isin) !== -1 &&
        findColumn(headers, COLUMNS.qty) !== -1 &&
        findColumn(headers, COLUMNS.pmpa) !== -1
    );
}

/**
 * Traduit un releve de position en lignes intermediaires, une par support.
 * La resolution du symbole et la decision d'ajouter une valorisation manuelle
 * (support non cote par la source) restent a PortfolioService : ce module ne
 * fait qu'extraire des nombres propres.
 *
 * @param {string} text contenu du releve (CSV, TSV ou collage tableur)
 * @returns {{rows: any[], warnings: string[], openDate: string|null}} `openDate`
 *   est la plus ancienne date de VL du releve : faute d'historique reel avant
 *   cette date, c'est la premiere preuve verifiable de detention, et donc la
 *   seule date d'achat honnete a defaut d'une date d'ouverture connue.
 */
export function parsePositionCSV(text) {
    const lines = String(text || '')
        .split(/\r\n|\n|\r/)
        .filter((l) => l.trim().length > 0);
    /** @type {string[]} */
    const warnings = [];
    if (lines.length < 2)
        return { rows: [], warnings: ['Relevé de position vide'], openDate: null };

    const { delimiter, headers } = pickDelimiter(lines[0]);
    const col = {};
    for (const [key, labels] of Object.entries(COLUMNS)) col[key] = findColumn(headers, labels);

    if (col.isin === -1 || col.qty === -1 || col.pmpa === -1)
        return {
            rows: [],
            warnings: ['Colonnes attendues introuvables (ISIN, Nombre de parts, PMPA)'],
            openDate: null,
        };

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = Utils.splitDelimited(lines[i], delimiter);
        const line = i + 1;

        const rawIsin = String(cells[col.isin] || '').trim();
        const isin = Utils.normalizeIsin(rawIsin);
        const product = String(cells[col.product] || '').trim();
        // Sans ISIN valide : ligne de sous-total ou d'en-tete de section (ex.
        // « GESTION LIBRE » n'a ni ISIN ni parts) — ecartee sans avertissement,
        // c'est le cas courant d'un export de tableau.
        if (!isin) continue;

        const qty = Utils.parseLocaleNumber(cells[col.qty]);
        if (!(qty > 0)) {
            warnings.push(`Ligne ${line} : ${product || isin} — nombre de parts nul ou absent`);
            continue;
        }

        const pmpa = Utils.parseLocaleNumber(cells[col.pmpa]);
        if (!(pmpa > 0)) {
            warnings.push(`Ligne ${line} : ${product || isin} — PMPA nul ou absent`);
            continue;
        }

        const amount = col.amount !== -1 ? Utils.parseLocaleNumber(cells[col.amount]) : qty * pmpa;

        const rawDate = col.valuationDate !== -1 ? cells[col.valuationDate] : '';
        const valuationDate = rawDate ? Utils.getDateString(Utils.parseDate(rawDate)) : null;

        rows.push({
            line,
            isin,
            product: product || isin,
            qty,
            pmpa,
            amount: amount > 0 ? amount : qty * pmpa,
            valuationDate,
        });
    }

    const openDate =
        rows.reduce((min, r) => {
            if (!r.valuationDate) return min;
            return !min || r.valuationDate < min ? r.valuationDate : min;
        }, null) || null;

    return { rows, warnings, openDate };
}
