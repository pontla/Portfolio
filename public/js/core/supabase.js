/**
 * Point d'injection du client Supabase. Le client est cree dans app.js a partir
 * du global charge par CDN ; le moteur ne connait que cette fonction, ce qui le
 * rend importable sous Node (les tests injectent un double).
 */

/** @type {any} */
let client = null;

/** @param {any} c */
export function setSupabaseClient(c) {
    client = c;
}

/** @returns {any} */
export function db() {
    if (!client)
        throw new Error(
            'Client Supabase non initialise : appeler setSupabaseClient() au demarrage.'
        );
    return client;
}
