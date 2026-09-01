/**
 * Acces au stockage local et au bus d'evenements de la page, tolerants a leur
 * absence : le moteur doit s'importer tel quel sous Node (tests unitaires) et ne
 * doit pas casser quand le navigateur refuse le stockage (navigation privee,
 * donnees de site bloquees) — auparavant plusieurs appels a localStorage
 * n'etaient pas proteges et faisaient echouer le demarrage.
 */

export const storage = {
    /** @param {string} key @returns {string|null} */
    get(key) {
        try { return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null; }
        catch (e) { return null; }
    },
    /** @param {string} key @param {string} value */
    set(key, value) {
        try { if (globalThis.localStorage) globalThis.localStorage.setItem(key, value); }
        catch (e) { /* stockage indisponible */ }
    },
    /** @param {string} key */
    remove(key) {
        try { if (globalThis.localStorage) globalThis.localStorage.removeItem(key); }
        catch (e) { /* stockage indisponible */ }
    },
};

/**
 * Diffuse un evenement applicatif sur la page. Sans `dispatchEvent` (Node), la
 * fonction ne fait rien : le moteur reste utilisable hors navigateur.
 * @param {string} name
 */
export function emit(name) {
    try {
        if (typeof globalThis.dispatchEvent === 'function') {
            globalThis.dispatchEvent(new CustomEvent(name));
        }
    } catch (e) { /* hors navigateur */ }
}

/**
 * Origine + chemin de la page courante (lien de retour des emails Supabase).
 * Chaine vide hors navigateur.
 * @returns {string}
 */
export function currentPageUrl() {
    try {
        const l = globalThis.location;
        return l ? l.origin + l.pathname : '';
    } catch (e) { return ''; }
}
