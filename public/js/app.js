/**
 * STOCK PORTFOLIO APP — CONTROLEUR UI
 *
 * Ce fichier ne fait plus qu'assembler : l'etat partage de l'UI, la fusion des
 * fragments par ecran (./ui/*.js) et l'amorcage.
 *   - le moteur financier vit dans ./core/*.js, sans dependance au DOM ;
 *   - chaque ecran a son fragment dans ./ui/, fusionne dans le meme objet App
 *     (donc le meme `this`).
 *
 * Charge en module natif (`<script type="module">`) : aucun bundler.
 */

import { CONFIG } from './core/config.js';
import { setSupabaseClient } from './core/supabase.js';
import { Utils } from './core/utils.js';
import { APIService } from './core/api.js';
import { PortfolioService } from './core/portfolio.js';

import { shell } from './ui/shell.js';
import { events } from './ui/events.js';
import { overview } from './ui/overview.js';
import { transactions } from './ui/transactions.js';
import { holdings } from './ui/holdings.js';
import { insights } from './ui/insights.js';
import { charts } from './ui/charts.js';
import { research } from './ui/research.js';
import { researchFundamentals } from './ui/research-fundamentals.js';
import { researchMarket } from './ui/research-market.js';

// Le client Supabase est construit ici : le global provient de la balise
// <script> CDN de index.html, que le moteur n'a pas a connaitre.
setSupabaseClient(window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY));

// Seul etat partage cote UI ; tout le reste vit dans le moteur.
const App = Object.assign(
    {
        service: new PortfolioService(),
        chart: null,
        chartState: {
            mode: 'VALUE',
            range: 'ALL',
            benchmarks: [],
            currency: 'EUR',
            perfFilter: 'all',
            profitRange: 'ALL',
            researchRange: '1Y',
        },
        researchChart: null,
        researchSymbol: null,
    },
    shell,
    events,
    overview,
    transactions,
    holdings,
    insights,
    charts,
    research,
    researchFundamentals,
    researchMarket
);

// Expose le controleur pour les tests end-to-end (page.evaluate).
window.App = App;

window.onerror = function (msg, url, line) {
    console.error('Global Error:', msg, 'at line:', line);
};

document.addEventListener('DOMContentLoaded', () => {
    App.init().catch((e) => console.error('Critical initialization error:', e));
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .catch((e) => console.error('SW registration failed:', e));
    });
}

export { App, APIService, Utils, PortfolioService, CONFIG };
