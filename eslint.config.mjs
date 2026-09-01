/**
 * Configuration ESLint (flat config, ESLint 10).
 *
 * Le depot n'a pas d'etape de build : chaque zone tourne dans un environnement
 * different (navigateur en module, service worker, Cloudflare Worker, Node pour
 * les tests). On declare donc les globales par zone plutot qu'un `env` global,
 * pour que `no-undef` attrape reellement les fautes de frappe.
 *
 * `eslint-config-prettier` est charge en dernier : le formatage appartient a
 * Prettier, ESLint ne s'occupe que de la correction.
 */

import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';
import playwright from 'eslint-plugin-playwright';

/** Regles communes a tout le depot. */
const commonRules = {
    // Les erreurs reelles, non couvertes par le typecheck.
    'no-var': 'error',
    'prefer-const': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-throw-literal': 'error',
    'no-unneeded-ternary': 'error',
    'no-useless-concat': 'error',
    'no-lonely-if': 'warn',
    'object-shorthand': ['error', 'properties'],

    // Les espaces insecables (U+00A0) des formats monetaires francais sont
    // voulus : ils vivent dans des litteraux de gabarit (cf. core/utils.js).
    'no-irregular-whitespace': ['error', { skipTemplates: true }],

    // Un catch vide est un choix delibere dans ce depot (stockage indisponible,
    // API hors navigateur) : on l'autorise, a condition qu'il soit commente.
    'no-empty': ['error', { allowEmptyCatch: true }],

    // Les parametres non utilises sont frequents dans les callbacks : on ne
    // signale que ceux qui precedent un parametre utilise, et on tolere le
    // prefixe `_` pour les ignorer explicitement.
    'no-unused-vars': [
        'error',
        {
            args: 'after-used',
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'all',
            caughtErrorsIgnorePattern: '^(_|e$)',
        },
    ],
};

export default [
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            'test-results/**',
            'playwright-report/**',
            '.wrangler/**',
            'public/js/**/*.d.ts',
        ],
    },

    js.configs.recommended,

    // --- application, dans le navigateur (modules ES natifs) ----------------
    {
        files: ['public/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                // Charges par balise <script> CDN dans index.html.
                Chart: 'readonly',
            },
        },
        rules: {
            ...commonRules,
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },

    // Le moteur financier ne parle pas a l'utilisateur : c'est l'App qui
    // l'informe (cf. le refus silencieux dans core/portfolio.js). La regle
    // rend cette frontiere executable — et reste desactivee dans ./ui, ou
    // confirm()/alert() sont le mecanisme d'interaction assume.
    {
        files: ['public/js/core/**/*.js'],
        ignores: ['**/*.test.js'],
        rules: { 'no-alert': 'error' },
    },

    // --- service worker ----------------------------------------------------
    {
        files: ['public/sw.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: globals.serviceworker,
        },
        rules: commonRules,
    },

    // --- Cloudflare Worker (proxy BFF) -------------------------------------
    {
        files: ['worker/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.serviceworker,
                ...globals.node,
            },
        },
        rules: commonRules,
    },

    // --- tests unitaires (vitest, Node) ------------------------------------
    {
        files: ['**/*.test.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            ...commonRules,
            'no-console': 'off',
        },
    },

    // --- tests end-to-end (Playwright) -------------------------------------
    {
        ...playwright.configs['flat/recommended'],
        files: ['e2e/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            ...playwright.configs['flat/recommended'].rules,
            ...commonRules,
            'no-console': 'off',
            // Un ternaire pour tester les deux sens d'une bascule n'est pas une
            // branche de test : la regle est trop large ici.
            'playwright/no-conditional-in-test': 'off',
        },
    },

    // --- configuration et outillage (Node) ---------------------------------
    {
        files: ['*.config.js', '*.config.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node,
        },
        rules: commonRules,
    },

    prettier,
];
