/**
 * Authentification (Supabase Auth) et garde-fous sur l'horodatage des jetons.
 */

import { db } from './supabase.js';
import { currentPageUrl } from './platform.js';

// --- AUTH SERVICE (Supabase Auth) ---
export const AuthService = {
    async signUp(email, password) {
        const { data, error } = await db().auth.signUp({ email, password });
        if (error) throw error;
        return data;
    },

    async signIn(email, password) {
        const { data, error } = await db().auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async signOut() {
        await db().auth.signOut();
    },

    async getSession() {
        const { data } = await db().auth.getSession();
        return data.session;
    },

    async refreshSession() {
        const { data, error } = await db().auth.refreshSession();
        if (error) throw error;
        return data.session;
    },

    async resetPasswordForEmail(email) {
        const { error } = await db().auth.resetPasswordForEmail(email, {
            redirectTo: currentPageUrl()
        });
        if (error) throw error;
    },

    async updatePassword(password) {
        const { error } = await db().auth.updateUser({ password });
        if (error) throw error;
    },

    onAuthStateChange(callback) {
        db().auth.onAuthStateChange((_event, session) => callback(session));
    }
};

// Supabase/PostgREST rejette un JWT dont l'iat est dans le futur : arrive quand
// l'horloge de l'appareil etait en avance au moment de la connexion et que le
// jeton (encore non expire) reste en cache dans localStorage.
export function jwtIssuedAt(token) {
    try {
        const seg = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(seg));
        return typeof payload.iat === 'number' ? payload.iat : null;
    } catch (e) {
        return null;
    }
}

export function isJwtTimingError(err) {
    const msg = ((err && (err.message || err.error_description || err.error)) || '') + '';
    return /issued at future|before issued|not yet valid|used before|clock/i.test(msg);
}
