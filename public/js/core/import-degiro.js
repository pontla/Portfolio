/**
 * Adaptateur d'import des releves de transactions Degiro.
 *
 * Le fichier natif de l'application est un CSV `;` deja normalise
 * (date;type;symbol;...). Le releve Degiro, lui, est un CSV `,` au format FR
 * (virgule decimale), sans colonne « type » ni « symbol » : le sens de
 * l'operation se lit dans le signe de la quantite, et le titre n'est identifie
 * que par son ISIN et son libelle. Ce module se contente de traduire l'un vers
 * l'autre — la resolution ISIN -> symbole, qui demande le reseau, reste dans
 * PortfolioService.
 *
 * Aucune dependance au DOM ni au reseau.
 */

/** Colonnes du releve, par libelles acceptes (accents et casse ignores). */
const COLUMNS = {
    date: ['date'],
    product: ['produit', 'product'],
    isin: ['code isin', 'isin'],
    venue: ['place boursiere sectionnee', 'place boursiere', 'bourse', 'exchange', 'venue'],
    qty: ['quantite', 'quantity'],
    price: ['cours', 'price'],
    localAmount: ['montant devise locale', 'valeur locale', 'local value'],
    fxRate: ['taux de change', 'exchange rate'],
    autoFxFee: ['frais conversion autofx', 'frais autofx'],
    brokerFee: [
        'frais de courtage et/ou de parties',
        'frais de courtage',
        'frais de transaction',
        'frais',
    ],
};

/**
 * Place boursiere Degiro -> suffixe Yahoo attendu. Sert a departager les
 * cotations multiples d'un meme ISIN : PERION se negocie sur le Nasdaq en USD
 * (PERI) mais son ISIN israelien renvoie d'abord la ligne de Tel-Aviv
 * (PERI.TA), cotee en ILS. Sans cet ancrage, le cours du releve serait
 * rattache a la mauvaise devise.
 * La chaine vide signifie « symbole sans suffixe » (marches americains).
 */
const VENUE_SUFFIX = {
    NDQ: '',
    NSY: '',
    ASE: '',
    OTC: '',
    EPA: '.PA',
    EAM: '.AS',
    EBR: '.BR',
    ELI: '.LS',
    XET: '.DE',
    FSE: '.F',
    FRA: '.F',
    TDG: '.DE',
    MIL: '.MI',
    MAD: '.MC',
    LSE: '.L',
    SWX: '.SW',
    EBS: '.SW',
    VIE: '.VI',
    OSL: '.OL',
    HEL: '.HE',
    CPH: '.CO',
    OMX: '.ST',
    WSE: '.WA',
    ATH: '.AT',
    DUB: '.IR',
    TOR: '.TO',
    TSE: '.TO',
};

const CURRENCY_RE = /^[A-Z]{3}$/;

/** Minuscules sans accents, pour comparer des en-tetes saisis a la main. */
function fold(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

/** Decoupe une ligne CSV en respectant les guillemets. */
function splitLine(line, delimiter) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === delimiter) {
            cells.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}

/**
 * Nombre au format FR (`1.234,56`) ou US (`1234.56`). Renvoie `null` — et non
 * zero — quand la cellule est vide : un cours absent et un cours nul n'ont pas
 * le meme sens ici.
 * @returns {number|null}
 */
function parseNumber(val) {
    let s = String(val == null ? '' : val)
        .replace(/[\s\u00a0\u202f]/g, '')
        .trim();
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

/** `15-07-2026` (ou `15/07/2026`) -> `2026-07-15`. */
function parseDegiroDate(val) {
    const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(String(val || '').trim());
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Index de la premiere colonne dont l'en-tete figure dans `labels`. */
function findColumn(headers, labels) {
    for (const label of labels) {
        const idx = headers.indexOf(label);
        if (idx !== -1) return idx;
    }
    return -1;
}

/**
 * Vrai si le texte ressemble a un releve Degiro. Le CSV natif de
 * l'application commence par `date;type;symbol` : il est reconnu en premier
 * pour qu'un en-tete ambigu ne bascule jamais vers l'adaptateur.
 * @param {string} text
 */
export function isDegiroCSV(text) {
    const first = String(text || '').split(/\r\n|\n|\r/)[0] || '';
    const folded = fold(first);
    if (folded.startsWith('date;type')) return false;
    if (!folded.includes(',')) return false;
    const headers = splitLine(first, ',').map(fold);
    return (
        findColumn(headers, COLUMNS.isin) !== -1 &&
        findColumn(headers, COLUMNS.product) !== -1 &&
        findColumn(headers, COLUMNS.qty) !== -1
    );
}

/**
 * Traduit un releve Degiro en lignes au format d'import natif.
 *
 * Les frais (courtage et conversion AutoFX) sont libelles en euros dans le
 * releve, alors que le cours est dans la devise de cotation. Ils sont donc
 * reconvertis avec le taux de change de la ligne elle-meme — celui du jour de
 * l'operation, plus juste qu'un taux spot applique apres coup.
 *
 * @param {string} text contenu du CSV
 * @param {{portfolioName?: string}} [opts]
 * @returns {{rows: any[], warnings: string[]}} `rows` porte `isin` et `product`
 *   en plus des colonnes natives ; le symbole reste a resoudre.
 */
export function parseDegiroCSV(text, { portfolioName = '' } = {}) {
    const lines = String(text || '')
        .split(/\r\n|\n|\r/)
        .filter((l) => l.trim().length > 0);
    /** @type {string[]} */
    const warnings = [];
    if (lines.length < 2) return { rows: [], warnings: ['Relevé Degiro vide'] };

    const headers = splitLine(lines[0], ',').map(fold);
    const col = {};
    for (const [key, labels] of Object.entries(COLUMNS)) col[key] = findColumn(headers, labels);

    if (col.date === -1 || col.isin === -1 || col.qty === -1 || col.price === -1)
        return {
            rows: [],
            warnings: ['Colonnes Degiro attendues introuvables (Date, ISIN, Quantité, Cours)'],
        };

    // Degiro fait suivre chaque montant de sa devise, dans une colonne sans
    // en-tete. Celle qui suit le cours donne la devise de cotation.
    const currencyIdx = [col.price + 1, col.localAmount + 1];

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitLine(lines[i], ',');
        const label = String(cells[col.product] || cells[col.isin] || '').trim();
        const line = i + 1;

        const date = parseDegiroDate(cells[col.date]);
        if (!date) {
            warnings.push(`Ligne ${line} : date illisible « ${cells[col.date] || ''} »`);
            continue;
        }

        const qty = parseNumber(cells[col.qty]);
        if (!qty) {
            warnings.push(`Ligne ${line} : ${label} — quantité nulle ou absente, ligne ignorée`);
            continue;
        }

        const price = parseNumber(cells[col.price]);
        if (!price) {
            // Cours a zero : operation sur titre (radiation, fusion, changement
            // de code) que le releve ne chiffre pas. L'importer en vente a zero
            // inventerait une moins-value totale ; la ligne est ecartee et
            // signalee pour saisie manuelle.
            warnings.push(
                `Ligne ${line} : ${label} — cours à 0 (opération sur titre : radiation, fusion, changement de code). À saisir manuellement.`
            );
            continue;
        }

        let currency = '';
        for (const idx of currencyIdx) {
            const c = String(cells[idx] || '')
                .trim()
                .toUpperCase();
            if (CURRENCY_RE.test(c)) {
                currency = c;
                break;
            }
        }
        if (!currency) currency = 'EUR';

        // Frais servis en euros : ramenes dans la devise de cotation au taux du
        // releve. Taux absent ou incoherent -> frais laisses tels quels plutot
        // que multiplies par une valeur fausse.
        const fxRate = parseNumber(cells[col.fxRate]);
        const feesEUR =
            Math.abs(parseNumber(cells[col.autoFxFee]) || 0) +
            Math.abs(parseNumber(cells[col.brokerFee]) || 0);
        const fees = currency === 'EUR' || !(fxRate > 0) ? feesEUR : feesEUR * fxRate;

        const venue = String(cells[col.venue] || '')
            .trim()
            .toUpperCase();

        rows.push({
            // Numero dans le fichier d'origine : le tri chronologique ci-dessous
            // le decorrele de la position finale, et c'est lui que l'utilisateur
            // retrouvera dans son releve.
            line,
            date,
            type: qty > 0 ? 'BUY' : 'SELL',
            symbol: '',
            qty: Math.abs(qty),
            price,
            currency,
            fees,
            amount: '',
            cashsource: '',
            portfolio: portfolioName,
            isin: String(cells[col.isin] || '')
                .trim()
                .toUpperCase(),
            product: label,
            // Suffixe Yahoo attendu, ou `null` quand la place est inconnue : la
            // resolution ne filtre alors sur rien plutot que sur du vide.
            expectedSuffix: Object.prototype.hasOwnProperty.call(VENUE_SUFFIX, venue)
                ? VENUE_SUFFIX[venue]
                : null,
        });
    }

    // Degiro exporte du plus recent au plus ancien ; le moteur deduit le
    // financement de chaque achat du cash disponible a sa date, ce qui suppose
    // de derouler l'historique dans l'ordre.
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { rows, warnings };
}

export const _internals = { parseNumber, parseDegiroDate, fold, VENUE_SUFFIX };
