/**
 * STOCK PORTFOLIO APP - CORE LOGIC & FINANCIAL ENGINE
 * Version 4.0: Complete Multi-Portfolio System & Consolidated Global View
 */

// --- CONFIG & CONSTANTS ---
const CONFIG = {
    MOCK_PRICES: {
        'AAPL': 225.50, 'MSFT': 445.00, 'GOOGL': 182.25, 'AMZN': 195.00, 'TSLA': 210.90,
        'NVDA': 125.00, 'META': 530.00, 'NFLX': 680.00, 'AMD': 160.00, 'INTC': 21.00,
        'BTC': 62000.00, 'ETH': 2700.00, 'SOL': 145.00,
        'SPY': 560.00, 'QQQ': 485.00, 'URTH': 155.00,
        'MC.PA': 670.00, 'OR.PA': 380.00, 'AIR.PA': 140.00, 'TTE.PA': 62.00, 'SAN.PA': 102.00
    },
    BENCHMARKS: {
        'SPY': { name: 'S&P 500', color: '#22c55e', basePrice: 500.0 },
        'QQQ': { name: 'NASDAQ', color: '#f97316', basePrice: 420.0 },
        '^FCHI': { name: 'CAC 40', color: '#ef4444', basePrice: 7500.0 },
        'URTH': { name: 'MSCI World', color: '#a855f7', basePrice: 140.0 },
        'BTC-USD': { name: 'Bitcoin', color: '#fbbf24', basePrice: 45000.0 }
    },
    CHART_PALETTE: ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#fbbf24', '#14b8a6', '#6366f1', '#ec4899', '#64748b'],
    LOGOKIT_TOKEN: 'pk_fr306e60debfe5e3d2759d',
    ACTIVE_PORTFOLIO_STORAGE: 'active_portfolio_id_v1',
    CURRENCY_STORAGE: 'portfolio_currency_pref',
    THEME_STORAGE: 'portfolio_theme',
    SIDE_STORAGE: 'portfolio_side_open',
    AI_PROVIDER_STORAGE: 'portfolio_ai_provider',
    INSIGHTS_CACHE_STORAGE: 'portfolio_insights_cache_v1',
    PORTFOLIO_ICONS_STORAGE: 'portfolio_icons_v1',
    PROXY_BASE_URL: 'https://fragrant-band-1476.jrichardeau-cloudflare.workers.dev',
    SUPABASE_URL: 'https://ttphzfvgeufoblkqvdsl.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_y3tJvH9sPMyHVW27tEwy2A_Rx-VGXCU'
};

const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// --- AI PROVIDERS (résumé du portefeuille) — métadonnées d'affichage uniquement.
// L'appel réel et la clé API vivent côté worker (POST /ai/insights) : la clé de
// l'utilisateur n'est jamais chargée ni conservée dans le navigateur.
const AI_PROVIDERS = {
    anthropic: { label: 'Anthropic (Claude)', keyPlaceholder: 'sk-ant-...', usesLiveSearch: true },
    openai: { label: 'OpenAI (ChatGPT)', keyPlaceholder: 'sk-...', usesLiveSearch: true },
    gemini: { label: 'Google (Gemini)', keyPlaceholder: 'AIza...', usesLiveSearch: false },
    grok: { label: 'xAI (Grok)', keyPlaceholder: 'xai-...', usesLiveSearch: true },
    groq: { label: 'Groq (Llama 3.3 70B)', keyPlaceholder: 'gsk_...', usesLiveSearch: false }
};

// --- AUTH SERVICE (Supabase Auth) ---
const AuthService = {
    async signUp(email, password) {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        return data;
    },

    async signIn(email, password) {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async signOut() {
        await supabaseClient.auth.signOut();
    },

    async getSession() {
        const { data } = await supabaseClient.auth.getSession();
        return data.session;
    },

    async refreshSession() {
        const { data, error } = await supabaseClient.auth.refreshSession();
        if (error) throw error;
        return data.session;
    },

    async resetPasswordForEmail(email) {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
    },

    async updatePassword(password) {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;
    },

    onAuthStateChange(callback) {
        supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
    }
};

// Supabase/PostgREST rejette un JWT dont l'iat est dans le futur : arrive quand
// l'horloge de l'appareil etait en avance au moment de la connexion et que le
// jeton (encore non expire) reste en cache dans localStorage.
function jwtIssuedAt(token) {
    try {
        const seg = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(seg));
        return typeof payload.iat === 'number' ? payload.iat : null;
    } catch (e) {
        return null;
    }
}

function isJwtTimingError(err) {
    const msg = ((err && (err.message || err.error_description || err.error)) || '') + '';
    return /issued at future|before issued|not yet valid|used before|clock/i.test(msg);
}

// --- ICONS : SVG inline, aucune bibliotheque (remplace lucide) ---
// Trace au style lucide : viewBox 24, stroke currentColor 2, bouts arrondis.
const Icons = {
    _tpl: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{P}</svg>',
    paths: {
        'sparkles': '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
        'line-chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
        'calendar-clock': '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
        'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
        'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
        'lock': '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
        'arrow-left-right': '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
        'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
        'pie-chart': '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
        'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
        'compass': '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
        'chevron-down': '<path d="m6 9 6 6 6-6"/>',
        'plus-circle': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
        'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
        'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
        'banknote': '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
        'landmark': '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="m12 2 8 5H4z"/>',
        'briefcase': '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
        'bitcoin': '<path d="M11.77 19.09c4.92.87 6.14-6.02 1.22-6.89m-1.22 6.89L5.86 18.05m5.91 1.04-.35 1.97m1.56-8.86c4.92.87 6.14-6.03 1.22-6.9m-1.22 6.9-3.94-.7m5.16-6.2L8.29 4.26m5.91 1.04.35-1.97M7.48 20.36 10.61 2.64"/>',
        'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
        'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        'piggy-bank': '<path d="M11 17h3v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-3V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1z"/><path d="M16 10h.01"/><path d="M2 8v1a2 2 0 0 0 2 2h1"/>',
        'coins': '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
        'cpu': '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
        'gem': '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
        'rocket': '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
        'edit-2': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>',
        'pencil': '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
        'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'
    },
    svg(name) {
        const p = this.paths[name];
        return p ? this._tpl.replace('{P}', p) : '';
    },
    render(root) {
        (root || document).querySelectorAll('i[data-lucide]').forEach(el => {
            const name = el.getAttribute('data-lucide');
            if (el.dataset.iconDone === name) return;
            const markup = this.svg(name);
            if (markup) {
                el.innerHTML = markup;
                el.dataset.iconDone = name;
            }
        });
    }
};
// Compat : les appels existants `lucide.createIcons()` restent valides.
if (typeof window !== 'undefined') {
    window.lucide = window.lucide || { createIcons: () => Icons.render() };
}

// --- ROBUST UTILITIES & DATE ENGINE ---
const Utils = {
    escapeHtml: (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    PORTFOLIO_ICONS: ['wallet', 'banknote', 'landmark', 'briefcase', 'bitcoin', 'shield', 'house', 'piggy-bank', 'coins', 'globe', 'cpu', 'trending-up', 'gem', 'rocket'],

    autoPortfolioIcon: (name) => {
        const n = (name || '').toLowerCase();
        const has = (...k) => k.some(x => n.includes(x));
        if (has('crypto', 'bitcoin', 'btc', ' eth', 'ether', 'web3')) return 'bitcoin';
        if (has('pea', 'épargne en actions', 'epargne en actions')) return 'landmark';
        if (has('assurance vie', 'assurance-vie', 'contrat')) return 'shield';
        if (has('cto', 'compte-titres', 'compte titres')) return 'briefcase';
        if (has('immo', 'immobilier', 'scpi', 'reit', 'pierre', 'foncier')) return 'house';
        if (has('retraite', ' per', 'pension')) return 'piggy-bank';
        if (has('dividende', 'rente', 'revenu', 'coupon')) return 'coins';
        if (has('livret', 'épargne', 'epargne', 'cash', 'liquidit', 'trésorerie', 'tresorerie')) return 'wallet';
        if (has('tech', 'nasdaq', 'growth', 'croissance', ' ia', 'semi-cond')) return 'cpu';
        if (has('monde', 'world', 'msci', 'etf', 'indiciel', 'passif', 'long terme')) return 'globe';
        if (has('trading', 'spécul', 'specul', 'court terme', 'swing')) return 'trending-up';
        if (has('or ', 'gold', 'métaux', 'metaux', 'précieux', 'precieux', 'luxe')) return 'gem';
        if (has('start', 'venture', 'pre-ipo', 'startup', 'moonshot', 'pari')) return 'rocket';
        if (has('salaire', 'compte courant', 'banque', 'quotidien')) return 'banknote';
        return 'wallet';
    },

    portfolioIconOverrides: () => {
        try { return JSON.parse(localStorage.getItem(CONFIG.PORTFOLIO_ICONS_STORAGE)) || {}; }
        catch (e) { return {}; }
    },

    portfolioIcon: (p) => {
        if (!p) return 'wallet';
        if (p.id === 'GLOBAL') return 'globe';
        return Utils.portfolioIconOverrides()[p.id] || Utils.autoPortfolioIcon(p.name);
    },

    setPortfolioIconOverride: (id, icon) => {
        const map = Utils.portfolioIconOverrides();
        if (icon) map[id] = icon; else delete map[id];
        localStorage.setItem(CONFIG.PORTFOLIO_ICONS_STORAGE, JSON.stringify(map));
    },

    parseDate: (val) => {
        if (!val) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        }
        if (val instanceof Date) {
            const d = new Date(val);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
                const parts = trimmed.split('T')[0].split('-');
                return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
            }
            if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(trimmed)) {
                const parts = trimmed.split(' ')[0].split('/');
                return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 0, 0, 0, 0);
            }
        }
        const d = new Date(val);
        d.setHours(0, 0, 0, 0);
        return d;
    },

    getDateString: (dateObj = new Date()) => {
        const d = Utils.parseDate(dateObj);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    formatDateDisplay: (dateStr) => {
        if (!dateStr) return '';
        const d = Utils.parseDate(dateStr);
        if (!d || isNaN(d.getTime())) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    },

    formatDateShort: (dateStr) => {
        if (!dateStr) return '';
        const d = Utils.parseDate(dateStr);
        return d.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
    },

    daysBetween: (d1, d2) => {
        const date1 = Utils.parseDate(d1);
        const date2 = Utils.parseDate(d2);
        const oneDay = 24 * 60 * 60 * 1000;
        return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
    },

    // Format FR : espace fine comme separateur de milliers, virgule decimale,
    // signe moins d'affichage U+2212. EUR : symbole suffixe (1 234,56 €). USD : symbole prefixe ($1 234,56).
    formatCurrency: (num, currency = 'USD') => {
        if (num === null || num === undefined || isNaN(num)) num = 0;
        const curr = (currency || 'USD').toUpperCase();
        const sign = num < 0 ? '−' : '';
        const body = new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Math.abs(num));
        if (curr === 'EUR') return `${sign}${body} €`;
        if (curr === 'GBP') return `${sign}£${body}`;
        if (curr === 'CAD') return `${sign}CA$${body}`;
        return `${sign}$${body}`;
    },

    formatPercent: (num, withSign = true) => {
        if (num === null || num === undefined || isNaN(num)) return '0,00 %';
        const sign = num < 0 ? '−' : (withSign && num > 0 ? '+' : '');
        const body = new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Math.abs(num));
        return sign + body + ' %';
    },

    generateID: () => '_' + Math.random().toString(36).substring(2, 11),

    // Format compact : 12,3 k / 4,56 M / 1,20 Md / 3,42 T (suffixe devise optionnel)
    formatCompact: (num, currency) => {
        if (num === null || num === undefined || isNaN(num)) return '—';
        const abs = Math.abs(num);
        const sign = num < 0 ? '−' : '';
        const units = [[1e12, 'T'], [1e9, 'Md'], [1e6, 'M'], [1e3, 'k']];
        let body;
        const hit = units.find(([v]) => abs >= v);
        if (hit) {
            body = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(abs / hit[0]) + ' ' + hit[1];
        } else {
            body = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(abs);
        }
        if (!currency) return sign + body;
        const curr = currency.toUpperCase();
        if (curr === 'EUR') return `${sign}${body} €`;
        if (curr === 'GBP') return `${sign}£${body}`;
        if (curr === 'CAD') return `${sign}CA$${body}`;
        return `${sign}$${body}`;
    },

    formatQty: (num) => {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(num);
    },

    getExchangeName: (symbol) => {
        if (!symbol) return 'US';
        if (symbol.startsWith('$')) return 'Trésorerie';
        const parts = symbol.split('.');
        if (parts.length === 1) return 'NASDAQ/NYSE';

        const suffix = parts[1];
        const map = {
            'PA': 'Euronext Paris',
            'L': 'London LSE',
            'TO': 'Toronto TSX',
            'DE': 'Xetra Allemagne',
            'MI': 'Borsa Italiana',
            'AS': 'Euronext Amsterdam',
            'BR': 'Euronext Bruxelles',
            'LS': 'Euronext Lisbonne',
            'MC': 'Bolsa de Madrid',
            'HK': 'Hong Kong HKSE',
            'KS': 'Korea KOSPI',
            'SI': 'Singapore SGX',
            'AX': 'Australie ASX',
            'NS': 'Inde NSE'
        };
        return map[suffix] || suffix;
    },

    getCurrency: (symbol) => {
        if (!symbol) return 'USD';
        if (symbol.startsWith('$')) return 'USD';
        const parts = symbol.split('.');
        if (parts.length === 1) return 'USD';
        const suffix = parts[1];
        const eurSuffixes = ['PA', 'DE', 'MI', 'AS', 'BR', 'LS', 'MC', 'NL'];
        if (eurSuffixes.includes(suffix)) return 'EUR';
        if (suffix === 'L') return 'GBP';
        if (suffix === 'TO' || suffix === 'V') return 'CAD';
        return 'USD';
    },

    getAssetClass: (symbol) => {
        if (!symbol) return 'Actions & ETF';
        const s = symbol.toUpperCase();
        if (s.startsWith('$')) return 'Trésorerie';
        if (s.endsWith('-USD') || ['BTC', 'ETH', 'SOL'].includes(s)) return 'Crypto';
        return 'Actions & ETF';
    },

    parseCSV: (text) => {
        const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
        if (lines.length === 0) return [];

        const parseLine = (line) => {
            const cells = [];
            let cur = '', inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (inQuotes) {
                    if (c === '"') {
                        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
                    } else {
                        cur += c;
                    }
                } else if (c === '"') {
                    inQuotes = true;
                } else if (c === ';') {
                    cells.push(cur);
                    cur = '';
                } else {
                    cur += c;
                }
            }
            cells.push(cur);
            return cells.map(c => c.trim());
        };

        const headers = parseLine(lines[0]).map(h => h.toLowerCase());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = parseLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => { row[h] = cells[idx] !== undefined ? cells[idx] : ''; });
            rows.push(row);
        }
        return rows;
    },

    csvCell: (val) => {
        const s = String(val === null || val === undefined ? '' : val);
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    },

    // Format FR : virgule decimale (ex: 10,5). A utiliser pour les colonnes numeriques du CSV.
    csvNumber: (val) => {
        if (val === null || val === undefined || val === '') return '';
        const n = Number(val);
        if (isNaN(n)) return '';
        return String(n).replace('.', ',');
    },

    // Parse un nombre saisi en format FR (virgule) ou US (point).
    parseCSVNumber: (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const n = parseFloat(String(val).trim().replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }
};

// --- API SERVICE (proxy Cloudflare Worker -> Yahoo Finance, voir worker/proxy.js) ---
const APIService = {
    quoteCache: {},
    candleCache: {},
    cachedFxRate: null,

    async searchSymbol(query) {
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) return data;
        } catch (e) {
            console.warn("Search proxy error, repli sur liste locale", e);
        }

        const mockEntries = Object.keys(CONFIG.MOCK_PRICES).map(s => ({
            displaySymbol: s,
            description: `${s} Asset`,
            type: s.includes('.PA') ? 'Common Stock' : s.includes('BTC') ? 'Crypto' : 'Stock'
        }));
        return mockEntries.filter(m => m.displaySymbol.toLowerCase().includes(query.toLowerCase()));
    },

    async webSearch(query) {
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/websearch?q=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            return (data && Array.isArray(data.results)) ? data.results : [];
        } catch (e) {
            console.warn('Websearch proxy error', e);
            return [];
        }
    },

    // Resume IA execute cote worker : la cle API du fournisseur n'est jamais
    // envoyee ici, seul le JWT Supabase identifie l'utilisateur.
    async aiInsights(provider, prompt, liveSearch) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(`${CONFIG.PROXY_BASE_URL}/ai/insights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ provider, prompt, liveSearch: !!liveSearch })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `proxy HTTP ${res.status}`);
        return data.text || '';
    },

    async aiKeySave(provider, key) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(`${CONFIG.PROXY_BASE_URL}/ai/key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ provider, key })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `proxy HTTP ${res.status}`);
        return data.configured || [];
    },

    async aiKeyDelete(provider) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Session expirée');
        const res = await fetch(`${CONFIG.PROXY_BASE_URL}/ai/key?provider=${encodeURIComponent(provider)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `proxy HTTP ${res.status}`);
        return data.configured || [];
    },

    async getCurrentPrice(symbol) {
        if (symbol.startsWith('$')) return 1.0;

        const now = Date.now();
        if (this.quoteCache[symbol] && (now - this.quoteCache[symbol].timestamp < 300000)) {
            return this.quoteCache[symbol].price;
        }

        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            if (data && typeof data.price === 'number' && data.price > 0) {
                this.quoteCache[symbol] = { timestamp: now, price: data.price };
                return data.price;
            }
            throw new Error('prix invalide');
        } catch (e) {
            console.warn(`Quote proxy error pour ${symbol}, repli mock`, e);
            return CONFIG.MOCK_PRICES[symbol.toUpperCase()] || 100.0;
        }
    },

    // Taux USD par unite de devise (USD/EUR ~1.08, USD/GBP ~1.27, USD/CAD ~0.73).
    FX_FALLBACK: { EUR: 1.08, GBP: 1.27, CAD: 0.73 },

    async getExchangeRate(currency = 'EUR') {
        const cur = (currency || 'EUR').toUpperCase();
        if (cur === 'USD') return 1;
        const fallback = this.FX_FALLBACK[cur];
        if (fallback === undefined) return null;

        const now = Date.now();
        this.cachedFxRates = this.cachedFxRates || {};
        const cached = this.cachedFxRates[cur];
        if (cached && (now - cached.timestamp < 3600000)) {
            return cached.rate;
        }

        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/quote?symbol=${encodeURIComponent(cur + 'USD=X')}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            if (data && typeof data.price === 'number' && data.price > 0) {
                this.cachedFxRates[cur] = { timestamp: now, rate: data.price };
                return data.price;
            }
            throw new Error('taux invalide');
        } catch (e) {
            console.warn(`FX proxy error ${cur}, repli ${fallback}`, e);
            this.cachedFxRates[cur] = { timestamp: now, rate: fallback };
            return fallback;
        }
    },

    async getExchangeRates() {
        const currencies = Object.keys(this.FX_FALLBACK);
        const rates = { USD: 1 };
        await Promise.all(currencies.map(async (cur) => {
            rates[cur] = await this.getExchangeRate(cur);
        }));
        return rates;
    },

    async getDailyHistory(symbol, startDate, endDate, anchorPriceStart, currentPriceEnd) {
        if (symbol.startsWith('$')) {
            const daily = {};
            const days = Utils.daysBetween(startDate, endDate);
            for (let i = 0; i <= days; i++) {
                const d = new Date(startDate);
                d.setDate(startDate.getDate() + i);
                daily[Utils.getDateString(d)] = 1.0;
            }
            return daily;
        }

        const cacheKey = `${symbol}_${Utils.getDateString(startDate)}_${Utils.getDateString(endDate)}`;
        if (this.candleCache[cacheKey]) {
            return this.candleCache[cacheKey];
        }

        try {
            const from = Utils.getDateString(startDate);
            const to = Utils.getDateString(endDate);
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/history?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const daily = await res.json();
            if (daily && Object.keys(daily).length > 0) {
                this.candleCache[cacheKey] = daily;
                return daily;
            }
            throw new Error('historique vide');
        } catch (e) {
            console.warn(`History proxy error pour ${symbol}, repli simulation`, e);
        }

        const daily = this.generateRealisticDailyHistory(symbol, startDate, endDate, anchorPriceStart, currentPriceEnd);
        this.candleCache[cacheKey] = daily;
        return daily;
    },

    async getDividends(symbol, from, to) {
        if (symbol.startsWith('$')) return [];
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/dividends?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const list = await res.json();
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.warn(`Dividends proxy error pour ${symbol}`, e);
            return [];
        }
    },

    async getSector(symbol) {
        if (symbol.startsWith('$')) return null;
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/sector?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            return data.sector || null;
        } catch (e) {
            console.warn(`Sector proxy error pour ${symbol}`, e);
            return null;
        }
    },

    async getEarnings(symbol) {
        if (symbol.startsWith('$')) return null;
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/earnings?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            return data && data.date ? data : null;
        } catch (e) {
            console.warn(`Earnings proxy error pour ${symbol}`, e);
            return null;
        }
    },

    _fundCache: {},
    async getFundamentals(symbol) {
        if (!symbol || symbol.startsWith('$')) return null;
        const now = Date.now();
        const cached = this._fundCache[symbol];
        if (cached && (now - cached.timestamp < 900000)) return cached.data;
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}/fundamentals?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            this._fundCache[symbol] = { timestamp: now, data };
            return data;
        } catch (e) {
            console.warn(`Fundamentals proxy error pour ${symbol}`, e);
            return null;
        }
    },

    // --- Sources fondamentales etendues (phases 2-11) ---
    // Cache TTL en memoire par type de donnee : fondamentaux trimestriels = 24 h,
    // donnees "riches" Yahoo = 1 h, peers = 7 j. En cas d'echec reseau on renvoie
    // la derniere valeur connue si elle existe, sinon null (jamais d'exception).
    _ttlCache: {},
    async _getCached(bucket, key, ttlMs, path) {
        const now = Date.now();
        const store = (this._ttlCache[bucket] = this._ttlCache[bucket] || {});
        const hit = store[key];
        if (hit && (now - hit.ts < ttlMs)) return hit.data;
        try {
            const res = await fetch(`${CONFIG.PROXY_BASE_URL}${path}`);
            if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
            const data = await res.json();
            store[key] = { ts: now, data };
            return data;
        } catch (e) {
            console.warn(`API ${bucket} error [${key}]`, e);
            return hit ? hit.data : null;
        }
    },

    getQuoteSummary(symbol) {
        return this._getCached('quoteSummary', symbol, 3600000,
            `/quoteSummary?symbol=${encodeURIComponent(symbol)}`);
    },
    getFmp(resource, symbol) {
        return this._getCached('fmp', `${resource}:${symbol}`, 86400000,
            `/fmp?resource=${encodeURIComponent(resource)}&symbol=${encodeURIComponent(symbol)}`);
    },
    getRecommendation(symbol) {
        return this._getCached('reco', symbol, 86400000,
            `/recommendation?symbol=${encodeURIComponent(symbol)}`);
    },
    getInsiderTransactions(symbol) {
        return this._getCached('insider', symbol, 86400000,
            `/insider?symbol=${encodeURIComponent(symbol)}`);
    },
    getPeers(symbol) {
        return this._getCached('peers', symbol, 604800000,
            `/peers?symbol=${encodeURIComponent(symbol)}`);
    },

    generateRealisticDailyHistory(symbol, startDate, endDate, startPrice, endPrice) {
        const dailyMap = {};
        const sDate = Utils.parseDate(startDate);
        const eDate = Utils.parseDate(endDate);
        const totalDays = Math.max(1, Utils.daysBetween(sDate, eDate));

        const p0 = startPrice > 0 ? startPrice : (CONFIG.MOCK_PRICES[symbol] || 100);
        const pT = endPrice > 0 ? endPrice : (CONFIG.MOCK_PRICES[symbol] || p0);

        let seed = 42;
        for (let i = 0; i < symbol.length; i++) {
            seed = (seed * 37 + symbol.charCodeAt(i)) % 100000;
        }

        const pseudoNoise = (dayIndex) => {
            const x = Math.sin(seed + dayIndex * 15.789) * 43758.5453;
            return (x - Math.floor(x)) - 0.49;
        };

        const totalGrowth = pT / Math.max(0.01, p0);
        const dailyDrift = Math.pow(totalGrowth, 1 / totalDays);

        let runningPrice = p0;

        for (let i = 0; i <= totalDays; i++) {
            const d = new Date(sDate);
            d.setDate(sDate.getDate() + i);
            const dStr = Utils.getDateString(d);

            if (i === 0) {
                dailyMap[dStr] = p0;
            } else if (i === totalDays) {
                dailyMap[dStr] = pT;
            } else {
                const noise = pseudoNoise(i) * 0.025;
                runningPrice = runningPrice * dailyDrift * (1 + noise);
                dailyMap[dStr] = Math.max(0.1, parseFloat(runningPrice.toFixed(2)));
            }
        }

        return dailyMap;
    }
};

// --- ANALYSE VALEUR : agregation multi-sources -> objet StockAnalysis unique ---
//
// Conventions de l'objet normalise (les composants UI ne connaissent que ca) :
//  - proportions (marges, ROE/ROA/ROIC, rendement, croissance, payout,
//    detention, short) => UNITES POURCENT (12.8 = 12,8 %), compatibles
//    Utils.formatPercent().
//  - multiples (P/E, PEG, EV/EBITDA, P/B, P/S, D/E, current/quick ratio,
//    interest coverage, netDebt/EBITDA) => nombre brut.
//  - montants => devise de reporting, valeur brute.
//  - toute donnee absente => null (jamais NaN, jamais undefined).
const AnalysisUtils = {
    num: (v) => (typeof v === 'number' && isFinite(v)) ? v : null,
    // fraction (0.128) -> pourcent (12.8)
    pctU: (v) => (typeof v === 'number' && isFinite(v)) ? v * 100 : null,
    arr: (v) => (Array.isArray(v) ? v : []),
    avg: (list) => {
        const x = list.filter(n => typeof n === 'number' && isFinite(n));
        return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
    },
    // CAGR en pourcent entre la 1re et la derniere valeur d'une serie.
    cagrPct: (first, last, years) =>
        (first > 0 && last > 0 && years > 0) ? (Math.pow(last / first, 1 / years) - 1) * 100 : null,
    // Tendance d'une serie ordonnee ancien -> recent.
    trend: (vals) => {
        const x = vals.filter(n => typeof n === 'number' && isFinite(n));
        if (x.length < 2) return null;
        const chg = (x[x.length - 1] - x[0]) / Math.abs(x[0] || 1);
        if (chg > 0.05) return 'croissant';
        if (chg < -0.05) return 'décroissant';
        return 'stable';
    },
    year: (row) => (row && (row.calendarYear || row.date || '')).toString().slice(0, 4) || null
};

const AnalysisService = {
    _cache: {},

    // Agrege toutes les sources pour un ticker et renvoie un StockAnalysis.
    // Cache 15 min sur l'agregat complet (les sous-appels ont leur propre TTL).
    async build(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return null;
        const now = Date.now();
        const hit = this._cache[symbol];
        if (hit && (now - hit.ts < 900000)) return hit.data;

        const nonUS = symbol.includes('.') || symbol.startsWith('$') || symbol.endsWith('-USD');
        const errors = [];
        const guard = (p, label) => Promise.resolve(p).catch(e => {
            console.warn(`AnalysisService: ${label} KO`, e);
            errors.push(label);
            return null;
        });

        const histStart = new Date(); histStart.setMonth(histStart.getMonth() - 15);
        const histEnd = new Date();

        const [
            fund, qs, ratios, income, cashflow, keyMetricsTtm, ratiosTtm,
            estimatesFmp, profileFmp, reco, insider, peersRaw, earn, history, dividends
        ] = await Promise.all([
            guard(APIService.getFundamentals(symbol), 'fundamentals'),
            guard(APIService.getQuoteSummary(symbol), 'quoteSummary'),
            guard(APIService.getFmp('ratios', symbol), 'fmp:ratios'),
            guard(APIService.getFmp('income', symbol), 'fmp:income'),
            guard(APIService.getFmp('cashflow', symbol), 'fmp:cashflow'),
            guard(APIService.getFmp('keyMetricsTtm', symbol), 'fmp:keyMetricsTtm'),
            guard(APIService.getFmp('ratiosTtm', symbol), 'fmp:ratiosTtm'),
            guard(APIService.getFmp('estimates', symbol), 'fmp:estimates'),
            guard(APIService.getFmp('profile', symbol), 'fmp:profile'),
            nonUS ? null : guard(APIService.getRecommendation(symbol), 'recommendation'),
            nonUS ? null : guard(APIService.getInsiderTransactions(symbol), 'insider'),
            guard(APIService.getPeers(symbol), 'peers'),
            guard(APIService.getEarnings(symbol), 'earnings'),
            guard(APIService.getDailyHistory(symbol, histStart, histEnd), 'history'),
            guard(APIService.getDividends(symbol, '2000-01-01', Utils.getDateString(histEnd)), 'dividends')
        ]);

        const data = this._normalize({
            symbol, nonUS, fund, qs, ratios, income, cashflow, keyMetricsTtm, ratiosTtm,
            estimatesFmp, profileFmp, reco, insider, peersRaw, earn, history, dividends, errors
        });
        this._cache[symbol] = { ts: now, data };
        return data;
    },

    _normalize(x) {
        const U = AnalysisUtils;
        const n = U.num, pctU = U.pctU;
        const qs = x.qs || {};
        const fund = x.fund || {};

        // FMP : tableaux annuels renvoyes du plus recent au plus ancien -> on
        // remet ancien -> recent pour les series temporelles.
        const ratiosAsc = U.arr(x.ratios).slice().reverse();
        const incomeAsc = U.arr(x.income).slice().reverse();
        const cashAsc = U.arr(x.cashflow).slice().reverse();
        const kmTtm = U.arr(x.keyMetricsTtm)[0] || {};
        const rTtm = U.arr(x.ratiosTtm)[0] || {};
        const profFmp = U.arr(x.profileFmp)[0] || {};
        const estAsc = U.arr(x.estimatesFmp).slice().reverse();
        const latestRatio = ratiosAsc[ratiosAsc.length - 1] || {};
        const fmpUnavailable = !!(x.ratios && x.ratios.unavailable) && !!(x.income && x.income.unavailable);

        const price = n(qs.price) ?? n(fund.price);
        const previousClose = n(qs.previousClose) ?? n(fund.previousClose);
        const marketCap = n(qs.marketCap) ?? n(fund.marketCap) ?? n(profFmp.mktCap);
        const currency = qs.currency || fund.currency || 'USD';

        // ---------- Identite ----------
        const identity = {
            name: qs.name || fund.name || profFmp.companyName || x.symbol,
            currency,
            exchange: qs.exchange || fund.exchange || profFmp.exchangeShortName || null,
            sector: profFmp.sector || qs.sector || null,
            industry: qs.industry || fund.industry || profFmp.industry || null,
            country: qs.country || fund.country || profFmp.country || null,
            ipo: fund.ipo || profFmp.ipoDate || null,
            website: qs.website || fund.weburl || profFmp.website || null,
            description: qs.longBusinessSummary || profFmp.description || null,
            employees: n(qs.fullTimeEmployees) ?? n(profFmp.fullTimeEmployees),
            logo: fund.logo || profFmp.image || null
        };

        // ---------- Prix / niveaux ----------
        const priceBlock = {
            current: price,
            previousClose,
            change: (price != null && previousClose != null) ? price - previousClose : null,
            changePct: (price != null && previousClose) ? (price - previousClose) / previousClose * 100 : null,
            fiftyTwoWeekHigh: n(qs.fiftyTwoWeekHigh) ?? n(fund.fiftyTwoWeekHigh),
            fiftyTwoWeekLow: n(qs.fiftyTwoWeekLow) ?? n(fund.fiftyTwoWeekLow),
            fiftyDayAverage: n(qs.fiftyDayAverage),
            twoHundredDayAverage: n(qs.twoHundredDayAverage),
            volume: n(fund.volume) ?? n(qs.regularMarketVolume),
            averageVolume: n(qs.averageVolume),
            marketCap,
            currency
        };

        // ---------- Valorisation ----------
        const fcfLatest = cashAsc.length ? n(cashAsc[cashAsc.length - 1].freeCashFlow) : null;
        const valuation = {
            peTTM: n(fund.peTTM) ?? n(qs.peTrailing) ?? n(rTtm.peRatioTTM),
            peForward: n(qs.peForward),
            peg: n(qs.pegRatio) ?? n(rTtm.pegRatioTTM),
            pb: n(fund.pbAnnual) ?? n(qs.priceToBook) ?? n(rTtm.priceToBookRatioTTM),
            ps: n(fund.psTTM) ?? n(qs.priceToSales) ?? n(rTtm.priceToSalesRatioTTM),
            evEbitda: n(qs.enterpriseToEbitda) ?? n(kmTtm.enterpriseValueOverEBITDATTM) ?? n(rTtm.enterpriseValueMultipleTTM),
            evRevenue: n(qs.enterpriseToRevenue) ?? n(kmTtm.evToSalesTTM),
            fcfYield: pctU(n(kmTtm.freeCashFlowYieldTTM)) ?? ((fcfLatest != null && marketCap) ? fcfLatest / marketCap * 100 : null),
            hist5y: {
                pe: U.avg(ratiosAsc.map(r => n(r.priceEarningsRatio))),
                pb: U.avg(ratiosAsc.map(r => n(r.priceToBookRatio))),
                ps: U.avg(ratiosAsc.map(r => n(r.priceToSalesRatio))),
                evEbitda: U.avg(ratiosAsc.map(r => n(r.enterpriseValueMultiple)))
            }
        };

        // ---------- Croissance ----------
        const revSeries = incomeAsc.map(r => ({ year: U.year(r), value: n(r.revenue) }));
        const epsSeries = incomeAsc.map(r => ({ year: U.year(r), value: n(r.eps) ?? n(r.epsdiluted) }));
        const revVals = revSeries.map(p => p.value).filter(v => v != null);
        const epsVals = epsSeries.map(p => p.value).filter(v => v != null);
        const growth = {
            revenueAnnual: revSeries,
            epsAnnual: epsSeries,
            revenueCagrPct: revVals.length >= 2 ? U.cagrPct(revVals[0], revVals[revVals.length - 1], revVals.length - 1) : null,
            epsCagrPct: epsVals.length >= 2 ? U.cagrPct(epsVals[0], epsVals[epsVals.length - 1], epsVals.length - 1) : null,
            revenueGrowthYoyPct: pctU(n(qs.revenueGrowth)) ?? n(fund.revenueGrowthTTM),
            epsGrowthYoyPct: pctU(n(qs.earningsGrowth)),
            estimates: estAsc.map(e => ({
                year: (e.date || '').toString().slice(0, 4),
                revenueAvg: n(e.estimatedRevenueAvg),
                epsAvg: n(e.estimatedEpsAvg),
                analysts: n(e.numberAnalystsEstimatedEps) ?? n(e.numberAnalystEstimatedEps) ?? n(e.numberAnalystEstimatedRevenue)
            })),
            estimatesShortTerm: U.arr(qs.estimates),   // Yahoo : 0q/+1q/0y/+1y
            analystCount: n(qs.numberOfAnalystOpinions),
            guidance: null   // Non disponible via les APIs gratuites retenues
        };

        // ---------- Sante financiere ----------
        const fcfHist = cashAsc.map(r => ({ year: U.year(r), value: n(r.freeCashFlow) }));
        const yahooDE = n(qs.debtToEquity);   // Yahoo exprime en % -> /100
        const health = {
            netDebtToEbitda: n(latestRatio.netDebtToEBITDA) ?? n(kmTtm.netDebtToEBITDATTM),
            debtToEquity: n(latestRatio.debtEquityRatio) ?? n(rTtm.debtEquityRatioTTM) ?? (yahooDE != null ? yahooDE / 100 : null),
            currentRatio: n(latestRatio.currentRatio) ?? n(qs.currentRatio) ?? n(rTtm.currentRatioTTM),
            quickRatio: n(latestRatio.quickRatio) ?? n(qs.quickRatio) ?? n(rTtm.quickRatioTTM),
            interestCoverage: n(latestRatio.interestCoverage) ?? n(rTtm.interestCoverageTTM) ?? n(kmTtm.interestCoverageTTM),
            fcfHistory: fcfHist,
            fcfTrend: U.trend(fcfHist.map(p => p.value)),
            totalCash: n(qs.totalCash),
            totalDebt: n(qs.totalDebt)
        };

        // ---------- Rentabilite ----------
        const marginHistory = {
            gross: ratiosAsc.map(r => ({ year: U.year(r), value: pctU(n(r.grossProfitMargin)) })),
            operating: ratiosAsc.map(r => ({ year: U.year(r), value: pctU(n(r.operatingProfitMargin)) })),
            net: ratiosAsc.map(r => ({ year: U.year(r), value: pctU(n(r.netProfitMargin)) }))
        };
        const lastOf = (s) => (s.length ? s[s.length - 1].value : null);
        const profitability = {
            roe: n(fund.roeTTM) ?? pctU(n(qs.returnOnEquity)) ?? pctU(n(rTtm.returnOnEquityTTM)),
            roa: pctU(n(qs.returnOnAssets)) ?? pctU(n(rTtm.returnOnAssetsTTM)),
            roic: pctU(n(kmTtm.roicTTM)) ?? pctU(n(kmTtm.returnOnInvestedCapitalTTM)),
            grossMargin: pctU(n(qs.grossMargins)) ?? lastOf(marginHistory.gross),
            operatingMargin: pctU(n(qs.operatingMargins)) ?? lastOf(marginHistory.operating),
            netMargin: n(fund.netMarginTTM) ?? pctU(n(qs.profitMargins)) ?? lastOf(marginHistory.net),
            marginHistory
        };

        // ---------- Sentiment de marche & positionnement ----------
        const recoRow = U.arr(x.reco)[0] || null;
        const consensus = recoRow
            ? { strongBuy: recoRow.strongBuy ?? null, buy: recoRow.buy ?? null, hold: recoRow.hold ?? null, sell: recoRow.sell ?? null, strongSell: recoRow.strongSell ?? null }
            : (qs.recommendationTrend && Object.values(qs.recommendationTrend).some(v => v != null) ? qs.recommendationTrend : null);
        const insiderList = (x.insider && Array.isArray(x.insider.data)) ? x.insider.data : [];
        let insBought = 0, insSold = 0;
        insiderList.forEach(t => { const c = n(t.change) || 0; if (c > 0) insBought += c; else insSold += Math.abs(c); });
        const sentiment = {
            consensus,
            recommendationKey: qs.recommendationKey || null,
            recommendationMean: n(qs.recommendationMean),
            targetMean: n(qs.targetMeanPrice),
            targetLow: n(qs.targetLowPrice),
            targetHigh: n(qs.targetHighPrice),
            targetMedian: n(qs.targetMedianPrice),
            analystCount: n(qs.numberOfAnalystOpinions),
            ptRevisions: null,   // Non disponible
            institutionalOwnership: pctU(n(qs.heldPercentInstitutions)),
            insiderOwnership: pctU(n(qs.heldPercentInsiders)),
            insider: insiderList.length
                ? { windowDays: 180, bought: insBought || 0, sold: insSold || 0, net: insBought - insSold, count: insiderList.length }
                : null,
            shortPercentOfFloat: pctU(n(qs.shortPercentOfFloat)),
            shortRatio: n(qs.shortRatio)
        };

        // ---------- Dividende ----------
        const dividend = this._dividendBlock(U.arr(x.dividends), {
            yieldPct: n(fund.dividendYield) ?? pctU(n(qs.dividendYield)) ?? pctU(n(rTtm.dividendYieldTTM)),
            payoutRatio: n(qs.payoutRatio) ?? n(rTtm.payoutRatioTTM) ?? n(latestRatio.payoutRatio),
            ratePerShare: n(qs.dividendRate),
            avgYield5y: n(qs.fiveYearAvgDividendYield)   // Yahoo : deja en unites de %
        });

        return {
            symbol: x.symbol,
            asOf: Utils.getDateString(new Date()),
            isUS: !x.nonUS,
            identity,
            price: priceBlock,
            valuation,
            growth,
            health,
            profitability,
            sentiment,
            dividend,
            peersSymbols: this._peerSymbols(x.peersRaw, x.symbol),
            priceHistory: x.history || {},   // brut, series utilisees en phase 7
            earnings: x.earn || null,
            technical: this._technicalBlock(x.history, priceBlock, qs),
            score: null,       // calcule en phase 11
            meta: {
                errors: x.errors,
                fmpUnavailable,
                sources: {
                    quote: qs.source ? 'yahoo' : (fund.price != null ? 'yahoo' : null),
                    ratios: fund.fundamentalsSource || null,
                    statements: U.arr(x.ratios).length ? 'fmp' : null,
                    analysts: (U.arr(x.reco).length ? 'finnhub' : (qs.numberOfAnalystOpinions != null ? 'yahoo' : null))
                }
            }
        };
    },

    _dividendBlock(divList, base) {
        const paysDividend = divList.length > 0 || (base.yieldPct != null && base.yieldPct > 0);
        const byYear = {};
        divList.forEach(d => {
            const y = (d.date || '').slice(0, 4);
            if (y) byYear[y] = (byYear[y] || 0) + (Number(d.amountPerShare) || 0);
        });
        const years = Object.keys(byYear).sort();
        const fullYears = years.slice(0, -1);   // l'annee courante est souvent incomplete
        let streak = 0;
        for (let i = fullYears.length - 1; i > 0; i--) {
            if (byYear[fullYears[i]] > byYear[fullYears[i - 1]] * 1.001) streak++;
            else break;
        }
        return {
            paysDividend,
            yieldPct: base.yieldPct,
            avgYield5y: base.avgYield5y ?? null,
            ratePerShare: base.ratePerShare,
            payoutRatio: base.payoutRatio,           // fraction (0.42) — cf. formatage en phase 8
            growthStreakYears: paysDividend ? streak : 0,
            annualPerShare: years.map(y => ({ year: y, value: byYear[y] })),
            lastPayment: divList.length ? divList[divList.length - 1] : null
        };
    },

    // ---------- Analyse technique ----------
    // Tout est calcule en JS a partir de la serie de cloture deja telechargee
    // (15 mois glissants) : aucune requete supplementaire.
    // Conventions : `null` si la profondeur d'historique est insuffisante,
    // pourcentages en unites de % (12.8 = 12,8 %).

    // Moyenne mobile simple : renvoie une serie de meme longueur, null avant la
    // periode de chauffe (index < n-1).
    _sma(values, n) {
        const out = new Array(values.length).fill(null);
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i];
            if (i >= n) sum -= values[i - n];
            if (i >= n - 1) out[i] = sum / n;
        }
        return out;
    },

    // RSI 14 (lissage de Wilder) : 0 = survente extreme, 100 = surachat extreme.
    _rsi(values, n = 14) {
        if (values.length <= n) return null;
        let gain = 0, loss = 0;
        for (let i = 1; i <= n; i++) {
            const d = values[i] - values[i - 1];
            if (d >= 0) gain += d; else loss -= d;
        }
        gain /= n; loss /= n;
        for (let i = n + 1; i < values.length; i++) {
            const d = values[i] - values[i - 1];
            gain = (gain * (n - 1) + Math.max(d, 0)) / n;
            loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
        }
        if (loss === 0) return gain === 0 ? 50 : 100;
        return 100 - 100 / (1 + gain / loss);
    },

    _technicalBlock(history, price, qs) {
        const n = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
        const dates = Object.keys(history || {}).sort()
            .filter(d => n(Number(history[d])) != null);
        const closes = dates.map(d => Number(history[d]));
        if (closes.length < 30) return null;

        const last = closes[closes.length - 1];
        const ma50s = this._sma(closes, 50);
        const ma200s = this._sma(closes, 200);
        const ma50 = ma50s[ma50s.length - 1];
        const ma200 = ma200s[ma200s.length - 1];

        // Croisement le plus recent des deux moyennes mobiles.
        // "golden cross" = MA50 repasse au-dessus de MA200 (signal haussier),
        // "death cross" = l'inverse. On remonte l'historique disponible.
        let cross = null, crossDate = null, crossDaysAgo = null;
        for (let i = closes.length - 1; i > 0; i--) {
            const a = ma50s[i], b = ma200s[i], pa = ma50s[i - 1], pb = ma200s[i - 1];
            if (a == null || b == null || pa == null || pb == null) break;
            if ((pa - pb) <= 0 && (a - b) > 0) { cross = 'golden'; crossDate = dates[i]; crossDaysAgo = closes.length - 1 - i; break; }
            if ((pa - pb) >= 0 && (a - b) < 0) { cross = 'death'; crossDate = dates[i]; crossDaysAgo = closes.length - 1 - i; break; }
        }

        // Tendance : alignement cours / MA50 / MA200, la lecture la plus courante.
        let trend = 'neutre';
        if (ma50 != null && ma200 != null) {
            if (last > ma50 && ma50 > ma200) trend = 'haussière';
            else if (last < ma50 && ma50 < ma200) trend = 'baissière';
        }

        const rsi = this._rsi(closes, 14);
        const window52 = closes.slice(-252);
        const high52 = (price && price.fiftyTwoWeekHigh != null) ? price.fiftyTwoWeekHigh : Math.max(...window52);
        const low52 = (price && price.fiftyTwoWeekLow != null) ? price.fiftyTwoWeekLow : Math.min(...window52);
        const range52 = (high52 != null && low52 != null && high52 > low52)
            ? (last - low52) / (high52 - low52) * 100
            : null;

        const volume = n(qs && qs.regularMarketVolume) ?? (price ? n(price.volume) : null);
        const avgVolume = n(qs && qs.averageVolume);

        return {
            lastClose: last,
            points: closes.length,
            ma50, ma200,
            priceVsMa50: ma50 == null ? null : (last - ma50) / ma50 * 100,
            priceVsMa200: ma200 == null ? null : (last - ma200) / ma200 * 100,
            maSeries: { dates, ma50: ma50s, ma200: ma200s },
            cross, crossDate, crossDaysAgo,
            trend,
            rsi14: rsi,
            rsiZone: rsi == null ? null : (rsi < 30 ? 'survente' : (rsi > 70 ? 'surachat' : 'neutre')),
            high52, low52,
            pctFromHigh52: high52 ? (last - high52) / high52 * 100 : null,
            pctFromLow52: low52 ? (last - low52) / low52 * 100 : null,
            rangePosition52: range52,
            volume, avgVolume,
            volumeRatio: (volume != null && avgVolume) ? volume / avgVolume : null
        };
    },

    _peerSymbols(peersRaw, symbol) {
        let list = [];
        if (Array.isArray(peersRaw)) {
            if (typeof peersRaw[0] === 'string') list = peersRaw;
            else if (peersRaw[0] && Array.isArray(peersRaw[0].peersList)) list = peersRaw[0].peersList;
        } else if (peersRaw && Array.isArray(peersRaw.peersList)) {
            list = peersRaw.peersList;
        }
        return list.filter(s => s && s !== symbol).slice(0, 4);
    }
};

// --- DATA & MULTI-PORTFOLIO ENGINE LAYER ---
class PortfolioService {
    constructor() {
        this.portfolios = [];
        this.activePortfolioId = 'GLOBAL';
        this.trades = [];
        this.marketPrices = {};
        this.dailyPriceCache = {};
        this.fxRate = 1.08;
        this.fxRates = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73 };
        this.userId = null;
        // Config IA liee au compte (table user_settings). aiProvider = fournisseur
        // choisi (non secret) ; aiConfigured = fournisseurs pour lesquels une cle
        // est stockee cote worker. Les cles elles-memes ne transitent jamais ici.
        this.aiProvider = null;
        this.aiConfigured = [];
    }

    // Charge la config IA du compte ; retombe sur le cache local (fournisseur
    // choisi uniquement) en cas d'echec (table absente, hors-ligne).
    async _loadAiConfig() {
        try {
            this.aiProvider = localStorage.getItem(CONFIG.AI_PROVIDER_STORAGE) || null;
        } catch (e) { /* stockage indisponible */ }

        try {
            const { data, error } = await supabaseClient
                .from('user_settings')
                .select('ai_provider, ai_providers_configured')
                .eq('user_id', this.userId)
                .maybeSingle();
            if (error || !data) return;
            this.aiProvider = data.ai_provider || null;
            this.aiConfigured = data.ai_providers_configured || [];
            try {
                if (this.aiProvider) localStorage.setItem(CONFIG.AI_PROVIDER_STORAGE, this.aiProvider);
                else localStorage.removeItem(CONFIG.AI_PROVIDER_STORAGE);
            } catch (e) { /* ignore */ }
        } catch (e) { /* on garde le cache local */ }
    }

    // Change le fournisseur actif (non secret) : ecriture directe via RLS + cache.
    async setAiProvider(provider) {
        this.aiProvider = provider || null;
        try {
            if (this.aiProvider) localStorage.setItem(CONFIG.AI_PROVIDER_STORAGE, this.aiProvider);
            else localStorage.removeItem(CONFIG.AI_PROVIDER_STORAGE);
        } catch (e) { /* ignore */ }
        const { error } = await supabaseClient.from('user_settings').upsert({
            user_id: this.userId,
            ai_provider: this.aiProvider,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
    }

    // Enregistre / supprime la cle API d'un fournisseur cote worker (chiffree).
    async saveAiKey(provider, key) {
        this.aiConfigured = await APIService.aiKeySave(provider, key);
        this.aiProvider = provider;
        try { localStorage.setItem(CONFIG.AI_PROVIDER_STORAGE, provider); } catch (e) { /* ignore */ }
    }

    async removeAiKey(provider) {
        this.aiConfigured = await APIService.aiKeyDelete(provider);
    }

    async _fetchRows() {
        const [{ data: portfolioRows, error: pErr }, { data: tradeRows, error: tErr }] = await Promise.all([
            supabaseClient.from('portfolios').select('*').order('created_at', { ascending: true }),
            supabaseClient.from('trades').select('*')
        ]);
        if (pErr) throw pErr;
        if (tErr) throw tErr;
        return { portfolioRows, tradeRows };
    }

    async load() {
        let session = await AuthService.getSession();
        if (!session) throw new Error('Pas de session active');

        // Jeton emis dans le futur (horloge de l'appareil en avance) : on force un
        // rafraichissement pour obtenir un access_token avec un iat correct.
        const iat = jwtIssuedAt(session.access_token);
        if (iat && iat * 1000 - Date.now() > 5000) {
            session = await AuthService.refreshSession().catch(() => session);
        }
        this.userId = session.user.id;

        let portfolioRows, tradeRows;
        try {
            ({ portfolioRows, tradeRows } = await this._fetchRows());
        } catch (err) {
            if (!isJwtTimingError(err)) throw err;
            // Rafraichit le jeton puis laisse le serveur rattraper l'ecart avant de reessayer.
            await AuthService.refreshSession().catch(() => {});
            await new Promise(r => setTimeout(r, 2500));
            ({ portfolioRows, tradeRows } = await this._fetchRows());
        }

        if (portfolioRows.length === 0) {
            const created = await this.createPortfolio('Portefeuille Principal', '#3b82f6');
            this.portfolios = [created];
        } else {
            this.portfolios = portfolioRows.map(r => ({ id: r.id, name: r.name, color: r.color, createdAt: r.created_at }));
        }

        this.trades = (tradeRows || []).map(r => ({
            id: r.id,
            portfolioId: r.portfolio_id,
            type: r.type,
            symbol: r.symbol,
            qty: Number(r.qty),
            price: Number(r.price),
            amount: Number(r.amount),
            fees: Number(r.fees) || 0,
            fxRate: Number(r.fx_rate) || null,
            date: r.date
        }));

        const storedActiveId = localStorage.getItem(CONFIG.ACTIVE_PORTFOLIO_STORAGE);
        this.activePortfolioId = storedActiveId || this.portfolios[0].id;
        if (this.activePortfolioId !== 'GLOBAL' && !this.portfolios.find(p => p.id === this.activePortfolioId)) {
            this.activePortfolioId = this.portfolios[0].id;
        }

        await this._loadAiConfig();
    }

    async createPortfolio(name, color = '#3b82f6') {
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('Nom de portefeuille requis');
        if (this.portfolios.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
            throw new Error(`Un portefeuille nommé "${trimmed}" existe déjà`);
        }

        const { data, error } = await supabaseClient
            .from('portfolios')
            .insert({ user_id: this.userId, name: trimmed, color: color || '#3b82f6' })
            .select()
            .single();
        if (error) throw error;

        const newPort = { id: data.id, name: data.name, color: data.color, createdAt: data.created_at };
        if (!this.portfolios.find(p => p.id === newPort.id)) {
            this.portfolios.push(newPort);
        }
        this.setActivePortfolio(newPort.id);
        return newPort;
    }

    async renamePortfolio(id, newName, newColor) {
        const trimmed = (newName || '').trim();
        if (!trimmed) throw new Error('Nom de portefeuille requis');
        if (this.portfolios.some(p => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
            throw new Error(`Un portefeuille nommé "${trimmed}" existe déjà`);
        }

        const updates = { name: trimmed };
        if (newColor) updates.color = newColor;

        const { error } = await supabaseClient.from('portfolios').update(updates).eq('id', id);
        if (error) throw error;

        const p = this.portfolios.find(x => x.id === id);
        if (p) {
            p.name = updates.name;
            if (newColor) p.color = newColor;
        }
        window.dispatchEvent(new CustomEvent('portfolio-updated'));
    }

    async deletePortfolio(id) {
        if (this.portfolios.length <= 1) {
            alert("Impossible de supprimer le seul portefeuille existant.");
            return false;
        }

        const { error } = await supabaseClient.from('portfolios').delete().eq('id', id);
        if (error) throw error;

        // La contrainte "on delete cascade" cote Supabase supprime deja les trades associes
        this.trades = this.trades.filter(t => t.portfolioId !== id);
        this.portfolios = this.portfolios.filter(p => p.id !== id);

        if (this.activePortfolioId === id) {
            this.setActivePortfolio(this.portfolios[0].id);
        } else {
            window.dispatchEvent(new CustomEvent('portfolio-updated'));
        }
        return true;
    }

    setActivePortfolio(id) {
        this.activePortfolioId = id;
        localStorage.setItem(CONFIG.ACTIVE_PORTFOLIO_STORAGE, id);
        this.refreshPrices();
    }

    getActivePortfolio() {
        if (this.activePortfolioId === 'GLOBAL') {
            return { id: 'GLOBAL', name: 'Tous les portefeuilles (Global)', color: '#4f46e5' };
        }
        return this.portfolios.find(p => p.id === this.activePortfolioId) || this.portfolios[0];
    }

    getPortfolioById(id) {
        return this.portfolios.find(p => p.id === id) || { name: 'Inconnu', color: '#6b7280' };
    }

    getFilteredTrades() {
        if (this.activePortfolioId === 'GLOBAL') {
            return [...this.trades];
        }
        return this.trades.filter(t => t.portfolioId === this.activePortfolioId);
    }

    getSortedTrades() {
        return this.getFilteredTrades().sort((a, b) => {
            const dA = Utils.parseDate(a.date);
            const dB = Utils.parseDate(b.date);
            return dA.getTime() - dB.getTime();
        });
    }

    getFirstTradeDate() {
        const sorted = this.getSortedTrades();
        return sorted.length > 0 ? Utils.parseDate(sorted[0].date) : null;
    }

    async refreshPrices() {
        const uniqueSymbols = [...new Set(this.trades.map(t => t.symbol).filter(s => !s.startsWith('$') && s !== '$FEE'))];
        this.marketPrices = {};

        await Promise.all(uniqueSymbols.map(async (sym) => {
            this.marketPrices[sym] = await APIService.getCurrentPrice(sym);
        }));

        this.fxRates = await APIService.getExchangeRates();
        this.fxRate = this.fxRates.EUR || 1.08;

        const earliestDate = this.getFirstTradeDate() || new Date(Date.now() - 365 * 24 * 3600 * 1000);
        const today = new Date();

        await Promise.all(uniqueSymbols.map(async (sym) => {
            const symTrades = this.trades.filter(t => t.symbol === sym && t.type === 'BUY').sort((a, b) => Utils.parseDate(a.date) - Utils.parseDate(b.date));
            const anchorBuyPrice = symTrades.length > 0 ? symTrades[0].price : (this.marketPrices[sym] || 100);
            const currentPrice = this.marketPrices[sym] || anchorBuyPrice;

            const dailyPrices = await APIService.getDailyHistory(sym, earliestDate, today, anchorBuyPrice, currentPrice);
            this.dailyPriceCache[sym] = dailyPrices;
        }));

        window.dispatchEvent(new CustomEvent('portfolio-updated'));
    }

    getPriceOnDate(symbol, dateStr, fallbackPrice = 100) {
        if (symbol.startsWith('$')) return 1.0;

        // Le jour courant est souvent absent de l'historique proxy : on retombe sur le prix
        // live pour que le dernier point du graphe colle a la carte "Valeur du portefeuille".
        if (dateStr >= Utils.getDateString() && this.marketPrices[symbol] > 0) {
            return this.marketPrices[symbol];
        }

        const symPrices = this.dailyPriceCache[symbol];
        if (symPrices && symPrices[dateStr] !== undefined) {
            return symPrices[dateStr];
        }

        if (symPrices) {
            const availableDates = Object.keys(symPrices).sort();
            const priorDates = availableDates.filter(d => d <= dateStr);
            if (priorDates.length > 0) {
                return symPrices[priorDates[priorDates.length - 1]];
            }
            if (availableDates.length > 0) {
                return symPrices[availableDates[0]];
            }
        }

        return this.marketPrices[symbol] || fallbackPrice;
    }

    normalizeTradeInput(tradeData) {
        const type = (tradeData.type || 'BUY').toUpperCase();
        let symbol = (tradeData.symbol || '').toUpperCase().trim();
        let qty = parseFloat(tradeData.qty) || 0;
        let price = parseFloat(tradeData.price) || 0;
        let amount = parseFloat(tradeData.amount) || 0;
        const fees = parseFloat(tradeData.fees) || 0;
        const normalizedDate = Utils.getDateString(tradeData.date || new Date());

        let portfolioId = tradeData.portfolioId;
        if (!portfolioId || portfolioId === 'GLOBAL') {
            portfolioId = this.activePortfolioId === 'GLOBAL'
                ? (this.portfolios[0] ? this.portfolios[0].id : null)
                : this.activePortfolioId;
        }

        if (type === 'DEPOSIT' || type === 'WITHDRAWAL') {
            symbol = '$CASH';
            amount = amount > 0 ? amount : (qty * price || qty || price || 0);
            qty = amount;
            price = 1.0;
        } else if (type === 'DIVIDEND') {
            symbol = symbol || '$CASH';
            amount = amount > 0 ? amount : (qty * price || price || 0);
            qty = 1;
            price = amount;
        } else if (type === 'FEE') {
            symbol = '$FEE';
            amount = amount > 0 ? amount : (qty * price || price || 0);
            qty = 1;
            price = amount;
        } else {
            amount = qty * price;
        }

        // Taux de change fige a la saisie (USD pour 1 unite de la devise native du titre).
        // Reutilise une valeur fournie (ex. re-edition, import) sinon prend le spot courant.
        const nativeCurrency = Utils.getCurrency(symbol);
        let fxRate = tradeData.fxRate != null ? Number(tradeData.fxRate) : null;
        if (!(fxRate > 0)) {
            fxRate = nativeCurrency === 'USD'
                ? 1
                : ((this.fxRates && this.fxRates[nativeCurrency]) || null);
        }

        return { type, symbol, qty, price, amount, fees, fxRate, date: normalizedDate, portfolioId };
    }

    validateTrade(n, excludeTradeId) {
        const errors = [];

        if (!n.date) {
            errors.push('Date manquante');
        } else if (n.date > Utils.getDateString()) {
            errors.push('La date ne peut pas être dans le futur');
        }

        if (n.type === 'BUY' || n.type === 'SELL') {
            if (!n.symbol) errors.push('Symbole manquant');
            if (!(n.qty > 0)) errors.push('Quantité invalide (doit être > 0)');
            if (!(n.price > 0)) errors.push('Prix invalide (doit être > 0)');

            if (n.type === 'SELL' && n.symbol) {
                const held = this.trades
                    .filter(t => t.id !== excludeTradeId && t.symbol === n.symbol
                        && (t.type === 'BUY' || t.type === 'SELL')
                        && t.portfolioId === n.portfolioId
                        && t.date <= n.date)
                    .reduce((q, t) => q + (t.type === 'BUY' ? t.qty : -t.qty), 0);
                if (n.qty > held + 0.0001) {
                    errors.push(`Quantité vendue (${n.qty}) supérieure à la quantité détenue à cette date (${held})`);
                }
            }
        } else if (['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'FEE'].includes(n.type)) {
            if (!(n.amount > 0)) errors.push('Montant invalide (doit être > 0)');
        } else {
            errors.push('Type de transaction inconnu');
        }

        if (errors.length) throw new Error(errors.join(' ; '));
    }

    async addTrade(tradeData) {
        const n = this.normalizeTradeInput(tradeData);
        this.validateTrade(n);

        const { data, error } = await supabaseClient
            .from('trades')
            .insert({
                user_id: this.userId,
                portfolio_id: n.portfolioId,
                type: n.type, symbol: n.symbol, qty: n.qty, price: n.price, amount: n.amount, fees: n.fees,
                fx_rate: n.fxRate,
                date: n.date
            })
            .select()
            .single();
        if (error) throw error;

        const newTrade = {
            id: data.id,
            portfolioId: data.portfolio_id,
            type: data.type,
            symbol: data.symbol,
            qty: Number(data.qty),
            price: Number(data.price),
            amount: Number(data.amount),
            fees: Number(data.fees) || 0,
            fxRate: Number(data.fx_rate) || null,
            date: data.date
        };

        this.trades.push(newTrade);
        this.refreshPrices();
        return newTrade;
    }

    async updateTrade(id, tradeData) {
        const n = this.normalizeTradeInput(tradeData);
        this.validateTrade(n, id);

        const { data, error } = await supabaseClient
            .from('trades')
            .update({
                portfolio_id: n.portfolioId,
                type: n.type, symbol: n.symbol, qty: n.qty, price: n.price, amount: n.amount, fees: n.fees,
                fx_rate: n.fxRate,
                date: n.date
            })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;

        const updatedTrade = {
            id: data.id,
            portfolioId: data.portfolio_id,
            type: data.type,
            symbol: data.symbol,
            qty: Number(data.qty),
            price: Number(data.price),
            amount: Number(data.amount),
            fees: Number(data.fees) || 0,
            fxRate: Number(data.fx_rate) || null,
            date: data.date
        };

        const idx = this.trades.findIndex(t => t.id === id);
        if (idx !== -1) this.trades[idx] = updatedTrade;

        this.refreshPrices();
        return updatedTrade;
    }

    async removeTrade(id) {
        const { error } = await supabaseClient.from('trades').delete().eq('id', id);
        if (error) throw error;

        this.trades = this.trades.filter(t => t.id !== id);
        this.refreshPrices();
    }

    async addTradesBulk(tradesDataArray) {
        const rows = tradesDataArray.map(td => {
            const n = this.normalizeTradeInput(td);
            return {
                user_id: this.userId,
                portfolio_id: n.portfolioId,
                type: n.type, symbol: n.symbol, qty: n.qty, price: n.price, amount: n.amount, fees: n.fees,
                fx_rate: n.fxRate,
                date: n.date
            };
        });

        const { data, error } = await supabaseClient.from('trades').insert(rows).select();
        if (error) throw error;

        const newTrades = data.map(d => ({
            id: d.id,
            portfolioId: d.portfolio_id,
            type: d.type,
            symbol: d.symbol,
            qty: Number(d.qty),
            price: Number(d.price),
            amount: Number(d.amount),
            fees: Number(d.fees) || 0,
            fxRate: Number(d.fx_rate) || null,
            date: d.date
        }));

        this.trades.push(...newTrades);
        this.refreshPrices();
        return newTrades.length;
    }

    exportToCSV() {
        const headers = ['date', 'type', 'symbol', 'qty', 'price', 'currency', 'fees', 'amount', 'portfolio'];
        const lines = [headers.join(';')];

        this.trades.slice().sort((a, b) => Utils.parseDate(a.date) - Utils.parseDate(b.date)).forEach(t => {
            const port = this.getPortfolioById(t.portfolioId);
            const currency = Utils.getCurrency(t.symbol);
            lines.push([
                t.date, t.type, t.symbol,
                Utils.csvNumber(t.qty), Utils.csvNumber(t.price), currency, Utils.csvNumber(t.fees || 0), Utils.csvNumber(t.amount),
                port.name
            ].map(Utils.csvCell).join(';'));
        });

        return lines.join('\n');
    }

    async importFromCSV(csvText) {
        const rows = Utils.parseCSV(csvText);
        if (!rows.length) return { added: 0, errors: ['Fichier CSV vide'] };

        const errors = [];
        const portfolioNameToId = {};
        this.portfolios.forEach(p => { portfolioNameToId[p.name.toLowerCase()] = p.id; });

        for (const row of rows) {
            const pname = (row.portfolio || '').trim();
            if (pname && !portfolioNameToId[pname.toLowerCase()]) {
                const created = await this.createPortfolio(pname);
                portfolioNameToId[pname.toLowerCase()] = created.id;
            }
        }

        const defaultPortfolioId = this.activePortfolioId !== 'GLOBAL'
            ? this.activePortfolioId
            : (this.portfolios[0] && this.portfolios[0].id);

        const tradesData = [];
        rows.forEach((row, idx) => {
            try {
                if (!row.date || !row.type) throw new Error('date/type manquant');

                const type = row.type.toUpperCase();
                const symbol = (row.symbol || '').toUpperCase().trim();
                let price = Utils.parseCSVNumber(row.price);
                let fees = Utils.parseCSVNumber(row.fees);

                if ((type === 'BUY' || type === 'SELL') && row.currency) {
                    const enteredCurrency = row.currency.toUpperCase();
                    const nativeCurrency = Utils.getCurrency(symbol);
                    if (enteredCurrency !== nativeCurrency) {
                        price = this.convertCurrency(price, enteredCurrency, nativeCurrency);
                        fees = this.convertCurrency(fees, enteredCurrency, nativeCurrency);
                    }
                }

                const pname = (row.portfolio || '').trim();
                const portfolioId = pname ? portfolioNameToId[pname.toLowerCase()] : defaultPortfolioId;

                const rowTrade = {
                    portfolioId,
                    type,
                    symbol,
                    qty: Utils.parseCSVNumber(row.qty),
                    price,
                    amount: Utils.parseCSVNumber(row.amount),
                    fees,
                    date: row.date
                };

                const normalized = this.normalizeTradeInput(rowTrade);
                this.validateTrade(normalized);
                tradesData.push(rowTrade);
            } catch (e) {
                errors.push(`Ligne ${idx + 2} : ${e.message}`);
            }
        });

        if (tradesData.length === 0) return { added: 0, errors };

        const added = await this.addTradesBulk(tradesData);
        return { added, errors };
    }

    getQtyHeldOnDate(symbol, dateStr) {
        let qty = 0;
        this.trades
            .filter(t => t.symbol === symbol && t.date <= dateStr && (t.type === 'BUY' || t.type === 'SELL'))
            .forEach(t => { qty += t.type === 'BUY' ? t.qty : -t.qty; });
        return qty;
    }

    async syncDividends() {
        const symbols = [...new Set(this.trades.filter(t => t.type === 'BUY').map(t => t.symbol))];
        const existingKeys = new Set(
            this.trades.filter(t => t.type === 'DIVIDEND').map(t => `${t.symbol}_${t.date}`)
        );

        let added = 0;
        for (const symbol of symbols) {
            const buys = this.trades
                .filter(t => t.symbol === symbol && t.type === 'BUY')
                .sort((a, b) => Utils.parseDate(a.date) - Utils.parseDate(b.date));
            if (!buys.length) continue;

            const from = buys[0].date;
            const to = Utils.getDateString();
            const events = await APIService.getDividends(symbol, from, to);

            for (const ev of events) {
                if (existingKeys.has(`${symbol}_${ev.date}`)) continue;
                const qty = this.getQtyHeldOnDate(symbol, ev.date);
                if (qty <= 0) continue;

                await this.addTrade({
                    portfolioId: buys[0].portfolioId,
                    type: 'DIVIDEND',
                    symbol,
                    amount: qty * ev.amountPerShare,
                    date: ev.date
                });
                existingKeys.add(`${symbol}_${ev.date}`);
                added++;
            }
        }
        return added;
    }

    convertCurrency(val, fromCurrency, targetCurrency) {
        const from = (fromCurrency || 'USD').toUpperCase();
        const target = (targetCurrency || 'USD').toUpperCase();
        if (from === target) return val;

        const rates = this.fxRates || {};
        const usdPerUnit = (cur) => {
            if (cur === 'USD') return 1;
            // EUR : this.fxRate fait foi (taux live, maj par refreshPrices ; sync avec fxRates.EUR).
            if (cur === 'EUR') return this.fxRate || rates.EUR || 1.08;
            if (rates[cur] > 0) return rates[cur];
            return null;
        };

        const fromRate = usdPerUnit(from);
        const targetRate = usdPerUnit(target);
        if (fromRate === null || targetRate === null) {
            console.warn(`convertCurrency: taux manquant pour ${from}->${target}, valeur non convertie`);
            return val;
        }
        return val * (fromRate / targetRate);
    }

    calculatePortfolio(targetCurrency = 'USD') {
        const FX = this.fxRate || 1.08;
        const sortedTrades = this.getSortedTrades();

        let displayCashUSD = 0;
        let totalDepositsUSD = 0;
        let totalWithdrawalsUSD = 0;
        let totalBuyCostUSD = 0;
        let realizedPnLUSD = 0;
        let totalDividendsUSD = 0;
        let totalFeesUSD = 0;
        let standaloneFeesUSD = 0;
        let runningNetContribUSD = 0;
        let peakNetContribUSD = 0;
        let holdings = {};
        const firstTradeDate = this.getFirstTradeDate();

        sortedTrades.forEach(trade => {
            const currency = Utils.getCurrency(trade.symbol);
            const toUSD = (val) => this.convertCurrency(val, currency, 'USD');

            switch (trade.type) {
                case 'DEPOSIT': {
                    const amtUSD = toUSD(trade.amount);
                    displayCashUSD += amtUSD;
                    totalDepositsUSD += amtUSD;
                    runningNetContribUSD += amtUSD;
                    peakNetContribUSD = Math.max(peakNetContribUSD, runningNetContribUSD);
                    break;
                }
                case 'WITHDRAWAL': {
                    const amtUSD = toUSD(trade.amount);
                    displayCashUSD -= amtUSD;
                    totalWithdrawalsUSD += amtUSD;
                    runningNetContribUSD -= amtUSD;
                    break;
                }
                case 'BUY': {
                    const feeUSD = toUSD(trade.fees || 0);
                    // Base de cout = prix des parts uniquement ; les frais sont suivis a part
                    // (totalFeesUSD) et deduits une seule fois du P&L total.
                    const sharesCostUSD = toUSD(trade.qty * trade.price);
                    displayCashUSD -= (sharesCostUSD + feeUSD);
                    totalFeesUSD += feeUSD;
                    totalBuyCostUSD += sharesCostUSD + feeUSD;

                    if (!holdings[trade.symbol]) {
                        holdings[trade.symbol] = { qty: 0, totalCostUSD: 0, avgPriceNative: 0, currency, portfolios: new Set() };
                    }
                    const h = holdings[trade.symbol];
                    h.qty += trade.qty;
                    h.totalCostUSD += sharesCostUSD;
                    h.avgPriceNative = this.convertCurrency(h.totalCostUSD / h.qty, 'USD', currency);
                    h.portfolios.add(trade.portfolioId);
                    break;
                }
                case 'SELL': {
                    const feeUSD = toUSD(trade.fees || 0);
                    const h = holdings[trade.symbol];
                    // Clamp a la quantite reellement detenue dans ce perimetre : un SELL sans
                    // position correspondante (mauvais portefeuille, anteriorite) ne doit pas
                    // crediter de cash fantome ni de P&L realise.
                    const sellQty = Math.min(trade.qty, h ? Math.max(0, h.qty) : 0);
                    if (sellQty > 0) {
                        const grossRevenueUSD = toUSD(sellQty * trade.price);
                        displayCashUSD += grossRevenueUSD - feeUSD;
                        totalFeesUSD += feeUSD;

                        const costOfSoldUSD = (h.totalCostUSD / h.qty) * sellQty;
                        realizedPnLUSD += grossRevenueUSD - costOfSoldUSD;

                        h.qty -= sellQty;
                        h.totalCostUSD -= costOfSoldUSD;
                        if (h.qty <= 0.00001) {
                            h.qty = 0;
                            h.totalCostUSD = 0;
                        }
                    }
                    break;
                }
                case 'DIVIDEND': {
                    const divUSD = toUSD(trade.amount);
                    displayCashUSD += divUSD;
                    totalDividendsUSD += divUSD;
                    break;
                }
                case 'FEE': {
                    const feeUSD = toUSD(trade.amount);
                    totalFeesUSD += feeUSD;
                    standaloneFeesUSD += feeUSD;
                    break;
                }
            }
        });

        let holdingsTotalValueUSD = 0;
        let holdingsTotalCostUSD = 0;
        let unrealizedPnLUSD = 0;

        const holdingsList = Object.entries(holdings).map(([symbol, data]) => {
            if (data.qty < 0.0001) return null;

            const currentPriceNative = this.marketPrices[symbol] || data.avgPriceNative;
            const valueNative = data.qty * currentPriceNative;
            const costNative = data.qty * data.avgPriceNative;
            const gainNative = valueNative - costNative;
            const gainPercent = costNative > 0 ? (gainNative / costNative) * 100 : 0;

            const valueUSD = this.convertCurrency(valueNative, data.currency, 'USD');
            const costUSD = this.convertCurrency(costNative, data.currency, 'USD');
            const gainUSD = valueUSD - costUSD;

            holdingsTotalValueUSD += valueUSD;
            holdingsTotalCostUSD += costUSD;
            unrealizedPnLUSD += gainUSD;

            return {
                symbol,
                qty: data.qty,
                avgPrice: data.avgPriceNative,
                currentPrice: currentPriceNative,
                valueNative,
                costNative,
                gainNative,
                gainPercent,
                valueUSD,
                currency: data.currency,
                portfolios: Array.from(data.portfolios || [])
            };
        }).filter(Boolean);

        holdingsList.forEach(h => {
            h.weightPercent = holdingsTotalValueUSD > 0 ? (h.valueUSD / holdingsTotalValueUSD) * 100 : 0;
        });

        const totalPortfolioValueUSD = displayCashUSD + holdingsTotalValueUSD;
        // Base de rendement = pic historique de capital net apporte (jamais 0/negatif meme si
        // les retraits ont depasse les depots), repli sur le cout d'achat cumule.
        const netInvestedCapitalUSD = peakNetContribUSD > 0
            ? peakNetContribUSD
            : (totalBuyCostUSD > 0 ? totalBuyCostUSD : 0);
        const totalPnLUSD = unrealizedPnLUSD + realizedPnLUSD + totalDividendsUSD - totalFeesUSD;
        const totalReturnPercent = netInvestedCapitalUSD > 0 ? (totalPnLUSD / netInvestedCapitalUSD) * 100 : 0;
        const unrealizedPercent = holdingsTotalCostUSD > 0 ? (unrealizedPnLUSD / holdingsTotalCostUSD) * 100 : 0;

        const toTarget = (usdVal) => this.convertCurrency(usdVal, 'USD', targetCurrency);

        return {
            targetCurrency,
            totalValue: toTarget(totalPortfolioValueUSD),
            holdingsValue: toTarget(holdingsTotalValueUSD),
            cash: toTarget(displayCashUSD),
            holdingsCost: toTarget(holdingsTotalCostUSD),
            totalDeposits: toTarget(totalDepositsUSD),
            totalWithdrawals: toTarget(totalWithdrawalsUSD),
            netInvestedCapital: toTarget(netInvestedCapitalUSD),
            unrealizedPnL: toTarget(unrealizedPnLUSD),
            unrealizedPercent,
            realizedPnL: toTarget(realizedPnLUSD),
            totalDividends: toTarget(totalDividendsUSD),
            totalFees: toTarget(totalFeesUSD),
            totalPnL: toTarget(totalPnLUSD),
            totalReturnPercent,
            holdings: holdingsList,
            firstTradeDate,
            fxRate: FX
        };
    }

    getDailyMovers(targetCurrency = 'USD') {
        const stats = this.calculatePortfolio(targetCurrency);

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const yesterdayStr = Utils.getDateString(yesterday);

        const movers = stats.holdings.map(h => {
            const currentPrice = h.currentPrice;
            const prevClose = this.getPriceOnDate(h.symbol, yesterdayStr, currentPrice);
            const dayChangePercent = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
            return { symbol: h.symbol, currency: h.currency, currentPrice, dayChangePercent };
        }).filter(m => Math.abs(m.dayChangePercent) > 0.001);

        const gainers = movers.filter(m => m.dayChangePercent > 0)
            .sort((a, b) => b.dayChangePercent - a.dayChangePercent).slice(0, 3);
        const losers = movers.filter(m => m.dayChangePercent < 0)
            .sort((a, b) => a.dayChangePercent - b.dayChangePercent).slice(0, 3);

        return { gainers, losers };
    }

    getMonthlyPerformanceSummary(targetCurrency = 'USD') {
        const stats = this.calculatePortfolio(targetCurrency);
        const today = new Date();
        const monthAgo = new Date(today);
        monthAgo.setDate(today.getDate() - 30);
        const monthAgoStr = Utils.getDateString(monthAgo);

        const movers = stats.holdings.map(h => {
            const currentPrice = h.currentPrice;
            const pastPrice = this.getPriceOnDate(h.symbol, monthAgoStr, currentPrice);
            const changePercent = pastPrice > 0 ? ((currentPrice - pastPrice) / pastPrice) * 100 : 0;
            return { symbol: h.symbol, changePercent, weightPercent: h.weightPercent };
        }).filter(m => Math.abs(m.changePercent) > 0.01);

        const topGainers = movers.filter(m => m.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 3);
        const topLosers = movers.filter(m => m.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 3);

        const timeline = this.getHistoricalTimeline('1M', 'PERF', targetCurrency);
        const portfolioPercent = (timeline && timeline.rangeStats && timeline.rangeStats['1M']) || 0;

        return { portfolioPercent, topGainers, topLosers };
    }

    // Estimation : pas de vrai calendrier de dividendes futurs disponible sans cle payante.
    // On projette la prochaine date a partir du dernier dividende verse + intervalle moyen constate.
    async getUpcomingDividends(targetCurrency = 'USD') {
        const stats = this.calculatePortfolio(targetCurrency);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const windowEnd = new Date(today);
        windowEnd.setDate(today.getDate() + 45);

        const results = [];
        for (const h of stats.holdings) {
            if (h.symbol.startsWith('$')) continue;

            const from = Utils.getDateString(new Date(today.getFullYear() - 2, today.getMonth(), today.getDate()));
            const to = Utils.getDateString(today);
            const events = await APIService.getDividends(h.symbol, from, to);
            if (events.length < 1) continue;

            const sorted = events.slice().sort((a, b) => a.date.localeCompare(b.date));
            const last = sorted[sorted.length - 1];

            let intervalDays = 91; // repli trimestriel si un seul versement connu
            if (sorted.length >= 2) {
                const prev = sorted[sorted.length - 2];
                intervalDays = Utils.daysBetween(Utils.parseDate(prev.date), Utils.parseDate(last.date));
            }

            const estDate = Utils.parseDate(last.date);
            estDate.setDate(estDate.getDate() + intervalDays);

            if (estDate >= today && estDate <= windowEnd) {
                const amountNative = h.qty * last.amountPerShare;
                results.push({
                    symbol: h.symbol,
                    estimatedDate: Utils.getDateString(estDate),
                    amount: this.convertCurrency(amountNative, h.currency, targetCurrency),
                    yieldPercent: h.currentPrice > 0 ? (last.amountPerShare / h.currentPrice) * 100 : 0
                });
            }
        }

        results.sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate));
        return results;
    }

    // Calendrier reel via Finnhub (actions US uniquement, gratuit).
    async getUpcomingEarnings() {
        const stats = this.calculatePortfolio('USD');
        const windowEnd = new Date();
        windowEnd.setDate(windowEnd.getDate() + 90);

        const results = [];
        for (const h of stats.holdings) {
            const data = await APIService.getEarnings(h.symbol);
            if (!data) continue;
            results.push({
                symbol: h.symbol,
                date: data.date,
                hour: data.hour,
                epsEstimate: data.epsEstimate,
                revenueEstimate: data.revenueEstimate
            });
        }

        results.sort((a, b) => a.date.localeCompare(b.date));
        return results;
    }

    computeProfitAsOf(dateStr, targetCurrency = 'USD') {
        const trades = this.getSortedTrades().filter(t => t.date <= dateStr);

        let realizedPnLUSD = 0, dividendsUSD = 0, feesUSD = 0, standaloneFeesUSD = 0;
        let depositsUSD = 0, withdrawalsUSD = 0, totalBuyUSD = 0;
        let runningNetContribUSD = 0, peakNetContribUSD = 0;
        let holdings = {};

        trades.forEach(trade => {
            const currency = Utils.getCurrency(trade.symbol);
            const toUSD = (val) => this.convertCurrency(val, currency, 'USD');

            switch (trade.type) {
                case 'DEPOSIT': {
                    const amtUSD = toUSD(trade.amount);
                    depositsUSD += amtUSD;
                    runningNetContribUSD += amtUSD;
                    peakNetContribUSD = Math.max(peakNetContribUSD, runningNetContribUSD);
                    break;
                }
                case 'WITHDRAWAL': {
                    const amtUSD = toUSD(trade.amount);
                    withdrawalsUSD += amtUSD;
                    runningNetContribUSD -= amtUSD;
                    break;
                }
                case 'BUY': {
                    const feeUSD = toUSD(trade.fees || 0);
                    const sharesCostUSD = toUSD(trade.qty * trade.price);
                    feesUSD += feeUSD;
                    totalBuyUSD += sharesCostUSD + feeUSD;
                    if (!holdings[trade.symbol]) holdings[trade.symbol] = { qty: 0, costUSD: 0 };
                    holdings[trade.symbol].qty += trade.qty;
                    holdings[trade.symbol].costUSD += sharesCostUSD;
                    break;
                }
                case 'SELL': {
                    const feeUSD = toUSD(trade.fees || 0);
                    const h = holdings[trade.symbol];
                    const sellQty = Math.min(trade.qty, h ? Math.max(0, h.qty) : 0);
                    if (sellQty > 0) {
                        const grossRevenueUSD = toUSD(sellQty * trade.price);
                        feesUSD += feeUSD;
                        const costSoldUSD = (h.costUSD / h.qty) * sellQty;
                        realizedPnLUSD += grossRevenueUSD - costSoldUSD;
                        h.qty -= sellQty;
                        h.costUSD -= costSoldUSD;
                        if (h.qty <= 0.00001) { h.qty = 0; h.costUSD = 0; }
                    }
                    break;
                }
                case 'DIVIDEND':
                    dividendsUSD += toUSD(trade.amount);
                    break;
                case 'FEE': {
                    const amtUSD = toUSD(trade.amount);
                    feesUSD += amtUSD;
                    standaloneFeesUSD += amtUSD;
                    break;
                }
            }
        });

        let holdingsValueUSD = 0, holdingsCostUSD = 0;
        Object.entries(holdings).forEach(([symbol, h]) => {
            if (h.qty <= 0.0001) return;
            const currency = Utils.getCurrency(symbol);
            const priceOnDay = this.getPriceOnDate(symbol, dateStr, h.costUSD / h.qty);
            holdingsValueUSD += this.convertCurrency(h.qty * priceOnDay, currency, 'USD');
            holdingsCostUSD += h.costUSD;
        });

        const unrealizedPnLUSD = holdingsValueUSD - holdingsCostUSD;
        const totalPnLUSD = unrealizedPnLUSD + realizedPnLUSD + dividendsUSD - feesUSD;
        const netInvestedUSD = peakNetContribUSD > 0
            ? peakNetContribUSD
            : (totalBuyUSD > 0 ? totalBuyUSD : 0);

        return {
            totalPnL: this.convertCurrency(totalPnLUSD, 'USD', targetCurrency),
            netInvested: this.convertCurrency(netInvestedUSD, 'USD', targetCurrency)
        };
    }

    getYearlyPerformance(targetCurrency = 'USD') {
        const firstTradeDate = this.getFirstTradeDate();
        if (!firstTradeDate) return { ytd: null, years: [] };

        const today = new Date();
        const todayStr = Utils.getDateString(today);
        const currentYear = today.getFullYear();
        const startYear = firstTradeDate.getFullYear();

        const profitAt = (dateStr) => this.computeProfitAsOf(dateStr, targetCurrency);

        const jan1Str = (y) => `${y}-01-01`;
        const dec31Str = (y) => `${y}-12-31`;

        const buildRow = (label, fromStr, toStr) => {
            const from = profitAt(fromStr);
            const to = profitAt(toStr);
            const profit = to.totalPnL - from.totalPnL;
            const basis = from.netInvested > 0 ? from.netInvested : to.netInvested;
            const percent = basis > 0 ? (profit / basis) * 100 : 0;
            return { label, profit, percent };
        };

        const ytdRow = buildRow('Depuis 1er Janvier', jan1Str(currentYear), todayStr);

        const years = [];
        for (let y = currentYear; y >= startYear; y--) {
            const fromStr = y === startYear ? '0000-01-01' : jan1Str(y);
            const toStr = y === currentYear ? todayStr : dec31Str(y);
            years.push(buildRow(String(y), fromStr, toStr));
        }

        return { ytd: ytdRow, years };
    }

    resolveRangeStart(range, today, firstTradeDate) {
        let start;
        if (range === 'ALL') {
            start = firstTradeDate ? new Date(firstTradeDate) : new Date(today);
            if (!firstTradeDate) start.setDate(today.getDate() - 30);
        } else if (range === 'YTD') {
            start = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
        } else if (range === '1M') {
            start = new Date(today); start.setDate(today.getDate() - 30);
        } else if (range === '3M') {
            start = new Date(today); start.setDate(today.getDate() - 90);
        } else if (range === '6M') {
            start = new Date(today); start.setDate(today.getDate() - 180);
        } else if (range === '1Y') {
            start = new Date(today); start.setDate(today.getDate() - 365);
        } else {
            start = new Date(today); start.setDate(today.getDate() - 90);
        }
        start.setHours(0, 0, 0, 0);
        return start;
    }

    // Calcule la serie quotidienne complete (depuis la 1ere transaction jusqu'a aujourd'hui) une seule
    // fois. Les badges de periode (rangeStats/profitRangeStats) sont TOUJOURS calcules sur cette serie
    // complete, independamment de la fenetre actuellement affichee dans le graphe (`range`), pour que
    // leurs valeurs ne changent jamais quand l'utilisateur clique sur un autre bouton de periode.
    getHistoricalTimeline(range = 'ALL', mode = 'VALUE', targetCurrency = 'USD') {
        const sortedTrades = this.getSortedTrades();
        const firstTradeDate = this.getFirstTradeDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const fullStartDate = this.resolveRangeStart('ALL', today, firstTradeDate);
        const fullTotalDays = Math.max(1, Utils.daysBetween(fullStartDate, today));

        const fullLabels = [];
        const fullRawDates = [];
        const fullValues = [];
        const fullPerfValues = [];
        const fullProfitValues = [];

        for (let i = 0; i <= fullTotalDays; i++) {
            const currDate = new Date(fullStartDate);
            currDate.setDate(fullStartDate.getDate() + i);
            currDate.setHours(0, 0, 0, 0);
            const dateStr = Utils.getDateString(currDate);

            const tradesUpToDate = sortedTrades.filter(t => t.date <= dateStr);
            let dayHoldings = {};

            tradesUpToDate.forEach(trade => {
                const currency = Utils.getCurrency(trade.symbol);
                const toUSD = (v) => this.convertCurrency(v, currency, 'USD');

                if (trade.type === 'BUY') {
                    if (!dayHoldings[trade.symbol]) {
                        dayHoldings[trade.symbol] = { qty: 0, costUSD: 0, buyPrice: trade.price };
                    }
                    dayHoldings[trade.symbol].qty += trade.qty;
                    dayHoldings[trade.symbol].costUSD += toUSD(trade.qty * trade.price);
                } else if (trade.type === 'SELL') {
                    if (dayHoldings[trade.symbol]) {
                        const h = dayHoldings[trade.symbol];
                        const costSold = h.qty > 0 ? (h.costUSD / h.qty) * trade.qty : 0;
                        h.qty -= trade.qty;
                        h.costUSD -= costSold;
                        if (h.qty <= 0.00001) {
                            h.qty = 0;
                            h.costUSD = 0;
                        }
                    }
                }
            });

            let dayHoldingsValueUSD = 0;
            let dayHoldingsCostUSD = 0;

            Object.entries(dayHoldings).forEach(([symbol, h]) => {
                if (h.qty > 0.0001) {
                    const priceOnDay = this.getPriceOnDate(symbol, dateStr, h.buyPrice);
                    const currency = Utils.getCurrency(symbol);
                    const valUSD = this.convertCurrency(h.qty * priceOnDay, currency, 'USD');
                    dayHoldingsValueUSD += valUSD;
                    dayHoldingsCostUSD += h.costUSD;
                }
            });

            const dayStockValueTarget = this.convertCurrency(dayHoldingsValueUSD, 'USD', targetCurrency);

            fullLabels.push(Utils.formatDateShort(dateStr));
            fullRawDates.push(dateStr);
            fullValues.push(dayStockValueTarget);

            const perfPct = dayHoldingsCostUSD > 0
                ? ((dayHoldingsValueUSD - dayHoldingsCostUSD) / dayHoldingsCostUSD) * 100
                : 0;
            fullPerfValues.push(perfPct);

            fullProfitValues.push(this.computeProfitAsOf(dateStr, targetCurrency).totalPnL);
        }

        // Recherche directe sur les dates de la serie plutot qu'un calcul arithmetique sur totalDays :
        // totalDays est artificiellement gonfle d'un jour (Math.max(1, ...) plus haut) quand tout
        // l'historique tient sur une seule journee, ce qui decale les index si on les recalcule par
        // soustraction de jours. Chercher la date directement dans fullRawDates est fiable dans tous les cas.
        const indexFromDate = (date) => {
            const dStr = Utils.getDateString(date);
            const idx = fullRawDates.findIndex(d => d >= dStr);
            return idx === -1 ? fullRawDates.length - 1 : idx;
        };

        const rangeStats = {};
        const valueRangeStats = {};
        const profitRangeStats = {};
        const ranges = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

        ranges.forEach(r => {
            const rStart = this.resolveRangeStart(r, today, firstTradeDate);
            const rStartIndex = r === 'ALL' ? 0 : indexFromDate(rStart);
            const startVal = fullValues[rStartIndex] || 0;
            const endVal = fullValues[fullValues.length - 1] || 0;

            // Badge "Performance" : variation (en points de %) de la meme serie base-cout que
            // la courbe PERF (fullPerfValues), pas la variation de valeur de marche.
            const perfStart = fullPerfValues[rStartIndex] || 0;
            const perfEnd = fullPerfValues[fullPerfValues.length - 1] || 0;
            rangeStats[r] = perfEnd - perfStart;
            valueRangeStats[r] = endVal - startVal;

            const profitStartVal = fullProfitValues[rStartIndex] || 0;
            const profitEndVal = fullProfitValues[fullProfitValues.length - 1] || 0;
            profitRangeStats[r] = profitEndVal - profitStartVal;
        });

        // Fenetre affichee dans le graphe : simple decoupe de la serie complete deja calculee.
        let displayStartDate = this.resolveRangeStart(range, today, firstTradeDate);
        if (displayStartDate < fullStartDate) displayStartDate = fullStartDate;
        const sliceStartIndex = range === 'ALL' ? 0 : indexFromDate(displayStartDate);

        return {
            labels: fullLabels.slice(sliceStartIndex),
            rawDates: fullRawDates.slice(sliceStartIndex),
            values: fullValues.slice(sliceStartIndex),
            perfValues: fullPerfValues.slice(sliceStartIndex),
            profitValues: fullProfitValues.slice(sliceStartIndex),
            rangeStats,
            valueRangeStats,
            profitRangeStats
        };
    }
}

// --- UI & CONTROLLER ---
const App = {
    service: new PortfolioService(),
    chart: null,
    chartState: {
        mode: 'VALUE',
        range: 'ALL',
        benchmarks: [],
        currency: 'EUR',
        perfFilter: 'all',
        profitRange: 'ALL',
        researchRange: '1Y'
    },
    researchChart: null,
    researchSymbol: null,

    applyTheme(theme) {
        const t = theme === 'light' ? 'light' : 'dark';
        if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
        else document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem(CONFIG.THEME_STORAGE, t); } catch (e) { /* ignore */ }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5f7' : '#0a0b0e');
        document.querySelectorAll('#themeSegmented .theme-seg-btn').forEach(b => {
            b.setAttribute('aria-checked', b.dataset.themeChoice === t ? 'true' : 'false');
        });
    },

    initTheme() {
        let saved = 'dark';
        try { saved = localStorage.getItem(CONFIG.THEME_STORAGE) || 'dark'; } catch (e) { /* ignore */ }
        this.applyTheme(saved);
        const seg = document.getElementById('themeSegmented');
        if (seg && !seg._bound) {
            seg._bound = true;
            seg.querySelectorAll('.theme-seg-btn').forEach(btn => {
                btn.onclick = () => this.applyTheme(btn.dataset.themeChoice);
            });
        }
    },

    initSideNav() {
        const cont = document.getElementById('appContainer');
        const toggle = document.getElementById('sideToggleBtn');
        if (!cont) return;
        let open = true;
        try { open = localStorage.getItem(CONFIG.SIDE_STORAGE) !== 'collapsed'; } catch (e) { /* ignore */ }
        const apply = () => {
            cont.setAttribute('data-side', open ? 'open' : 'collapsed');
            if (toggle) toggle.setAttribute('aria-expanded', String(open));
        };
        apply();
        if (toggle && !toggle._bound) {
            toggle._bound = true;
            toggle.onclick = () => {
                open = !open;
                try { localStorage.setItem(CONFIG.SIDE_STORAGE, open ? 'open' : 'collapsed'); } catch (e) { /* ignore */ }
                apply();
                [this.chart, this.profitChart, this.assetChart, this.classChart, this.currencyChart, this.sectorChart]
                    .forEach(c => c && setTimeout(() => c.resize(), 220));
            };
        }
        const dsearch = document.getElementById('desktopSearchBtn');
        if (dsearch && !dsearch._bound) {
            dsearch._bound = true;
            dsearch.onclick = () => {
                const addBtn = document.getElementById('addTransactionBtn');
                if (addBtn) addBtn.click();
                setTimeout(() => {
                    const si = document.getElementById('symbolInputField');
                    if (si) si.click();
                }, 60);
            };
        }
    },

    async init() {
        lucide.createIcons();
        this.initTheme();
        this.initSideNav();
        const isRecovery = /type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search);
        this.setupAuthScreen(isRecovery);
        this.setupLandingScreen();

        if (isRecovery) {
            this.showAuthScreen();
            return;
        }

        const session = await AuthService.getSession();
        if (session) {
            await this.startApp();
        } else {
            this.showLandingScreen();
        }
    },

    setupLandingScreen() {
        const setAuthMode = (targetTitle) => {
            this.showAuthScreen();
            const authTitle = document.getElementById('authTitle');
            const authToggleBtn = document.getElementById('authToggleBtn');
            let guard = 0;
            while (authTitle.textContent !== targetTitle && guard < 3) {
                authToggleBtn.click();
                guard++;
            }
        };
        document.getElementById('landingLoginBtn').onclick = () => setAuthMode('Connexion');
        document.getElementById('landingLoginBtn2').onclick = () => setAuthMode('Connexion');
        document.getElementById('landingSignupBtn').onclick = () => setAuthMode('Créer un compte');
        document.getElementById('landingSignupBtn2').onclick = () => setAuthMode('Créer un compte');
        const backBtn = document.getElementById('authBackBtn');
        if (backBtn) backBtn.onclick = () => this.showLandingScreen();
    },

    showLandingScreen() {
        document.getElementById('landingScreen').style.display = 'block';
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('appContainer').style.display = 'none';
    },

    showAuthScreen() {
        document.getElementById('landingScreen').style.display = 'none';
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
    },

    async startApp() {
        document.getElementById('landingScreen').style.display = 'none';
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('appContainer').style.display = '';
        document.getElementById('appContainer').classList.add('app-loading');

        const savedCurrency = localStorage.getItem(CONFIG.CURRENCY_STORAGE) || 'EUR';
        this.chartState.currency = savedCurrency;

        try {
            await this.service.load();
        } catch (err) {
            if (isJwtTimingError(err)) {
                await AuthService.signOut().catch(() => {});
                alert("Session invalide : l'horloge de ton appareil est (ou était) désynchronisée. "
                    + "Vérifie que la date et l'heure sont réglées automatiquement, puis reconnecte-toi.");
            } else {
                alert('Erreur de chargement des données : ' + err.message);
            }
            this.showAuthScreen();
            return;
        }

        if (!this._listenersReady) {
            this.setupEventListeners();
            this.initChart();
            this.initAnalysisCharts();
            this.initProfitChart();
            this.initResearch();
            window.addEventListener('portfolio-updated', () => {
                this.render();
                this.refreshUpcomingDividends();
                this.refreshUpcomingEarnings();
                this.refreshPortfolioInsights();
            });
            this._listenersReady = true;
        }

        this.service.refreshPrices();
    },

    setupAuthScreen(startInRecovery = false) {
        const authForm = document.getElementById('authForm');
        const authTitle = document.getElementById('authTitle');
        const authSubmitBtn = document.getElementById('authSubmitBtn');
        const authToggleBtn = document.getElementById('authToggleBtn');
        const authForgotBtn = document.getElementById('authForgotBtn');
        const authError = document.getElementById('authError');
        const authInfo = document.getElementById('authInfo');
        const emailGroup = document.getElementById('authEmailGroup');
        const passwordGroup = document.getElementById('authPasswordGroup');
        const emailInput = authForm.querySelector('input[name="email"]');
        const passwordInput = authForm.querySelector('input[name="password"]');
        let mode = startInRecovery ? 'recovery' : 'signin';

        const applyMode = () => {
            authError.style.display = 'none';
            authInfo.style.display = 'none';
            emailGroup.style.display = mode === 'recovery' ? 'none' : '';
            passwordGroup.style.display = mode === 'reset' ? 'none' : '';
            emailInput.required = mode !== 'recovery';
            passwordInput.required = mode !== 'reset';
            authForgotBtn.style.display = mode === 'signin' ? '' : 'none';
            authToggleBtn.style.display = mode === 'recovery' ? 'none' : '';

            if (mode === 'signin') {
                authTitle.textContent = 'Connexion';
                authSubmitBtn.textContent = 'Se connecter';
                authToggleBtn.textContent = 'Pas encore de compte ? Créer un compte';
            } else if (mode === 'signup') {
                authTitle.textContent = 'Créer un compte';
                authSubmitBtn.textContent = "S'inscrire";
                authToggleBtn.textContent = 'Déjà un compte ? Se connecter';
            } else if (mode === 'reset') {
                authTitle.textContent = 'Mot de passe oublié';
                authSubmitBtn.textContent = 'Envoyer le lien';
                authToggleBtn.textContent = 'Retour à la connexion';
            } else if (mode === 'recovery') {
                authTitle.textContent = 'Nouveau mot de passe';
                authSubmitBtn.textContent = 'Mettre à jour le mot de passe';
            }
        };

        authToggleBtn.onclick = () => {
            mode = mode === 'signin' ? 'signup' : (mode === 'reset' ? 'signin' : 'signin');
            applyMode();
        };

        authForgotBtn.onclick = () => {
            mode = 'reset';
            applyMode();
        };

        authForm.onsubmit = async (e) => {
            e.preventDefault();
            authError.style.display = 'none';
            authInfo.style.display = 'none';
            const fd = new FormData(authForm);
            const email = fd.get('email');
            const password = fd.get('password');

            try {
                if (mode === 'signin') {
                    await AuthService.signIn(email, password);
                    await this.startApp();
                } else if (mode === 'signup') {
                    const data = await AuthService.signUp(email, password);
                    if (data.session) {
                        await this.startApp();
                    } else {
                        alert('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.');
                        mode = 'signin';
                        applyMode();
                        authForm.reset();
                    }
                } else if (mode === 'reset') {
                    await AuthService.resetPasswordForEmail(email);
                    authInfo.textContent = 'Email envoyé ! Vérifie ta boîte mail pour réinitialiser ton mot de passe.';
                    authInfo.style.display = 'block';
                } else if (mode === 'recovery') {
                    await AuthService.updatePassword(password);
                    mode = 'signin';
                    applyMode();
                    authForm.reset();
                    alert('Mot de passe mis à jour ! Tu peux te reconnecter.');
                }
            } catch (err) {
                authError.textContent = err.message;
                authError.style.display = 'block';
            }
        };

        applyMode();
    },

    setupEventListeners() {
        // --- REPLIS SANS HANDLERS INLINE (compat CSP stricte) ---
        // Image cassée : masquer et, si demandé, afficher le monogramme voisin.
        // Les évènements `error` ne bouillonnent pas -> écoute en phase de capture.
        document.addEventListener('error', (e) => {
            const img = e.target;
            if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
            if (img.dataset.fallback === 'hide') {
                img.style.visibility = 'hidden';
            } else if (img.dataset.fallback === 'sibling') {
                img.style.display = 'none';
                if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
            }
        }, true);

        // Bulles d'aide : bascule l'ancrage au dernier moment pour que le texte
        // reste dans la carte (les colonnes de droite déborderaient sinon).
        const placeTip = (e) => {
            const el = e.target.closest && e.target.closest('.kv-help');
            if (el) this._placeTip(el);
        };
        document.addEventListener('pointerover', placeTip);
        document.addEventListener('focusin', placeTip);

        // Boutons « Afficher plus / moins » des insights (markup injecté par innerHTML).
        document.addEventListener('click', (e) => {
            const sumBtn = e.target.closest('.insights-summary-toggle');
            if (sumBtn) {
                const clamped = sumBtn.previousElementSibling.classList.toggle('is-clamped');
                sumBtn.textContent = clamped ? 'Afficher plus' : 'Afficher moins';
                return;
            }
            const grpBtn = e.target.closest('.insights-toggle-btn');
            if (grpBtn) {
                const more = grpBtn.parentElement.querySelector('.insights-more');
                if (!more) return;
                const expanded = more.style.display !== 'none';
                more.style.display = expanded ? 'none' : 'block';
                grpBtn.textContent = expanded ? 'Afficher plus' : 'Afficher moins';
            }
        });

        // --- STATS CAROUSEL DOTS (mobile) ---
        const statsGrid = document.getElementById('statsGrid');
        const statsDots = document.getElementById('statsDots');
        if (statsGrid && statsDots) {
            const dots = statsDots.querySelectorAll('.dot');
            statsGrid.addEventListener('scroll', () => {
                const card = statsGrid.querySelector('.stat-card');
                const step = card ? card.offsetWidth + 12 : statsGrid.clientWidth || 1;
                const idx = Math.max(0, Math.min(dots.length - 1, Math.round(statsGrid.scrollLeft / step)));
                dots.forEach((d, i) => d.classList.toggle('active', i === idx));
            }, { passive: true });
        }

        // --- PORTFOLIO SWITCHER DROPDOWN ---
        const switcherContainer = document.getElementById('portfolioDropdownContainer');
        const switcherBtn = document.getElementById('portfolioSwitcherBtn');
        const openCreateBtn = document.getElementById('openCreatePortfolioBtn');
        const portfolioModal = document.getElementById('portfolioModal');
        const closePortfolioModalBtn = document.getElementById('closePortfolioModalBtn');
        const portfolioForm = document.getElementById('portfolioForm');
        const portfolioModalTitle = document.getElementById('portfolioModalTitle');

        if (switcherBtn && switcherContainer) {
            switcherBtn.onclick = (e) => {
                e.stopPropagation();
                switcherContainer.classList.toggle('open');
            };

            document.addEventListener('click', (e) => {
                if (!switcherContainer.contains(e.target)) {
                    switcherContainer.classList.remove('open');
                }
            });
        }

        // Global Portfolio Option Click
        const globalItem = document.getElementById('globalPortfolioItem');
        if (globalItem) {
            globalItem.onclick = () => {
                this.service.setActivePortfolio('GLOBAL');
                switcherContainer.classList.remove('open');
            };
        }

        // Open Create Portfolio Modal
        if (openCreateBtn) {
            openCreateBtn.onclick = () => {
                switcherContainer.classList.remove('open');
                portfolioModalTitle.textContent = 'Nouveau Portefeuille';
                portfolioForm.reset();
                document.getElementById('portfolioEditId').value = '';
                document.getElementById('portfolioSubmitBtn').textContent = 'Créer le portefeuille';
                portfolioModal.classList.add('open');
                document.getElementById('portfolioNameInput').focus();
            };
        }

        if (closePortfolioModalBtn) {
            closePortfolioModalBtn.onclick = () => portfolioModal.classList.remove('open');
        }

        // Portfolio Form Submit (Create or Edit)
        if (portfolioForm) {
            portfolioForm.onsubmit = async (e) => {
                e.preventDefault();
                const fd = new FormData(portfolioForm);
                const editId = fd.get('portfolioEditId');
                const name = fd.get('portfolioName');
                const color = fd.get('portfolioColor');
                const icon = fd.get('portfolioIcon') || '';

                try {
                    if (editId) {
                        await this.service.renamePortfolio(editId, name, color);
                        Utils.setPortfolioIconOverride(editId, icon);
                    } else {
                        const created = await this.service.createPortfolio(name, color);
                        Utils.setPortfolioIconOverride(created.id, icon);
                    }
                } catch (err) {
                    alert('Erreur : ' + err.message);
                    return;
                }
                this.renderPortfolioSwitcher();

                portfolioModal.classList.remove('open');
                portfolioForm.reset();
            };
        }

        // SETTINGS MODAL
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettings = document.getElementById('closeSettingsBtn');
        const reloadPricesBtn = document.getElementById('reloadPricesBtn');
        const syncDividendsBtn = document.getElementById('syncDividendsBtn');
        const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
        const exportCsvBtn = document.getElementById('exportCsvBtn');
        const importCsvBtn = document.getElementById('importCsvBtn');
        const importCsvInput = document.getElementById('importCsvInput');
        const logoutBtn = document.getElementById('logoutBtn');

        if (settingsBtn && settingsModal) {
            settingsBtn.onclick = () => settingsModal.classList.add('open');
            closeSettings.onclick = () => settingsModal.classList.remove('open');
        }
        if (reloadPricesBtn) {
            reloadPricesBtn.onclick = () => {
                settingsModal.classList.remove('open');
                this.service.refreshPrices();
            };
        }
        const refreshDataBtn = document.getElementById('refreshDataBtn');
        if (refreshDataBtn) {
            refreshDataBtn.onclick = async () => {
                if (refreshDataBtn.classList.contains('is-loading')) return;
                refreshDataBtn.classList.add('is-loading');
                refreshDataBtn.disabled = true;
                try {
                    await this.service.refreshPrices();
                } catch (err) {
                    alert('Erreur de rafraîchissement : ' + err.message);
                } finally {
                    refreshDataBtn.classList.remove('is-loading');
                    refreshDataBtn.disabled = false;
                }
            };
        }
        if (syncDividendsBtn) {
            syncDividendsBtn.onclick = async () => {
                syncDividendsBtn.textContent = 'Synchronisation...';
                syncDividendsBtn.disabled = true;
                try {
                    const added = await this.service.syncDividends();
                    alert(added > 0 ? `${added} dividende(s) ajouté(s).` : 'Aucun nouveau dividende.');
                } catch (err) {
                    alert('Erreur : ' + err.message);
                } finally {
                    syncDividendsBtn.textContent = 'Synchroniser les dividendes';
                    syncDividendsBtn.disabled = false;
                    settingsModal.classList.remove('open');
                }
            };
        }
        if (exportCsvBtn) {
            exportCsvBtn.onclick = () => {
                this.downloadCSV(`portefeuille_${Utils.getDateString()}.csv`, this.service.exportToCSV());
            };
        }
        if (downloadTemplateBtn) {
            downloadTemplateBtn.onclick = () => {
                const headers = ['date', 'type', 'symbol', 'qty', 'price', 'currency', 'fees', 'amount', 'portfolio'];
                const rows = [
                    ['2026-01-15', 'BUY', 'AAPL', '10', '185,50', 'USD', '5', '', 'Portefeuille Principal'],
                    ['2026-02-10', 'BUY', 'MC.PA', '5', '720', 'EUR', '3,5', '', 'Portefeuille Principal'],
                    ['2026-03-05', 'SELL', 'AAPL', '4', '195,20', 'USD', '5', '', 'Portefeuille Principal'],
                    ['2026-01-01', 'DEPOSIT', '', '', '', '', '', '2000', 'Portefeuille Principal'],
                    ['2026-04-01', 'WITHDRAWAL', '', '', '', '', '', '500', 'Portefeuille Principal'],
                    ['2026-02-20', 'DIVIDEND', 'AAPL', '', '', '', '', '12,34', 'Portefeuille Principal'],
                    ['2026-01-20', 'FEE', '', '', '', '', '', '9,99', 'Portefeuille Principal']
                ];
                const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
                this.downloadCSV('modele_import_transactions.csv', csv);
            };
        }
        if (importCsvBtn && importCsvInput) {
            importCsvBtn.onclick = () => importCsvInput.click();
            importCsvInput.onchange = async () => {
                const file = importCsvInput.files[0];
                if (!file) return;
                const text = await file.text();
                importCsvInput.value = '';

                try {
                    const { added, errors } = await this.service.importFromCSV(text);
                    let msg = `${added} transaction(s) importée(s).`;
                    if (errors.length) msg += `\n${errors.length} erreur(s) :\n` + errors.slice(0, 10).join('\n');
                    alert(msg);
                } catch (err) {
                    alert('Erreur import : ' + err.message);
                } finally {
                    settingsModal.classList.remove('open');
                }
            };
        }
        if (logoutBtn) {
            logoutBtn.onclick = async () => {
                await AuthService.signOut();
                location.reload();
            };
        }

        // Fournisseur IA (résumé IA) : lié au compte. La clé API est chiffrée et
        // stockée côté worker (POST /ai/key) et n'est jamais rechargée ici ; le
        // champ affiche seulement si une clé est déjà enregistrée.
        const aiProviderSelect = document.getElementById('aiProviderSelect');
        const aiKeyInput = document.getElementById('aiKeyInput');
        const saveAiKeyBtn = document.getElementById('saveAiKeyBtn');
        const clearAiKeyBtn = document.getElementById('clearAiKeyBtn');

        const refreshAiKeyInputForProvider = () => {
            if (!aiProviderSelect || !aiKeyInput) return;
            const p = aiProviderSelect.value;
            const configured = p && (this.service.aiConfigured || []).includes(p);
            aiKeyInput.value = '';
            aiKeyInput.placeholder = !p ? 'Clé API'
                : configured ? '•••••••••• (clé enregistrée — saisir pour remplacer)'
                    : (AI_PROVIDERS[p] ? AI_PROVIDERS[p].keyPlaceholder : 'Clé API');
            aiKeyInput.disabled = !p;
            if (clearAiKeyBtn) clearAiKeyBtn.disabled = !configured;
        };

        if (aiProviderSelect) {
            aiProviderSelect.value = this.service.aiProvider || '';
            refreshAiKeyInputForProvider();
            aiProviderSelect.onchange = async () => {
                refreshAiKeyInputForProvider();
                localStorage.removeItem(CONFIG.INSIGHTS_CACHE_STORAGE);
                try {
                    await this.service.setAiProvider(aiProviderSelect.value);
                } catch (e) {
                    alert('Impossible d\'enregistrer le fournisseur sur le compte : ' + (e.message || e));
                }
            };
        }
        if (saveAiKeyBtn) {
            saveAiKeyBtn.onclick = async () => {
                const p = aiProviderSelect.value;
                if (!p) { alert('Choisis un fournisseur IA.'); return; }
                const key = aiKeyInput.value.trim();
                if (!key) { alert('Saisis une clé API.'); return; }
                saveAiKeyBtn.disabled = true;
                try {
                    await this.service.saveAiKey(p, key);
                    localStorage.removeItem(CONFIG.INSIGHTS_CACHE_STORAGE);
                    settingsModal.classList.remove('open');
                    this.refreshPortfolioInsights(true);
                } catch (e) {
                    alert('Enregistrement de la clé échoué : ' + (e.message || e));
                } finally {
                    saveAiKeyBtn.disabled = false;
                    refreshAiKeyInputForProvider();
                }
            };
        }
        if (clearAiKeyBtn) {
            clearAiKeyBtn.onclick = async () => {
                const p = aiProviderSelect.value;
                if (!p) return;
                try {
                    await this.service.removeAiKey(p);
                    localStorage.removeItem(CONFIG.INSIGHTS_CACHE_STORAGE);
                    settingsModal.classList.remove('open');
                    this.refreshPortfolioInsights(true);
                } catch (e) {
                    alert('Suppression de la clé échouée : ' + (e.message || e));
                } finally {
                    refreshAiKeyInputForProvider();
                }
            };
        }

        // Résumé du portefeuille
        const refreshInsightsBtn = document.getElementById('refreshInsightsBtn');
        if (refreshInsightsBtn) {
            refreshInsightsBtn.onclick = () => this.refreshPortfolioInsights(true);
        }

        // ADD TRANSACTION MODAL & DYNAMIC FORM
        const modal = document.getElementById('transactionModal');
        const openBtn = document.getElementById('addTransactionBtn');
        const closeBtn = document.getElementById('closeModalBtn');
        const form = document.getElementById('transactionForm');
        const modalTitle = document.getElementById('transactionModalTitle');
        if (form.elements['date']) form.elements['date'].max = Utils.getDateString();

        const symbolGroup = document.getElementById('symbolGroup');
        const symbolInput = document.getElementById('symbolInputField');
        const qtyPriceRow = document.getElementById('qtyPriceRow');
        const qtyInput = document.getElementById('qtyInputField');
        const priceInput = document.getElementById('priceInputField');
        const amountGroup = document.getElementById('amountGroup');
        const amountInput = document.getElementById('amountInputField');
        const amountLabel = document.getElementById('amountLabel');
        const priceCurrencyGroup = document.getElementById('priceCurrencyGroup');
        const priceCurrencyField = document.getElementById('priceCurrencyField');
        const feesGroup = document.getElementById('feesGroup');
        const feesInput = document.getElementById('feesInputField');

        const updateFormFieldsForType = (type) => {
            if (type === 'DEPOSIT' || type === 'WITHDRAWAL') {
                symbolGroup.style.display = 'none';
                symbolInput.removeAttribute('required');
                symbolInput.value = '$CASH';

                qtyPriceRow.style.display = 'none';
                qtyInput.removeAttribute('required');
                priceInput.removeAttribute('required');
                priceCurrencyGroup.style.display = 'none';
                feesGroup.style.display = 'none';

                amountGroup.style.display = 'block';
                amountInput.setAttribute('required', 'true');
                amountLabel.textContent = type === 'DEPOSIT' ? 'Montant du dépôt ($)' : 'Montant du retrait ($)';
            } else if (type === 'DIVIDEND' || type === 'FEE') {
                symbolGroup.style.display = 'block';
                symbolInput.removeAttribute('required');
                symbolInput.placeholder = type === 'DIVIDEND' ? 'Symbole concerné (ex: AAPL)' : 'Frais de courtage';

                qtyPriceRow.style.display = 'none';
                qtyInput.removeAttribute('required');
                priceInput.removeAttribute('required');
                priceCurrencyGroup.style.display = 'none';
                feesGroup.style.display = 'none';

                amountGroup.style.display = 'block';
                amountInput.setAttribute('required', 'true');
                amountLabel.textContent = type === 'DIVIDEND' ? 'Montant du dividende net ($)' : 'Montant des frais ($)';
            } else {
                symbolGroup.style.display = 'block';
                symbolInput.setAttribute('required', 'true');
                symbolInput.placeholder = 'Rechercher (ex: AAPL, MC.PA...)';

                qtyPriceRow.style.display = 'grid';
                qtyInput.setAttribute('required', 'true');
                priceInput.setAttribute('required', 'true');
                priceCurrencyGroup.style.display = 'block';
                feesGroup.style.display = 'block';

                amountGroup.style.display = 'none';
                amountInput.removeAttribute('required');
            }
        };

        form.querySelectorAll('input[name="type"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                updateFormFieldsForType(e.target.value);
            });
        });

        this.editingTradeId = null;

        const openTransactionModal = () => {
            this.editingTradeId = null;
            modalTitle.textContent = 'Nouvelle Transaction';
            form.reset();
            form.elements['date'].value = Utils.getDateString();
            form.elements['type'].value = 'BUY';
            updateFormFieldsForType('BUY');

            // Select active portfolio in dropdown if not global
            const portSelect = document.getElementById('targetPortfolioSelect');
            if (portSelect && this.service.activePortfolioId !== 'GLOBAL') {
                portSelect.value = this.service.activePortfolioId;
            }

            modal.classList.add('open');
        };
        openBtn.onclick = openTransactionModal;
        const openBtnFab = document.getElementById('addTransactionFab');
        if (openBtnFab) openBtnFab.onclick = openTransactionModal;
        const emptyAddBtn = document.getElementById('emptyAddBtn');
        if (emptyAddBtn) emptyAddBtn.onclick = openTransactionModal;
        const emptyImportBtn = document.getElementById('emptyImportBtn');
        if (emptyImportBtn) emptyImportBtn.onclick = () => {
            const inp = document.getElementById('importCsvInput');
            if (inp) inp.click();
        };

        closeBtn.onclick = () => modal.classList.remove('open');

        form.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const type = fd.get('type');
            const dateValue = fd.get('date');
            const symbol = fd.get('symbol') || '$CASH';

            let price = parseFloat(fd.get('price')) || 0;
            let fees = parseFloat(fd.get('fees')) || 0;
            let amount = parseFloat(fd.get('amount')) || 0;
            if (type === 'BUY' || type === 'SELL') {
                const enteredCurrency = fd.get('priceCurrency') || Utils.getCurrency(symbol);
                const nativeCurrency = Utils.getCurrency(symbol);
                if (enteredCurrency !== nativeCurrency) {
                    price = this.service.convertCurrency(price, enteredCurrency, nativeCurrency);
                    fees = this.service.convertCurrency(fees, enteredCurrency, nativeCurrency);
                }
            } else if (type === 'DIVIDEND' && symbol && !symbol.startsWith('$')) {
                // Le montant est saisi en USD (libelle du champ) : on le stocke dans la devise
                // native du titre, comme la synchro auto, pour que le moteur (toUSD) soit coherent.
                const nativeCurrency = Utils.getCurrency(symbol);
                if (nativeCurrency !== 'USD') {
                    amount = this.service.convertCurrency(amount, 'USD', nativeCurrency);
                }
            }

            // En edition : conserve le taux de change fige a l'origine si la devise du
            // titre n'a pas change (sinon on laisse normalizeTradeInput reprendre le spot).
            let carriedFxRate;
            if (this.editingTradeId) {
                const prev = this.service.trades.find(t => t.id === this.editingTradeId);
                if (prev && prev.fxRate > 0 && Utils.getCurrency(prev.symbol) === Utils.getCurrency(symbol)) {
                    carriedFxRate = prev.fxRate;
                }
            }

            const payload = {
                portfolioId: fd.get('portfolioId'),
                type,
                symbol,
                qty: fd.get('qty') || amount || 0,
                price: price || 1,
                amount: amount || 0,
                fees,
                fxRate: carriedFxRate,
                date: dateValue ? Utils.getDateString(dateValue) : Utils.getDateString()
            };

            try {
                if (this.editingTradeId) {
                    await this.service.updateTrade(this.editingTradeId, payload);
                } else {
                    await this.service.addTrade(payload);
                }
            } catch (err) {
                alert('Erreur : ' + err.message);
                return;
            }

            this.editingTradeId = null;
            modal.classList.remove('open');
            form.reset();
        };

        // SYMBOL SEARCH MODAL
        const searchModal = document.getElementById('symbolSearchModal');
        const closeSearchBtn = document.getElementById('closeSearchBtn');
        const searchInput = document.getElementById('globalSearchInput');
        const resultsList = document.getElementById('searchResultsList');

        symbolInput.addEventListener('blur', () => {
            if (symbolInput.value.trim()) {
                priceCurrencyField.value = Utils.getCurrency(symbolInput.value.trim());
            }
        });

        symbolInput.addEventListener('click', () => {
            const currentType = form.elements['type'].value;
            if (currentType === 'BUY' || currentType === 'SELL' || currentType === 'DIVIDEND') {
                searchModal.classList.add('open');
                searchInput.value = '';
                searchInput.focus();
                resultsList.innerHTML = '<div class="search-placeholder">Commencez à taper un symbole ou nom d\'entreprise...</div>';
            }
        });

        closeSearchBtn.onclick = () => searchModal.classList.remove('open');

        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 1) return;

            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                resultsList.innerHTML = '<div class="search-placeholder">Recherche en cours...</div>';
                const results = await APIService.searchSymbol(query);
                renderSearchResults(results);
            }, 250);
        });

        const renderSearchResults = (results) => {
            resultsList.innerHTML = '';
            if (!results || results.length === 0) {
                resultsList.innerHTML = '<div class="search-placeholder">Aucun résultat trouvé</div>';
                return;
            }

            results.forEach(item => {
                const sym = item.displaySymbol || item.symbol;
                const row = document.createElement('div');
                row.className = 'search-result-row';

                const isCrypto = (item.type || '').toLowerCase().includes('crypto') || sym.includes('BTC') || sym.includes('ETH');
                const badgeColor = isCrypto ? '#e5e7eb' : '#dbeafe';
                const exchangeName = Utils.getExchangeName(sym);

                row.innerHTML = `
                    <div class="result-left">
                        <img class="result-logo" src="${this.getLogoUrl(sym)}" alt=""
                            data-fallback="sibling">
                        <div class="result-icon" style="display:none;">${sym.substring(0, 1)}</div>
                        <div class="result-info">
                            <span class="result-symbol">${sym}</span>
                            <span class="result-desc">${item.description || sym}</span>
                        </div>
                    </div>
                    <div class="result-right">
                        <span class="type-badge" style="background:${badgeColor}">${item.type || 'ACTION'}</span>
                        <span>${exchangeName}</span>
                    </div>
                `;

                row.onclick = async () => {
                    symbolInput.value = sym;
                    searchModal.classList.remove('open');
                    priceCurrencyField.value = Utils.getCurrency(sym);

                    const livePrice = await APIService.getCurrentPrice(sym);
                    priceInput.value = livePrice.toFixed(2);
                };

                resultsList.appendChild(row);
            });
        };

        // Currency Toggle
        const currencyToggle = document.getElementById('currencyToggle');
        if (currencyToggle) {
            currencyToggle.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.onclick = () => {
                    currencyToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.chartState.currency = btn.dataset.currency || 'USD';
                    localStorage.setItem(CONFIG.CURRENCY_STORAGE, this.chartState.currency);
                    this.render();
                };
            });
        }

        // Value / Perf Toggle
        document.querySelectorAll('.toggle-group:not(#currencyToggle) .toggle-btn').forEach(btn => {
            btn.onclick = () => {
                btn.parentElement.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.mode = btn.textContent.trim() === 'Performance' ? 'PERF' : 'VALUE';
                this.render();
            };
        });

        // Benchmarks
        document.querySelectorAll('.benchmark-checkbox-btn').forEach(btn => {
            btn.onclick = () => {
                btn.classList.toggle('active');
                const symbol = btn.dataset.symbol;
                if (btn.classList.contains('active')) {
                    if (!this.chartState.benchmarks.includes(symbol)) {
                        this.chartState.benchmarks.push(symbol);
                    }
                    if (this.chartState.mode !== 'PERF') {
                        this.chartState.mode = 'PERF';
                        document.querySelectorAll('.toggle-group:not(#currencyToggle) .toggle-btn').forEach(b => {
                            b.classList.toggle('active', b.textContent.trim() === 'Performance');
                        });
                    }
                } else {
                    this.chartState.benchmarks = this.chartState.benchmarks.filter(s => s !== symbol);
                }
                this.render();
            };
        });

        // Performance list filter
        const perfFilterGroup = document.getElementById('perfFilterGroup');
        if (perfFilterGroup) {
            perfFilterGroup.querySelectorAll('.filter-btn').forEach(btn => {
                btn.onclick = () => {
                    perfFilterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.chartState.perfFilter = btn.dataset.filter;
                    this.render();
                };
            });
        }

        // Range Buttons
        document.querySelectorAll('#timeRangeSelector .range-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#timeRangeSelector .range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.range = btn.dataset.range || 'ALL';
                this.render();
            };
        });

        // Profit chart range buttons
        document.querySelectorAll('#profitRangeSelector .range-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#profitRangeSelector .range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.profitRange = btn.dataset.range || 'ALL';
                this.render();
            };
        });

        // Navigation Tabs — sous-nav, nav basse et menu lateral pilotent le meme etat
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                const tab = btn.dataset.tab;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                const tabTarget = document.getElementById(`view-${tab}`);
                if (tabTarget) tabTarget.classList.add('active');

                // Charts created while their tab was hidden (display:none) can be
                // measured with a stale size by Chart.js; force a resize once visible.
                [this.chart, this.profitChart, this.assetChart, this.classChart, this.currencyChart, this.sectorChart, this.researchChart]
                    .forEach(c => c && c.resize());

                if (tab === 'research') this.onResearchTabShown();
            };
        });

        // Dynamic Clicks (Delete trade, edit trade, quick sell, edit portfolio, delete portfolio)
        document.addEventListener('click', async (e) => {
            // Menu "..." des cartes de transaction (mobile)
            const txMenuBtn = e.target.closest('.tx-menu-btn');
            document.querySelectorAll('.tx-card.menu-open').forEach(c => {
                if (!txMenuBtn || c !== txMenuBtn.closest('.tx-card')) c.classList.remove('menu-open');
            });
            if (txMenuBtn) {
                e.stopPropagation();
                txMenuBtn.closest('.tx-card').classList.toggle('menu-open');
                return;
            }

            const editTradeBtn = e.target.closest('.edit-trade-btn');
            if (editTradeBtn) {
                const trade = this.service.trades.find(t => t.id === editTradeBtn.dataset.id);
                if (trade) {
                    this.editingTradeId = trade.id;
                    modalTitle.textContent = 'Modifier la transaction';
                    form.reset();
                    form.elements['type'].value = trade.type;
                    updateFormFieldsForType(trade.type);

                    form.elements['date'].value = trade.date;
                    symbolInput.value = trade.symbol;
                    qtyInput.value = trade.qty;
                    priceInput.value = trade.price;
                    priceCurrencyField.value = Utils.getCurrency(trade.symbol);
                    feesInput.value = trade.fees || '';
                    amountInput.value = trade.amount;

                    const portSelect = document.getElementById('targetPortfolioSelect');
                    if (portSelect) portSelect.value = trade.portfolioId;

                    modal.classList.add('open');
                }
            }

            const delBtn = e.target.closest('.delete-trade-btn');
            if (delBtn) {
                if (confirm('Voulez-vous vraiment supprimer cette transaction ?')) {
                    try {
                        await this.service.removeTrade(delBtn.dataset.id);
                    } catch (err) {
                        alert('Erreur : ' + err.message);
                    }
                }
            }

            const assetCell = e.target.closest('.holding-asset-cell');
            if (assetCell) {
                this.goToResearch(assetCell.dataset.symbol);
            }

            const sellBtn = e.target.closest('.quick-sell-btn');
            if (sellBtn) {
                const sym = sellBtn.dataset.symbol;
                const qty = sellBtn.dataset.qty;
                const price = sellBtn.dataset.price;

                modalTitle.textContent = `Vendre ${sym}`;
                form.reset();
                form.elements['date'].value = Utils.getDateString();
                form.elements['type'].value = 'SELL';
                updateFormFieldsForType('SELL');

                symbolInput.value = sym;
                qtyInput.value = qty;
                priceInput.value = price;
                priceCurrencyField.value = Utils.getCurrency(sym);

                modal.classList.add('open');
            }

            // Edit portfolio
            const editPortBtn = e.target.closest('.edit-portfolio-btn');
            if (editPortBtn) {
                e.stopPropagation();
                switcherContainer.classList.remove('open');
                const pId = editPortBtn.dataset.id;
                const port = this.service.getPortfolioById(pId);
                if (port) {
                    portfolioModalTitle.textContent = 'Modifier le portefeuille';
                    document.getElementById('portfolioEditId').value = port.id;
                    document.getElementById('portfolioNameInput').value = port.name;
                    const radio = document.querySelector(`input[name="portfolioColor"][value="${port.color}"]`);
                    if (radio) radio.checked = true;
                    const curIcon = Utils.portfolioIconOverrides()[port.id] || '';
                    const iconRadio = document.querySelector(`input[name="portfolioIcon"][value="${curIcon}"]`);
                    if (iconRadio) iconRadio.checked = true;
                    document.getElementById('portfolioSubmitBtn').textContent = 'Sauvegarder';
                    portfolioModal.classList.add('open');
                }
            }

            // Delete portfolio
            const delPortBtn = e.target.closest('.delete-portfolio-btn');
            if (delPortBtn) {
                e.stopPropagation();
                const pId = delPortBtn.dataset.id;
                const port = this.service.getPortfolioById(pId);
                if (confirm(`Voulez-vous vraiment supprimer le portefeuille "${port.name}" et toutes ses transactions ?`)) {
                    try {
                        await this.service.deletePortfolio(pId);
                    } catch (err) {
                        alert('Erreur : ' + err.message);
                    }
                }
            }

            // Switch to specific portfolio
            const portItem = e.target.closest('.portfolio-item-select');
            if (portItem) {
                const pId = portItem.dataset.id;
                this.service.setActivePortfolio(pId);
                switcherContainer.classList.remove('open');
            }
        });

        // --- TRANSACTIONS FILTERS (feuille de filtres) ---
        const txSearchInput = document.getElementById('txSearchInput');
        const txFromFilter = document.getElementById('txFromFilter');
        const txToFilter = document.getElementById('txToFilter');
        const txFilterModal = document.getElementById('txFilterModal');
        const txFilterOpenBtn = document.getElementById('txFilterOpenBtn');
        const txFilterResetBtn = document.getElementById('txFilterResetBtn');
        const txApplyBtn = document.getElementById('txApplyBtn');
        const txTypePills = document.getElementById('txTypePills');

        const syncTxFilterUI = () => {
            if (txTypePills) txTypePills.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', this.txFilters.types.includes(b.dataset.type));
            });
            if (txFromFilter) txFromFilter.value = this.txFilters.from || '';
            if (txToFilter) txToFilter.value = this.txFilters.to || '';
        };

        if (txSearchInput) {
            txSearchInput.oninput = () => {
                this.txFilters.search = txSearchInput.value;
                this.renderTransactionsTable(this.chartState.currency);
            };
        }
        if (txFilterOpenBtn && txFilterModal) {
            txFilterOpenBtn.onclick = () => { syncTxFilterUI(); txFilterModal.classList.add('open'); };
            txFilterModal.addEventListener('click', (e) => {
                if (e.target === txFilterModal) txFilterModal.classList.remove('open');
            });
        }
        if (txTypePills) {
            txTypePills.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => {
                    const t = btn.dataset.type;
                    const i = this.txFilters.types.indexOf(t);
                    if (i === -1) this.txFilters.types.push(t); else this.txFilters.types.splice(i, 1);
                    btn.classList.toggle('active');
                    this.renderTransactionsTable(this.chartState.currency);
                };
            });
        }
        if (txFromFilter) {
            txFromFilter.onchange = () => {
                this.txFilters.from = txFromFilter.value;
                this.renderTransactionsTable(this.chartState.currency);
            };
        }
        if (txToFilter) {
            txToFilter.onchange = () => {
                this.txFilters.to = txToFilter.value;
                this.renderTransactionsTable(this.chartState.currency);
            };
        }
        if (txApplyBtn && txFilterModal) {
            txApplyBtn.onclick = () => txFilterModal.classList.remove('open');
        }
        if (txFilterResetBtn) {
            txFilterResetBtn.onclick = () => {
                this.txFilters.types = [];
                this.txFilters.from = '';
                this.txFilters.to = '';
                syncTxFilterUI();
                this.renderTransactionsTable(this.chartState.currency);
            };
        }
    },

    updateTxFilterCounts(matchCount) {
        const f = this.txFilters;
        const n = f.types.length + (f.from ? 1 : 0) + (f.to ? 1 : 0);
        const countEl = document.getElementById('txFilterCount');
        if (countEl) countEl.textContent = n ? ` · ${n}` : '';
        const openBtn = document.getElementById('txFilterOpenBtn');
        if (openBtn) openBtn.classList.toggle('has-filters', n > 0);
        const applyBtn = document.getElementById('txApplyBtn');
        if (applyBtn) applyBtn.textContent = `Appliquer · ${matchCount} transaction${matchCount > 1 ? 's' : ''}`;
    },

    renderPortfolioSwitcher() {
        const active = this.service.getActivePortfolio();
        const isGlobal = this.service.activePortfolioId === 'GLOBAL';

        const bulletEl = document.getElementById('activePortfolioBullet');
        const titleEl = document.getElementById('appTitle');
        const globalItem = document.getElementById('globalPortfolioItem');
        const listEl = document.getElementById('portfolioDropdownList');
        const targetSelect = document.getElementById('targetPortfolioSelect');

        if (bulletEl) {
            bulletEl.classList.add('pf-ico');
            bulletEl.style.background = 'none';
            bulletEl.style.color = active.color || '#3b82f6';
            bulletEl.innerHTML = `<i data-lucide="${Utils.portfolioIcon(active)}"></i>`;
        }
        if (titleEl) {
            titleEl.textContent = active.name;
        }

        if (globalItem) {
            globalItem.classList.toggle('active', isGlobal);
        }

        // Render Portfolios List in Dropdown
        if (listEl) {
            listEl.innerHTML = this.service.portfolios.map(p => {
                const isSelected = p.id === this.service.activePortfolioId;
                const countTrades = this.service.trades.filter(t => t.portfolioId === p.id).length;

                return `
                    <div class="portfolio-dropdown-item portfolio-item-select ${isSelected ? 'active' : ''}" data-id="${p.id}">
                        <div class="portfolio-item-left">
                            <span class="portfolio-bullet pf-ico" style="color:${p.color};"><i data-lucide="${Utils.portfolioIcon(p)}"></i></span>
                            <div class="portfolio-item-text">
                                <span class="portfolio-title">${p.name}</span>
                                <span class="portfolio-sub">${countTrades} opération${countTrades > 1 ? 's' : ''}</span>
                            </div>
                        </div>
                        <div class="portfolio-item-actions">
                            <button class="item-action-btn edit-portfolio-btn" data-id="${p.id}" title="Renommer">
                                <i data-lucide="edit-2" class="icon-xs"></i>
                            </button>
                            ${this.service.portfolios.length > 1 ? `
                            <button class="item-action-btn delete delete-portfolio-btn" data-id="${p.id}" title="Supprimer">
                                <i data-lucide="trash-2" class="icon-xs"></i>
                            </button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render Portfolios in desktop side nav
        const sideListEl = document.getElementById('sidePortfolioList');
        if (sideListEl) {
            sideListEl.innerHTML = this.service.portfolios.map(p => {
                const isSel = p.id === this.service.activePortfolioId;
                const name = Utils.escapeHtml(p.name);
                return `
                    <button class="side-portfolio portfolio-item-select ${isSel ? 'active' : ''}" data-id="${p.id}" title="${name}">
                        <i class="side-portfolio-ico" data-lucide="${Utils.portfolioIcon(p)}" style="color:${p.color};"></i>
                        <span class="side-label">${name}</span>
                    </button>`;
            }).join('');
        }

        // Render Target Portfolio Select options in Transaction Modal
        if (targetSelect) {
            targetSelect.innerHTML = this.service.portfolios.map(p => {
                const isSel = (!isGlobal && p.id === this.service.activePortfolioId) || (isGlobal && p.id === this.service.portfolios[0].id);
                return `<option value="${p.id}" ${isSel ? 'selected' : ''}>${p.name}</option>`;
            }).join('');
        }

        if (window.lucide) lucide.createIcons();
    },

    txFilters: { search: '', types: [], from: '', to: '' },
    assetNameCache: {},

    async fetchAssetName(symbol) {
        if (symbol.startsWith('$')) return null;
        try {
            const results = await APIService.searchSymbol(symbol);
            const match = results.find(r => (r.displaySymbol || r.symbol) === symbol) || results[0];
            return (match && match.description) || null;
        } catch (e) {
            return null;
        }
    },

    async fetchWebNewsContext(symbols, namesList) {
        const blocks = await Promise.all(symbols.map(async (symbol, idx) => {
            const label = namesList[idx] || symbol;
            const results = await APIService.webSearch(`${label} actualité résultats financiers`);
            if (!results.length) return null;
            const items = results.slice(0, 5).map(r => {
                const date = r.publishedDate ? `[${r.publishedDate}] ` : '';
                return `- ${date}${r.title} : ${(r.content || '').slice(0, 500)}`;
            }).join('\n');
            return `### ${symbol}\n${items}`;
        }));
        return blocks.filter(Boolean).join('\n\n');
    },

    async refreshAssetNames(symbols, curr) {
        const toFetch = symbols.filter(s => !(s in this.assetNameCache));
        if (!toFetch.length) return;
        await Promise.all(toFetch.map(async s => {
            this.assetNameCache[s] = await this.fetchAssetName(s);
        }));
        this.render();
    },

    renderTransactionsTable(curr) {
        const tBody = document.getElementById('transactionsTableBody');
        if (!tBody) return;

        const f = this.txFilters;
        const searchTerm = f.search.trim().toUpperCase();

        let sortedHistory = this.service.getSortedTrades().reverse();

        if (searchTerm) sortedHistory = sortedHistory.filter(t => t.symbol.toUpperCase().includes(searchTerm));
        if (f.types && f.types.length) sortedHistory = sortedHistory.filter(t => f.types.includes(t.type));
        if (f.from) sortedHistory = sortedHistory.filter(t => t.date >= f.from);
        if (f.to) sortedHistory = sortedHistory.filter(t => t.date <= f.to);

        this.updateTxFilterCounts(sortedHistory.length);

        tBody.innerHTML = sortedHistory.length ? sortedHistory.map(t => {
            let badgeClass = 'badge-buy';
            let typeLabel = 'Achat';

            if (t.type === 'SELL') { badgeClass = 'badge-sell'; typeLabel = 'Vente'; }
            else if (t.type === 'DEPOSIT') { badgeClass = 'badge-deposit'; typeLabel = 'Dépôt'; }
            else if (t.type === 'WITHDRAWAL') { badgeClass = 'badge-withdrawal'; typeLabel = 'Retrait'; }
            else if (t.type === 'DIVIDEND') { badgeClass = 'badge-dividend'; typeLabel = 'Dividende'; }
            else if (t.type === 'FEE') { badgeClass = 'badge-fee'; typeLabel = 'Frais'; }

            const port = this.service.getPortfolioById(t.portfolioId);
            const tradeCurrency = Utils.getCurrency(t.symbol);
            const totalFormatted = t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL'
                ? Utils.formatCurrency(t.amount, curr)
                : Utils.formatCurrency(t.qty * t.price, tradeCurrency);
            const assetName = this.assetNameCache[t.symbol];

            return `
                <tr>
                    <td data-label="Date" style="font-weight:500;">${Utils.formatDateDisplay(t.date)}</td>
                    <td data-label="Portefeuille">
                        <span class="portfolio-badge">
                            <span class="dot" style="background:${port.color}"></span>
                            ${port.name}
                        </span>
                    </td>
                    <td data-label="Type"><span class="badge ${badgeClass}">${typeLabel}</span></td>
                    <td data-label="Actif" style="font-weight:600;">${t.symbol}</td>
                    <td data-label="Nom" style="color:var(--text-secondary); font-size:13px;">${assetName || ''}</td>
                    <td data-label="Quantité">${t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL' ? '—' : t.qty}</td>
                    <td data-label="Prix">${t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL' ? '—' : Utils.formatCurrency(t.price, tradeCurrency)}</td>
                    <td data-label="Total" style="font-weight:600;">${totalFormatted}</td>
                    <td data-label="Actions">
                        <button class="edit-trade-btn" data-id="${t.id}" style="color:var(--dim); border:none; background:none; cursor:pointer;" title="Modifier">
                            <i data-lucide="pencil" class="icon-sm"></i>
                        </button>
                        <button class="delete-trade-btn" data-id="${t.id}" style="color:var(--dn); border:none; background:none; cursor:pointer;" title="Supprimer">
                            <i data-lucide="trash-2" class="icon-sm"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--dim);">Aucune transaction ne correspond aux filtres.</td></tr>';

        // Cartes mobiles
        const txCards = document.getElementById('txCardsList');
        if (txCards) {
            const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];
            txCards.innerHTML = sortedHistory.length ? sortedHistory.map(t => {
                const isCash = t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL';
                let badgeClass = 'badge-buy', typeLabel = 'Achat';
                if (t.type === 'SELL') { badgeClass = 'badge-sell'; typeLabel = 'Vente'; }
                else if (t.type === 'DEPOSIT') { badgeClass = 'badge-deposit'; typeLabel = 'Dépôt'; }
                else if (t.type === 'WITHDRAWAL') { badgeClass = 'badge-withdrawal'; typeLabel = 'Retrait'; }
                else if (t.type === 'DIVIDEND') { badgeClass = 'badge-dividend'; typeLabel = 'Dividende'; }
                else if (t.type === 'FEE') { badgeClass = 'badge-fee'; typeLabel = 'Frais'; }

                const tradeCurrency = Utils.getCurrency(t.symbol);
                const d = Utils.parseDate(t.date);
                const sym = t.symbol.replace(/^\$/, '') || 'CASH';
                const sub = isCash ? '_' : `${t.qty} × ${Utils.formatCurrency(t.price, tradeCurrency)}`;

                let amount, amountCls = '';
                if (t.type === 'DEPOSIT' || t.type === 'DIVIDEND') {
                    amount = '+' + Utils.formatCurrency(isCash ? t.amount : t.qty * t.price, isCash ? curr : tradeCurrency);
                    amountCls = 'text-green';
                } else if (t.type === 'WITHDRAWAL' || t.type === 'FEE') {
                    amount = '−' + Utils.formatCurrency(isCash ? t.amount : t.qty * t.price, isCash ? curr : tradeCurrency);
                    amountCls = 'text-red';
                } else {
                    amount = Utils.formatCurrency(t.qty * t.price, tradeCurrency);
                }

                return `
                <div class="tx-card">
                    <div class="tx-date"><b>${d.getDate()}</b><span>${MONTHS[d.getMonth()]}</span></div>
                    <div class="tx-main">
                        <div class="tx-line1"><span class="badge ${badgeClass}">${typeLabel}</span><span class="tx-sym">${Utils.escapeHtml(sym)}</span></div>
                        <div class="tx-line2">${Utils.escapeHtml(sub)}</div>
                    </div>
                    <div class="tx-amount ${amountCls}">${amount}</div>
                    <button class="tx-menu-btn" data-id="${t.id}" aria-label="Actions">⋯</button>
                    <div class="tx-menu">
                        <button class="edit-trade-btn" data-id="${t.id}"><i data-lucide="pencil"></i>Modifier</button>
                        <button class="delete-trade-btn" data-id="${t.id}"><i data-lucide="trash-2"></i>Supprimer</button>
                    </div>
                </div>`;
            }).join('') : '<div class="tx-cards-empty">Aucune transaction ne correspond aux filtres.</div>';
        }

        if (window.lucide) lucide.createIcons();

        const uniqueSymbols = [...new Set(sortedHistory.map(t => t.symbol))];
        this.refreshAssetNames(uniqueSymbols, curr);
    },

    initHoldingsSwipe() {
        const list = document.getElementById('holdingsCardsList');
        if (!list) return;
        const OPEN = -96;
        list.querySelectorAll('.holding-swipe').forEach(sw => {
            const card = sw.querySelector('.holding-card');
            if (!card) return;
            let x0 = 0, y0 = 0, dx = 0, open = false, active = false, decided = false, horiz = false;
            const set = (v) => { card.style.transform = `translateX(${v}px)`; };
            const closeOthers = () => {
                list.querySelectorAll('.holding-swipe.is-open').forEach(o => {
                    if (o === sw) return;
                    o.classList.remove('is-open');
                    const c = o.querySelector('.holding-card');
                    if (c) c.style.transform = 'translateX(0)';
                });
            };
            card.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                x0 = t.clientX; y0 = t.clientY; dx = 0;
                active = true; decided = false; horiz = false;
                sw.classList.add('dragging');
            }, { passive: true });
            card.addEventListener('touchmove', (e) => {
                if (!active) return;
                const t = e.touches[0];
                dx = t.clientX - x0;
                const dy = t.clientY - y0;
                if (!decided) {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                    decided = true;
                    horiz = Math.abs(dx) > Math.abs(dy);
                    if (horiz) closeOthers();
                }
                if (!horiz) return;
                e.preventDefault();
                let v = (open ? OPEN : 0) + dx;
                if (v > 0) v = 0;
                if (v < OPEN) v = OPEN;
                set(v);
            }, { passive: false });
            const end = () => {
                if (!active) return;
                active = false;
                sw.classList.remove('dragging');
                if (!horiz) return;
                const v = (open ? OPEN : 0) + dx;
                open = v <= OPEN / 2;
                sw.classList.toggle('is-open', open);
                set(open ? OPEN : 0);
            };
            card.addEventListener('touchend', end);
            card.addEventListener('touchcancel', end);
            sw.addEventListener('click', (e) => {
                if (e.target.closest('.holding-swipe-action')) return;
                if (open) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    open = false;
                    sw.classList.remove('is-open');
                    set(0);
                }
            }, true);
        });
    },

    render() {
        const curr = this.chartState.currency;
        const stats = this.service.calculatePortfolio(curr);
        if (!stats) return;

        // Render Switcher Dropdown
        this.renderPortfolioSwitcher();

        // Titre de la carte graphique = nom du portefeuille selectionne
        const chartTitleEl = document.getElementById('chartPortfolioTitle');
        if (chartTitleEl) chartTitleEl.textContent = this.service.getActivePortfolio().name;

        // Sync Range Buttons Active State
        document.querySelectorAll('#timeRangeSelector .range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === this.chartState.range);
        });
        document.querySelectorAll('#profitRangeSelector .range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === this.chartState.profitRange);
        });

        // Sync Currency Toggle UI
        const currencyToggle = document.getElementById('currencyToggle');
        if (currencyToggle) {
            currencyToggle.querySelectorAll('.toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.currency === curr);
            });
        }

        // 1. STATS GRID RENDERING (WITH 3 DISTINCT VALUES IN CARD 1)
        const statsGrid = document.getElementById('statsGrid');
        if (statsGrid) {
            statsGrid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">Valeur du portefeuille</div>
                    <div class="stat-value">
                        ${Utils.formatCurrency(stats.totalValue, curr)}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px; margin-top:8px; padding-top:6px; border-top:1px solid var(--l1); font-size:12px; color:var(--text-secondary);">
                        <div style="display:flex; justify-content:space-between;">
                            <span>Portefeuille :</span>
                            <strong style="color:var(--text-primary);">${Utils.formatCurrency(stats.holdingsValue, curr)}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span>Cash :</span>
                            <strong style="color:var(--text-primary);">${Utils.formatCurrency(stats.cash, curr)}</strong>
                        </div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Gain non réalisé</div>
                    <div class="stat-value ${stats.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}">
                        ${stats.unrealizedPnL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.unrealizedPnL, curr)}
                        <span class="percent">(${Utils.formatPercent(stats.unrealizedPercent)})</span>
                    </div>
                    <div class="stat-sub">Coût d'achat actions : ${Utils.formatCurrency(stats.holdingsCost, curr)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Gain réalisé</div>
                    <div class="stat-value ${stats.realizedPnL >= 0 ? 'text-green' : 'text-red'}">
                        ${stats.realizedPnL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.realizedPnL, curr)}
                    </div>
                    <div class="stat-sub">Dividendes reçus : <strong>${Utils.formatCurrency(stats.totalDividends, curr)}</strong></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Gain total net</div>
                    <div class="stat-value ${stats.totalPnL >= 0 ? 'text-green' : 'text-red'}">
                        ${stats.totalPnL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.totalPnL, curr)}
                        <span class="percent">(${Utils.formatPercent(stats.totalReturnPercent)})</span>
                    </div>
                    <div class="stat-sub">Rendement global sur apport</div>
                </div>
            `;
        }

        // 2. HOLDINGS TABLE RENDERING
        const hBody = document.getElementById('holdingsTableBody');
        if (hBody) {
            hBody.innerHTML = stats.holdings.length ? stats.holdings.map(h => {
                const isProfit = h.gainNative >= 0;
                const isGlobal = this.service.activePortfolioId === 'GLOBAL';
                
                let portTags = '';
                if (isGlobal && h.portfolios && h.portfolios.length) {
                    portTags = h.portfolios.map(pId => {
                        const p = this.service.getPortfolioById(pId);
                        return `<span class="portfolio-badge" style="font-size:10px; padding:1px 5px;"><span class="dot" style="background:${p.color}; width:6px; height:6px;"></span>${p.name}</span>`;
                    }).join(' ');
                }

                const assetName = this.assetNameCache[h.symbol];
                const isPriceUp = h.currentPrice >= h.avgPrice;

                return `
                    <tr>
                        <td data-label="Actif">
                            <div class="holding-asset-cell" data-symbol="${h.symbol}" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                <img class="perf-logo" src="${this.getLogoUrl(h.symbol)}" alt=""
                                    data-fallback="sibling">
                                <span class="perf-logo-fallback" style="display:none;">${h.symbol.substring(0, 1)}</span>
                                <div style="display:flex; flex-direction:column; gap:2px;">
                                    <span style="font-weight:700; color:var(--txt);">${h.symbol}</span>
                                    <span style="font-size:12px; color:var(--dim);">${assetName || Utils.getExchangeName(h.symbol)} · ${h.weightPercent.toFixed(1)}%</span>
                                    ${portTags ? `<div style="margin-top:2px; display:flex; gap:4px; flex-wrap:wrap;">${portTags}</div>` : ''}
                                </div>
                            </div>
                        </td>
                        <td data-label="Quantité">${h.qty.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
                        <td data-label="Prix Moyen">${Utils.formatCurrency(h.avgPrice, h.currency)}</td>
                        <td data-label="Prix Actuel" class="${isPriceUp ? 'text-green' : 'text-red'}">${Utils.formatCurrency(h.currentPrice, h.currency)}</td>
                        <td data-label="Valeur" style="font-weight:700;">${Utils.formatCurrency(h.valueNative, h.currency)}</td>
                        <td data-label="+/- Latente" class="${isProfit ? 'text-green' : 'text-red'}" style="font-weight:600;">
                            ${isProfit ? '+' : ''}${Utils.formatCurrency(h.gainNative, h.currency)}
                            <br><span style="font-size:12px;">(${Utils.formatPercent(h.gainPercent)})</span>
                        </td>
                        <td data-label="Actions">
                            <button class="btn-sm btn-primary quick-sell-btn"
                                data-symbol="${h.symbol}"
                                data-qty="${h.qty}"
                                data-price="${h.currentPrice}">
                                Vendre
                            </button>
                        </td>
                    </tr>
                `;
            }).join('') : '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--dim);">Aucune position active dans ce portefeuille.</td></tr>';
            this.refreshAssetNames(stats.holdings.map(h => h.symbol), curr);
        }

        // 2b. HOLDINGS CARDS (mobile) — meme design + glisser pour vendre
        const cardsList = document.getElementById('holdingsCardsList');
        const cntEl = document.getElementById('holdingsCount');
        const totEl = document.getElementById('holdingsCardsTotal');
        if (cntEl) cntEl.textContent = `${stats.holdings.length} position${stats.holdings.length > 1 ? 's' : ''}`;
        if (totEl) totEl.textContent = Utils.formatCurrency(stats.holdingsValue, curr);
        if (cardsList) {
            cardsList.innerHTML = stats.holdings.length ? stats.holdings.map(h => {
                const isProfit = h.gainNative >= 0;
                const isPriceUp = h.currentPrice >= h.avgPrice;
                const nm = this.assetNameCache[h.symbol] || Utils.getExchangeName(h.symbol);
                const barW = Math.max(2, Math.min(100, h.weightPercent || 0));
                return `
                <div class="holding-swipe">
                    <button class="holding-swipe-action quick-sell-btn" data-symbol="${h.symbol}" data-qty="${h.qty}" data-price="${h.currentPrice}">Vendre</button>
                    <div class="holding-card">
                        <div class="hc-row1 holding-asset-cell" data-symbol="${h.symbol}">
                            <img class="hc-logo" src="${this.getLogoUrl(h.symbol)}" alt="" data-fallback="sibling">
                            <span class="hc-logo-fb" style="display:none;">${h.symbol.substring(0, 1)}</span>
                            <div class="hc-id">
                                <span class="hc-sym">${h.symbol}</span>
                                <span class="hc-weight">${h.weightPercent.toFixed(1).replace('.', ',')} %</span>
                            </div>
                            <span class="hc-value">${Utils.formatCurrency(h.valueNative, h.currency)}</span>
                        </div>
                        <div class="hc-row2">
                            <span class="hc-name">${Utils.escapeHtml(nm)}</span>
                            <span class="hc-gain ${isProfit ? 'text-green' : 'text-red'}">${isProfit ? '+' : ''}${Utils.formatCurrency(h.gainNative, h.currency)} · ${Utils.formatPercent(h.gainPercent)}</span>
                        </div>
                        <div class="hc-bar"><i style="width:${barW}%"></i></div>
                        <div class="hc-grid">
                            <div><div class="hc-cell-label">Qté</div><div class="hc-cell-val">${h.qty.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</div></div>
                            <div><div class="hc-cell-label">PRU</div><div class="hc-cell-val">${Utils.formatCurrency(h.avgPrice, h.currency)}</div></div>
                            <div><div class="hc-cell-label">Cours</div><div class="hc-cell-val ${isPriceUp ? 'text-green' : 'text-red'}">${Utils.formatCurrency(h.currentPrice, h.currency)}</div></div>
                        </div>
                    </div>
                </div>`;
            }).join('') : '<div class="hc-empty">Aucune position active dans ce portefeuille.</div>';
            this.initHoldingsSwipe();
        }

        // 3. TRANSACTIONS TABLE RENDERING
        this.renderTransactionsTable(curr);

        // 4. UPDATE DYNAMIC TIME RANGE BADGES
        const timelineData = this.service.getHistoricalTimeline(this.chartState.range, this.chartState.mode, curr);
        if (timelineData && timelineData.rangeStats) {
            const isPerf = this.chartState.mode === 'PERF';
            const badgeStats = isPerf ? timelineData.rangeStats : timelineData.valueRangeStats;
            Object.entries(badgeStats).forEach(([rangeKey, val]) => {
                const el = document.querySelector(`[data-range-val="${rangeKey}"]`);
                if (el) {
                    const isPositive = val >= 0;
                    const fmt = (v) => isPerf
                        ? Utils.formatPercent(v)
                        : (v >= 0 ? '+' : '') + Utils.formatCurrency(v, curr);
                    const rangeBtn = el.closest('.range-btn');
                    const isActive = rangeBtn && rangeBtn.classList.contains('active');
                    if (isActive) {
                        const from = (typeof this._activeDeltaVal === 'number') ? this._activeDeltaVal : val;
                        if (from !== val) this.animateNumber(el, from, val, fmt);
                        else if (!el._animating) el.textContent = fmt(val);
                        this._activeDeltaVal = val;
                    } else if (!el._animating) {
                        el.textContent = fmt(val);
                    }
                    el.className = `value ${isPositive ? 'text-green' : 'text-red'}`;
                }
            });
        }

        // 4b. VALEUR DE TETE DE LA CARTE GRAPHIQUE
        // Mode "Valeur" : montant en blanc + performance % en vert/rouge.
        // Mode "Performance" : performance % en blanc + montant en vert/rouge.
        const headVal = document.getElementById('chartHeadlineValue');
        const headDelta = document.getElementById('chartHeadlineDelta');
        if (headVal && timelineData) {
            const isPerfHead = this.chartState.mode === 'PERF';
            const valSeries = timelineData.values || [];
            const perfSeries = timelineData.perfValues || [];
            const lastVal = valSeries.length ? valSeries[valSeries.length - 1] : (stats ? stats.holdingsValue : 0);
            const lastPerf = perfSeries.length ? perfSeries[perfSeries.length - 1] : (stats ? stats.unrealizedPercent : 0);

            const valTxt = Utils.formatCurrency(lastVal, curr);
            const perfTxt = Utils.formatPercent(lastPerf);

            headVal.textContent = isPerfHead ? perfTxt : valTxt;
            headDelta.textContent = isPerfHead ? valTxt : perfTxt;
            headDelta.className = `chart-headline-delta ${lastPerf >= 0 ? 'text-green' : 'text-red'}`;
        }

        // 5. UPDATE CHART
        this.updateChart(timelineData);

        // 6. UPDATE ANALYSIS TAB (repartition par actif / classe / devise)
        this.renderAnalysisCharts(stats, curr);
        this.renderPerfList(stats);
        this.renderProfitChart();
        this.renderYearlyTable();
        this.renderDailyMovers();

        // Etats transverses : masquer le squelette, basculer l'etat vide
        const cont = document.getElementById('appContainer');
        if (cont) cont.classList.remove('app-loading');
        const emptyEl = document.getElementById('emptyState');
        if (emptyEl) emptyEl.hidden = !!(this.service.trades && this.service.trades.length);

        lucide.createIcons();
    },

    downloadCSV(filename, content) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    getLogoUrl(symbol) {
        const clean = symbol.split('.')[0].split('-')[0];
        return `https://img.logokit.com/ticker/${encodeURIComponent(clean)}?token=${CONFIG.LOGOKIT_TOKEN}`;
    },

    chartInk() {
        const cs = getComputedStyle(document.documentElement);
        const v = (n, fb) => (cs.getPropertyValue(n) || fb).trim();
        return {
            grid: v('--grid', 'rgba(255,255,255,.045)'),
            tick: v('--dim', '#8b93a1'),
            up: '#2ebd85',
            acc: '#00d3f2'
        };
    },

    // Anime un nombre de `from` a `to` (rAF, ~420ms, easing 1-(1-t)^3)
    animateNumber(el, from, to, fmt) {
        if (!el) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || document.hidden || typeof from !== 'number' || !isFinite(from)) {
            el.textContent = fmt(to);
            return;
        }
        const token = (el._animTok || 0) + 1;
        el._animTok = token;
        el._animating = true;
        const t0 = performance.now(), dur = 420;
        const step = (now) => {
            if (el._animTok !== token) return;
            const t = Math.min(1, (now - t0) / dur);
            const e = 1 - Math.pow(1 - t, 3);
            el.textContent = fmt(from + (to - from) * e);
            if (t < 1) requestAnimationFrame(step);
            else el._animating = false;
        };
        requestAnimationFrame(step);
    },

    renderPerfList(stats) {
        const listEl = document.getElementById('perfList');
        if (!listEl) return;

        const dividendSymbols = new Set(
            this.service.getFilteredTrades()
                .filter(t => t.type === 'DIVIDEND')
                .map(t => t.symbol)
        );

        let rows = (stats.holdings || []).slice();

        const filter = this.chartState.perfFilter;
        if (filter === 'up') rows = rows.filter(h => h.gainPercent > 0);
        else if (filter === 'down') rows = rows.filter(h => h.gainPercent < 0);
        else if (filter === 'dividends') rows = rows.filter(h => dividendSymbols.has(h.symbol));

        rows.sort((a, b) => b.gainPercent - a.gainPercent);

        if (rows.length === 0) {
            listEl.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-secondary);">Aucune position à afficher.</p>';
            return;
        }

        const maxAbs = Math.max(...rows.map(h => Math.abs(h.gainPercent)), 1);

        listEl.innerHTML = rows.map(h => {
            const isPositive = h.gainPercent >= 0;
            const widthPct = (Math.abs(h.gainPercent) / maxAbs) * 100;
            const barClass = isPositive ? 'positive' : 'negative';
            const gainNativeStr = (isPositive ? '+' : '') + Utils.formatCurrency(h.gainNative, h.currency);
            const valueStr = Utils.formatCurrency(h.valueNative, h.currency);

            return `
                <div class="perf-row">
                    <img class="perf-logo" src="${this.getLogoUrl(h.symbol)}" alt=""
                        data-fallback="sibling">
                    <span class="perf-logo-fallback" style="display:none;">${h.symbol.substring(0, 1)}</span>
                    <span class="perf-ticker">${h.symbol}</span>
                    <div class="perf-bar-track">
                        <div class="perf-bar-fill ${barClass}" style="width:${widthPct}%;"></div>
                    </div>
                    <span class="perf-pct ${isPositive ? 'text-green' : 'text-red'}">${Utils.formatPercent(h.gainPercent)}</span>
                    <div class="perf-tooltip">
                        <div class="tt-name">${h.symbol}</div>
                        <div class="tt-row"><span>Gain total %</span><span>${Utils.formatPercent(h.gainPercent)}</span></div>
                        <div class="tt-row"><span>Gain total</span><span>${gainNativeStr}</span></div>
                        <div class="tt-row"><span>Valeur totale</span><span>${valueStr}</span></div>
                    </div>
                </div>
            `;
        }).join('');
    },

    renderDailyMovers() {
        const gainersEl = document.getElementById('gainersList');
        const losersEl = document.getElementById('losersList');
        if (!gainersEl || !losersEl) return;

        const { gainers, losers } = this.service.getDailyMovers(this.chartState.currency);

        const renderList = (el, items, barClass) => {
            if (!items.length) {
                el.innerHTML = '<p style="text-align:center; padding:12px; color:var(--text-secondary);">Aucune donnée du jour.</p>';
                return;
            }
            const maxAbs = Math.max(...items.map(m => Math.abs(m.dayChangePercent)), 1);

            el.innerHTML = items.map(m => {
                const widthPct = (Math.abs(m.dayChangePercent) / maxAbs) * 100;
                return `
                    <div class="perf-row">
                        <img class="perf-logo" src="${this.getLogoUrl(m.symbol)}" alt=""
                            data-fallback="sibling">
                        <span class="perf-logo-fallback" style="display:none;">${m.symbol.substring(0, 1)}</span>
                        <span class="perf-ticker">${m.symbol}</span>
                        <div class="perf-bar-track">
                            <div class="perf-bar-fill ${barClass}" style="width:${widthPct}%;"></div>
                        </div>
                        <span class="perf-pct ${barClass === 'positive' ? 'text-green' : 'text-red'}">${Utils.formatPercent(m.dayChangePercent)}</span>
                    </div>
                `;
            }).join('');
        };

        renderList(gainersEl, gainers, 'positive');
        renderList(losersEl, losers, 'negative');
    },

    async refreshUpcomingDividends() {
        const listEl = document.getElementById('upcomingDividendsList');
        if (!listEl) return;

        const items = await this.service.getUpcomingDividends(this.chartState.currency);
        const curr = this.chartState.currency;

        listEl.innerHTML = items.length ? items.map(d => `
            <div class="perf-row">
                <img class="perf-logo" src="${this.getLogoUrl(d.symbol)}" alt=""
                    data-fallback="sibling">
                <span class="perf-logo-fallback" style="display:none;">${d.symbol.substring(0, 1)}</span>
                <span class="perf-ticker">${d.symbol}</span>
                <span style="flex:1; color:var(--text-secondary); font-size:13px;">${Utils.formatDateDisplay(d.estimatedDate)} (est.)</span>
                <span style="width:90px; text-align:right; font-weight:600; font-size:13px;">${Utils.formatCurrency(d.amount, curr)}</span>
                <span style="width:60px; text-align:right; color:var(--text-secondary); font-size:12px;">${d.yieldPercent.toFixed(2)}%</span>
            </div>
        `).join('') : '<p style="text-align:center; padding:12px; color:var(--text-secondary);">Aucun dividende estimé dans les 45 prochains jours.</p>';
    },

    // Resume IA : tronque a 4 lignes par defaut si le texte est long (coherence de design),
    // avec un bouton "Afficher plus".
    renderInsightsSummary(text) {
        const safe = Utils.escapeHtml(text);
        if (text.length <= 220) return `<div class="insights-summary">${safe}</div>`;
        return `<div class="insights-summary">
            <div class="insights-summary-text is-clamped">${safe}</div>
            <button type="button" class="insights-summary-toggle">Afficher plus</button>
        </div>`;
    },

    renderInsightsGroups(groups) {
        if (!groups.length) return '<p style="color:var(--text-secondary);">Aucun événement notable détecté.</p>';

        const sorted = groups.slice().sort((a, b) => {
            const dateA = a.items.reduce((max, it) => it.date && it.date > max ? it.date : max, '');
            const dateB = b.items.reduce((max, it) => it.date && it.date > max ? it.date : max, '');
            return dateB.localeCompare(dateA);
        });

        return '<div class="insights-carousel">' + sorted.map((g) => {
            const [firstItem, ...restItems] = g.items;

            return `
            <div class="insights-group">
                <div class="insights-group-header">
                    <img class="insights-logo" src="${this.getLogoUrl(g.symbol)}" alt=""
                        data-fallback="sibling">
                    <span class="insights-logo-fallback" style="display:none;">${g.symbol.substring(0, 1)}</span>
                    <span class="insights-group-title">${Utils.escapeHtml(g.symbol)}</span>
                    ${g.name ? `<span class="insights-group-name">${Utils.escapeHtml(g.name)}</span>` : ''}
                </div>
                <div class="insights-item" style="border-bottom:none;">
                    <div class="insights-item-title">${Utils.escapeHtml(firstItem.title)}</div>
                </div>
                <div class="insights-more" style="display:none;">
                    <div class="insights-item">
                        ${firstItem.detail ? `<div class="insights-item-detail">${Utils.escapeHtml(firstItem.detail)}</div>` : ''}
                    </div>
                    ${restItems.map(it => `
                        <div class="insights-item">
                            <div class="insights-item-title">${Utils.escapeHtml(it.title)}</div>
                            ${it.detail ? `<div class="insights-item-detail">${Utils.escapeHtml(it.detail)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
                ${(firstItem.detail || restItems.length) ? `
                    <button type="button" class="insights-toggle-btn">Afficher plus</button>
                ` : ''}
            </div>
        `;
        }).join('') + '</div>';
    },

    setInsightsUpdatedAt(ts) {
        const el = document.getElementById('insightsUpdatedAt');
        if (!el) return;
        if (!ts) { el.hidden = true; return; }
        const diff = Math.max(0, Date.now() - ts);
        const min = Math.floor(diff / 60000);
        let label;
        if (min < 1) label = "à l'instant";
        else if (min < 60) label = `il y a ${min} min`;
        else if (min < 1440) label = `il y a ${Math.floor(min / 60)} h`;
        else label = `il y a ${Math.floor(min / 1440)} j`;
        el.textContent = label;
        el.hidden = false;
    },

    async refreshPortfolioInsights(force = false) {
        const bodyEl = document.getElementById('portfolioInsightsBody');
        if (!bodyEl) return;

        const stats = this.service.calculatePortfolio('USD');
        const holdings = stats.holdings.filter(h => !h.symbol.startsWith('$'));
        if (!holdings.length) {
            bodyEl.innerHTML = '<p style="color:var(--text-secondary);">Aucune position à analyser.</p>';
            return;
        }

        const symbols = holdings.map(h => h.symbol);
        const provider = this.service.aiProvider;
        const hasKey = !!provider && (this.service.aiConfigured || []).includes(provider);
        const cacheKey = `${hasKey ? 'ai-' + provider : 'plain'}:${symbols.slice().sort().join(',')}`;

        if (!force) {
            try {
                const cached = JSON.parse(localStorage.getItem(CONFIG.INSIGHTS_CACHE_STORAGE) || 'null');
                if (cached && cached.cacheKey === cacheKey && (Date.now() - cached.timestamp) < 6 * 3600 * 1000) {
                    bodyEl.innerHTML = cached.html;
                    this.setInsightsUpdatedAt(cached.timestamp);
                    return;
                }
            } catch (e) { /* cache corrompu, on ignore */ }
        }

        if (!provider || !hasKey || !AI_PROVIDERS[provider]) {
            const html = await this.buildPlainInsights(holdings);
            bodyEl.innerHTML = html;
            localStorage.setItem(CONFIG.INSIGHTS_CACHE_STORAGE, JSON.stringify({ cacheKey, timestamp: Date.now(), html }));
            this.setInsightsUpdatedAt(Date.now());
            return;
        }

        bodyEl.innerHTML = '<p style="color:var(--text-secondary);">Analyse en cours...</p>';
        try {
            const namesList = await Promise.all(symbols.map(async s => {
                const name = this.assetNameCache[s] !== undefined ? this.assetNameCache[s] : await this.fetchAssetName(s);
                this.assetNameCache[s] = name;
                return name ? `${s} (${name})` : s;
            }));

            const monthly = this.service.getMonthlyPerformanceSummary('USD');
            const monthlyFacts = `Performance du portefeuille sur les 30 derniers jours : ${monthly.portfolioPercent >= 0 ? '+' : ''}${monthly.portfolioPercent.toFixed(2)}%.
Titres en hausse sur la période : ${monthly.topGainers.length ? monthly.topGainers.map(m => `${m.symbol} ${m.changePercent >= 0 ? '+' : ''}${m.changePercent.toFixed(2)}%`).join(', ') : 'aucun'}.
Titres en baisse sur la période : ${monthly.topLosers.length ? monthly.topLosers.map(m => `${m.symbol} ${m.changePercent.toFixed(2)}%`).join(', ') : 'aucun'}.`;

            let webContext = '';
            if (!AI_PROVIDERS[provider].usesLiveSearch) {
                webContext = await this.fetchWebNewsContext(symbols, namesList);
            }
            const webContextBlock = webContext
                ? `\n\nExtraits d'actualités récentes trouvés sur le web pour ces titres (source réelle, utilise-les tels quels et ne les invente pas, ignore les extraits hors-sujet) :\n${webContext}\n`
                : '';

            const prompt = `Voici mon portefeuille d'investissement : ${namesList.join(', ')}.

Données chiffrées exactes de mon portefeuille sur les 30 derniers jours (utilise CES chiffres tels quels, ne les recalcule pas) :
${monthlyFacts}
${webContextBlock}
Cherche les actualités récentes et importantes (résultats trimestriels avec chiffres précis, annonces majeures, changements de direction, mouvements de marché notables, procédures judiciaires ou réglementaires...) ainsi que les événements à venir (prochaine publication de résultats, prochain dividende) pour CHACUN de ces titres.

Réponds UNIQUEMENT avec un objet JSON valide (pas de texte avant/après, pas de bloc markdown \`\`\`), au format exact suivant :
{
  "summary": "Un paragraphe de 2 à 4 phrases, ton dynamique et personnel (tutoiement, style 'Très belle performance ce mois-ci avec +3%, portée par Apple et Microsoft, déception de Meta après un T3 décevant...'). Commence par la performance globale du mois (utilise le chiffre exact fourni), cite les titres qui l'ont le plus tirée vers le haut et vers le bas avec leur %, et explique brièvement le POURQUOI de ces mouvements en t'appuyant sur les actualités trouvées (résultats, annonces...).",
  "portfolio": [
    {
      "symbol": "TICKER",
      "items": [
        { "date": "AAAA-MM-JJ", "title": "Titre court et percutant de l'actualité", "detail": "2 à 4 phrases détaillées et informatives : chiffres précis, dates, contexte, impact. En français." }
      ]
    }
  ]
}

Pour chaque titre du portefeuille, donne 2 à 4 actualités/événements les plus pertinents et récents, avec le maximum de détails concrets (chiffres, dates, pourcentages). Trie les items de chaque titre du plus récent au plus ancien. "date" est la date de l'actualité ou de l'événement (format AAAA-MM-JJ). N'inclus un titre que si tu as trouvé une information réelle et récente à son sujet.`;

            const text = await APIService.aiInsights(provider, prompt, AI_PROVIDERS[provider].usesLiveSearch);

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('Réponse IA non structurée (pas de JSON trouvé)');
            const parsed = JSON.parse(jsonMatch[0]);

            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            const sixMonthsAgoStr = Utils.getDateString(sixMonthsAgo);

            const groups = (parsed.portfolio || []).map(g => ({
                symbol: g.symbol,
                name: this.assetNameCache[g.symbol],
                items: (g.items || [])
                    .filter(it => !it.date || it.date >= sixMonthsAgoStr)
                    .slice()
                    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
            })).filter(g => g.items.length);

            const summaryHtml = parsed.summary ? this.renderInsightsSummary(parsed.summary) : '';
            let groupsHtml;
            let usedPlainFallback = false;
            if (groups.length) {
                groupsHtml = this.renderInsightsGroups(groups);
            } else {
                const plainGroups = await this.getPlainInsightsGroups(holdings);
                groupsHtml = this.renderInsightsGroups(plainGroups);
                usedPlainFallback = true;
            }

            const staleNoticeHtml = (AI_PROVIDERS[provider].usesLiveSearch || webContext)
                ? ''
                : `<div class="insights-stale-notice">⚠️ Aucune actualité web trouvée pour compléter ${AI_PROVIDERS[provider].label} : ces informations viennent des connaissances internes du modèle et peuvent dater de plusieurs mois.${usedPlainFallback ? ' Infos factuelles (sans IA) affichées à la place ci-dessous.' : ''}</div>`;

            const html = staleNoticeHtml + summaryHtml + groupsHtml;
            bodyEl.innerHTML = html;
            localStorage.setItem(CONFIG.INSIGHTS_CACHE_STORAGE, JSON.stringify({ cacheKey, timestamp: Date.now(), html }));
            this.setInsightsUpdatedAt(Date.now());
        } catch (err) {
            console.warn('Erreur résumé IA', err);
            const fallback = await this.buildPlainInsights(holdings);
            bodyEl.innerHTML = `<p style="color:var(--accent-red); font-size:12px;">Résumé IA indisponible (${Utils.escapeHtml(err.message)}). Résumé factuel affiché à la place :</p>` + fallback;
            this.setInsightsUpdatedAt(Date.now());
        }
    },

    async getPlainInsightsGroups(holdings) {
        const symbols = holdings.map(h => h.symbol);
        const [dividends, earnings] = await Promise.all([
            this.service.getUpcomingDividends(this.chartState.currency),
            this.service.getUpcomingEarnings()
        ]);
        const { gainers, losers } = this.service.getDailyMovers(this.chartState.currency);

        const bySymbol = {};
        const ensure = (symbol) => {
            if (!bySymbol[symbol]) bySymbol[symbol] = { symbol, name: this.assetNameCache[symbol], items: [] };
            return bySymbol[symbol];
        };

        const today = Utils.getDateString();

        [...gainers, ...losers].forEach(m => {
            ensure(m.symbol).items.push({
                date: today,
                title: `${m.dayChangePercent >= 0 ? '+' : ''}${m.dayChangePercent.toFixed(2)}% aujourd'hui`,
                detail: `Le titre ${m.symbol} évolue de ${m.dayChangePercent >= 0 ? '+' : ''}${m.dayChangePercent.toFixed(2)}% sur la séance.`
            });
        });

        earnings.forEach(e => {
            ensure(e.symbol).items.push({
                date: e.date,
                title: `Résultats prévus le ${Utils.formatDateDisplay(e.date)}`,
                detail: e.epsEstimate !== null ? `BPA (bénéfice par action) estimé par les analystes : ${e.epsEstimate}.` : ''
            });
        });

        dividends.forEach(d => {
            ensure(d.symbol).items.push({
                date: d.estimatedDate,
                title: `Dividende estimé le ${Utils.formatDateDisplay(d.estimatedDate)}`,
                detail: `Montant estimé : ${Utils.formatCurrency(d.amount, this.chartState.currency)}, sur la base du dernier versement connu et de la fréquence habituelle.`
            });
        });

        Object.values(bySymbol).forEach(g => g.items.sort((a, b) => (b.date || '').localeCompare(a.date || '')));

        return symbols.filter(s => bySymbol[s]).map(s => bySymbol[s]);
    },

    buildMonthlySummaryHtml() {
        const monthly = this.service.getMonthlyPerformanceSummary(this.chartState.currency);
        const sign = monthly.portfolioPercent >= 0 ? '+' : '';
        let summary = `Performance du portefeuille sur les 30 derniers jours : ${sign}${monthly.portfolioPercent.toFixed(2)}%.`;
        if (monthly.topGainers.length) {
            summary += ` Meilleure(s) performance(s) : ${monthly.topGainers.map(m => `${m.symbol} (+${m.changePercent.toFixed(2)}%)`).join(', ')}.`;
        }
        if (monthly.topLosers.length) {
            summary += ` Plus forte(s) baisse(s) : ${monthly.topLosers.map(m => `${m.symbol} (${m.changePercent.toFixed(2)}%)`).join(', ')}.`;
        }
        return `<div class="insights-summary">${Utils.escapeHtml(summary)}</div>`;
    },

    async buildPlainInsights(holdings) {
        const groups = await this.getPlainInsightsGroups(holdings);
        const noteHtml = '<div class="insights-plain-note">Résumé factuel généré sans IA. Ajoute une clé IA dans les paramètres pour une analyse complète.</div>';

        if (!groups.length) {
            return noteHtml;
        }

        return noteHtml + this.renderInsightsGroups(groups);
    },

    async refreshUpcomingEarnings() {
        const listEl = document.getElementById('upcomingEarningsList');
        if (!listEl) return;

        const items = await this.service.getUpcomingEarnings();

        listEl.innerHTML = items.length ? items.map(e => `
            <div class="perf-row">
                <img class="perf-logo" src="${this.getLogoUrl(e.symbol)}" alt=""
                    data-fallback="sibling">
                <span class="perf-logo-fallback" style="display:none;">${e.symbol.substring(0, 1)}</span>
                <span class="perf-ticker">${e.symbol}</span>
                <span style="flex:1; color:var(--text-secondary); font-size:13px;">${Utils.formatDateDisplay(e.date)}</span>
                <span style="width:110px; text-align:right; color:var(--text-secondary); font-size:12px;">${e.epsEstimate !== null ? `EPS est. ${e.epsEstimate}` : ''}</span>
            </div>
        `).join('') : '<p style="text-align:center; padding:12px; color:var(--text-secondary);">Aucune publication de résultats prévue dans les 90 prochains jours (actions US uniquement).</p>';
    },

    initProfitChart() {
        const canvas = document.getElementById('profitChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const ink = this.chartInk();
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(0, 211, 242, 0.30)');
        gradient.addColorStop(1, 'rgba(0, 211, 242, 0)');

        this.profitChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Profit',
                    data: [],
                    borderColor: ink.acc,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.15,
                    borderWidth: 2.2,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    pointRadius: 0,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (ctx) => Utils.formatCurrency(ctx.parsed.y, this.chartState.currency)
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { color: ink.tick, font: { size: 11 }, maxTicksLimit: 10 } },
                    y: {
                        position: 'right',
                        grid: { color: ink.grid, lineWidth: 1, drawTicks: false },
                        border: { display: false },
                        ticks: {
                            color: ink.tick,
                            font: { size: 11 },
                            callback: (value) => Utils.formatCurrency(value, this.chartState.currency)
                        }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    },

    renderProfitChart() {
        if (!this.profitChart) return;
        const curr = this.chartState.currency;
        const timeline = this.service.getHistoricalTimeline(this.chartState.profitRange, 'VALUE', curr);

        this.profitChart.data.labels = timeline.labels;
        this.profitChart.data.datasets[0].data = timeline.profitValues;
        const ink = this.chartInk();
        if (this.profitChart.options && this.profitChart.options.scales) {
            this.profitChart.options.scales.y.grid.color = ink.grid;
            this.profitChart.options.scales.y.ticks.color = ink.tick;
            this.profitChart.options.scales.x.ticks.color = ink.tick;
        }
        this.profitChart.update();

        if (timeline.profitRangeStats) {
            Object.entries(timeline.profitRangeStats).forEach(([rangeKey, val]) => {
                const el = document.querySelector(`[data-profit-range-val="${rangeKey}"]`);
                if (el) {
                    el.textContent = (val >= 0 ? '+' : '') + Utils.formatCurrency(val, curr);
                    el.className = `value ${val >= 0 ? 'text-green' : 'text-red'}`;
                }
            });
        }
    },

    renderYearlyTable() {
        const tbody = document.getElementById('yearlyTableBody');
        if (!tbody) return;

        const curr = this.chartState.currency;
        const perf = this.service.getYearlyPerformance(curr);
        const rows = perf.ytd ? [perf.ytd, ...perf.years] : perf.years;

        tbody.innerHTML = rows.length ? rows.map(r => {
            const isPositive = r.profit >= 0;
            return `
                <tr>
                    <td style="font-weight:600;">${r.label}</td>
                    <td class="${isPositive ? 'text-green' : 'text-red'}">${Utils.formatPercent(r.percent)}</td>
                    <td class="${isPositive ? 'text-green' : 'text-red'}">${isPositive ? '+' : ''}${Utils.formatCurrency(r.profit, curr)}</td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-secondary);">Aucune donnée.</td></tr>';
    },

    initAnalysisCharts() {
        const makeDoughnut = (canvasId) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return null;
            return new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: { legend: { display: false } }
                }
            });
        };

        this.assetChart = makeDoughnut('assetChart');
        this.classChart = makeDoughnut('classChart');
        this.currencyChart = makeDoughnut('currencyChart');
        this.sectorChart = makeDoughnut('sectorChart');
        this.sectorCache = this.sectorCache || {};
        this.initDonutCarousel();
    },

    initDonutCarousel() {
        const track = document.getElementById('donutCarousel');
        const dotsEl = document.getElementById('donutDots');
        if (!track || !dotsEl || dotsEl.children.length) return;

        const cards = Array.from(track.querySelectorAll('.analysis-card'));
        cards.forEach((_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            if (i === 0) b.classList.add('active');
            b.addEventListener('click', () => {
                cards[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            });
            dotsEl.appendChild(b);
        });

        let raf;
        track.addEventListener('scroll', () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
                let active = 0, best = Infinity;
                cards.forEach((c, i) => {
                    const r = c.getBoundingClientRect();
                    const d = Math.abs(r.left + r.width / 2 - mid);
                    if (d < best) { best = d; active = i; }
                });
                Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle('active', i === active));
            });
        }, { passive: true });
    },

    updateDoughnutChart(chart, legendId, totals, emptyLabel, centerConfig) {
        if (!chart) return;
        const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((sum, [, v]) => sum + v, 0);
        const colors = entries.map((_, i) => CONFIG.CHART_PALETTE[i % CONFIG.CHART_PALETTE.length]);

        chart.data.labels = entries.map(([label]) => label);
        chart.data.datasets[0].data = entries.map(([, v]) => v);
        chart.data.datasets[0].backgroundColor = colors;
        chart.update();

        const legendEl = document.getElementById(legendId);
        if (legendEl) {
            legendEl.innerHTML = entries.length ? entries.map(([label, v], i) => {
                const pct = total > 0 ? (v / total) * 100 : 0;
                return `
                    <li>
                        <span class="dot" style="background:${colors[i]};"></span>
                        <span class="label">${label}</span>
                        <span class="pct">${pct.toFixed(1)}%</span>
                    </li>
                `;
            }).join('') : `<li style="color:var(--text-secondary);">${emptyLabel || 'Aucune position active.'}</li>`;
        }

        if (centerConfig && centerConfig.el) {
            const el = centerConfig.el;
            if (!entries.length) {
                el.innerHTML = '';
            } else if (centerConfig.value !== undefined) {
                el.innerHTML = `<span class="ccl-value">${centerConfig.value}</span><span class="ccl-label">${centerConfig.label || ''}</span>`;
            } else {
                const [topLabel, topVal] = entries[0];
                const pct = total > 0 ? (topVal / total) * 100 : 0;
                el.innerHTML = `<span class="ccl-value">${pct.toFixed(0)}%</span><span class="ccl-label">${topLabel}</span>`;
            }
        }
    },

    renderAnalysisCharts(stats, curr) {
        const holdings = stats.holdings || [];

        const groupBy = (keyFn) => {
            const totals = {};
            holdings.forEach(h => {
                const key = keyFn(h);
                totals[key] = (totals[key] || 0) + h.valueUSD;
            });
            return totals;
        };

        const byAsset = groupBy(h => h.symbol);
        const byClass = groupBy(h => Utils.getAssetClass(h.symbol));
        const byCurrency = groupBy(h => h.currency);

        this.updateDoughnutChart(this.assetChart, 'assetLegend', byAsset, undefined, {
            el: document.getElementById('assetChartCenter'),
            value: Object.keys(byAsset).length,
            label: Object.keys(byAsset).length > 1 ? 'actifs' : 'actif'
        });
        this.updateDoughnutChart(this.classChart, 'classLegend', byClass, undefined, { el: document.getElementById('classChartCenter') });
        this.updateDoughnutChart(this.currencyChart, 'currencyLegend', byCurrency, undefined, { el: document.getElementById('currencyChartCenter') });

        this.refreshSectorChart(stats);
    },

    async refreshSectorChart(stats) {
        if (!this.sectorChart) return;
        const holdings = stats.holdings || [];
        this.sectorCache = this.sectorCache || {};

        const uniqueSymbols = [...new Set(holdings.map(h => h.symbol))].filter(s => !(s in this.sectorCache));
        if (uniqueSymbols.length) {
            await Promise.all(uniqueSymbols.map(async sym => {
                this.sectorCache[sym] = await APIService.getSector(sym);
            }));
        }

        const totals = {};
        holdings.forEach(h => {
            const sector = this.sectorCache[h.symbol] || 'Non disponible';
            totals[sector] = (totals[sector] || 0) + h.valueUSD;
        });

        this.updateDoughnutChart(this.sectorChart, 'sectorLegend', totals, 'Secteur indisponible (actions non-US).', { el: document.getElementById('sectorChartCenter') });
    },

    initChart() {
        const canvas = document.getElementById('portfolioChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const ink = this.chartInk();
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
        const gradient = ctx.createLinearGradient(0, 0, 0, 350);
        gradient.addColorStop(0, 'rgba(46, 189, 133, 0.34)');
        gradient.addColorStop(1, 'rgba(46, 189, 133, 0)');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Portefeuille',
                    data: [],
                    borderColor: ink.up,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.15,
                    borderWidth: 2.2,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    pointRadius: 0,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: isDesktop,
                        position: 'top',
                        align: 'end',
                        labels: {
                            boxWidth: 12,
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (ctx) => {
                                const label = ctx.dataset.label || '';
                                const val = ctx.parsed.y;
                                if (this.chartState.mode === 'PERF') {
                                    return `${label}: ${Utils.formatPercent(val)}`;
                                }
                                return `${label}: ${Utils.formatCurrency(val, this.chartState.currency)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { display: isDesktop, color: ink.tick, font: { size: 11 }, maxTicksLimit: 10 }
                    },
                    y: {
                        position: 'right',
                        grid: { color: ink.grid, lineWidth: 1, drawTicks: false },
                        border: { display: false },
                        ticks: {
                            display: isDesktop,
                            color: ink.tick,
                            font: { size: 11 },
                            callback: (value) => {
                                if (this.chartState.mode === 'PERF') return value.toFixed(1) + '%';
                                if (Math.abs(value) >= 1000) {
                                    return (value / 1000).toFixed(1) + 'k ' + (this.chartState.currency === 'EUR' ? '€' : '$');
                                }
                                return value.toFixed(0) + ' ' + (this.chartState.currency === 'EUR' ? '€' : '$');
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    },

    async updateChart(timelineData) {
        if (!this.chart || !timelineData) return;

        const isPerf = this.chartState.mode === 'PERF';
        const primaryData = isPerf ? timelineData.perfValues : timelineData.values;
        const activePort = this.service.getActivePortfolio();
        const ink = this.chartInk();
        const lineColor = ink.up; // ligne portefeuille : vert fixe (non thematise)

        this.chart.data.labels = timelineData.labels;

        const ctx = this.chart.ctx;
        const gradient = ctx.createLinearGradient(0, 0, 0, 350);
        gradient.addColorStop(0, 'rgba(46, 189, 133, 0.34)');
        gradient.addColorStop(1, 'rgba(46, 189, 133, 0)');

        const lastIdx = (primaryData ? primaryData.length : 0) - 1;

        this.chart.data.datasets = [{
            label: activePort.name,
            data: primaryData,
            borderColor: lineColor,
            backgroundColor: isPerf ? 'transparent' : gradient,
            fill: !isPerf,
            tension: 0.15,
            borderWidth: 2.2,
            borderCapStyle: 'round',
            borderJoinStyle: 'round',
            pointRadius: (c) => c.dataIndex === lastIdx ? 3.4 : 0,
            pointBackgroundColor: lineColor,
            pointBorderColor: 'rgba(46, 189, 133, 0.16)',
            pointBorderWidth: 6,
            pointHoverRadius: 5,
            yAxisID: 'y'
        }];

        // Rafraichir les couleurs d'axes (suivi du theme)
        if (this.chart.options && this.chart.options.scales) {
            this.chart.options.scales.y.grid.color = ink.grid;
            this.chart.options.scales.y.ticks.color = ink.tick;
            this.chart.options.scales.x.ticks.color = ink.tick;
        }

        const benchmarks = this.chartState.benchmarks || [];
        const rawDates = timelineData.rawDates || [];

        if (benchmarks.length > 0 && rawDates.length > 0) {
            const startDate = Utils.parseDate(rawDates[0]);
            const endDate = Utils.parseDate(rawDates[rawDates.length - 1]);

            const benchHistories = await Promise.all(benchmarks.map(async symbol => {
                const benchConfig = CONFIG.BENCHMARKS[symbol];
                if (!benchConfig) return null;
                const history = await APIService.getDailyHistory(symbol, startDate, endDate, benchConfig.basePrice, benchConfig.basePrice);
                return { symbol, benchConfig, history };
            }));

            benchHistories.forEach(entry => {
                if (!entry) return;
                const { benchConfig, history } = entry;
                const sortedDates = Object.keys(history).sort();
                if (sortedDates.length === 0) return;

                // Forward-fill : le marche ne cote pas tous les jours calendaires (weekends, feries)
                let lastKnown = null;
                const rawSeries = rawDates.map(dateStr => {
                    if (history[dateStr] !== undefined) {
                        lastKnown = history[dateStr];
                    } else {
                        const prior = sortedDates.filter(d => d <= dateStr).pop();
                        if (prior !== undefined) lastKnown = history[prior];
                    }
                    return lastKnown;
                });

                const baseline = rawSeries.find(v => v !== null && v !== undefined);
                const bData = isPerf
                    ? rawSeries.map(v => (v === null || v === undefined || !baseline) ? null : parseFloat((((v / baseline) - 1) * 100).toFixed(2)))
                    : rawSeries;

                this.chart.data.datasets.push({
                    label: benchConfig.name,
                    data: bData,
                    borderColor: ink.tick,
                    borderDash: [4, 4],
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.15,
                    borderWidth: 1.4,
                    pointRadius: 0,
                    yAxisID: 'y',
                    spanGaps: true
                });
            });
        }

        this.chart.update();
    },

    // ===== EXPLORER / ANALYSE D'UNE VALEUR =====
    initResearch() {
        const input = document.getElementById('researchSearchInput');
        const suggest = document.getElementById('researchSuggest');
        if (!input || this._researchReady) return;
        this._researchReady = true;

        let t, lastResults = [];
        const closeSuggest = () => { suggest.hidden = true; suggest.innerHTML = ''; };

        const renderSuggest = (results) => {
            lastResults = results || [];
            if (!lastResults.length) { closeSuggest(); return; }
            suggest.innerHTML = lastResults.slice(0, 8).map((item, i) => {
                const sym = item.displaySymbol || item.symbol;
                return `<div class="rs-row${i === 0 ? ' active' : ''}" data-sym="${sym}">
                    <img src="${this.getLogoUrl(sym)}" alt="" data-fallback="hide">
                    <span class="rs-txt"><span class="rs-sym">${sym}</span><span class="rs-desc">${(item.description || sym)} · ${Utils.getExchangeName(sym)}</span></span>
                </div>`;
            }).join('');
            suggest.hidden = false;
        };

        input.addEventListener('input', () => {
            const q = input.value.trim();
            clearTimeout(t);
            if (q.length < 1) { closeSuggest(); return; }
            t = setTimeout(async () => {
                const results = await APIService.searchSymbol(q);
                renderSuggest(results);
            }, 250);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const pick = lastResults[0];
                const sym = pick ? (pick.displaySymbol || pick.symbol) : input.value.trim().toUpperCase();
                if (sym) { closeSuggest(); this.runResearch(sym); }
            } else if (e.key === 'Escape') {
                closeSuggest();
            }
        });
        input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
        suggest.addEventListener('mousedown', (e) => {
            const row = e.target.closest('.rs-row');
            if (row) { closeSuggest(); this.runResearch(row.dataset.sym); }
        });

        document.getElementById('researchQuick').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-sym]');
            if (btn) this.runResearch(btn.dataset.sym);
        });

        document.getElementById('researchRange').querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#researchRange .range-btn').forEach(b => b.classList.toggle('active', b === btn));
                this.chartState.researchRange = btn.dataset.range || '1Y';
                if (this.researchSymbol) this.renderResearchChart(this.researchSymbol);
            });
        });

        const addBtn = document.getElementById('researchAddBtn');
        if (addBtn) addBtn.onclick = () => {
            (document.getElementById('addTransactionBtn') || document.getElementById('addTransactionFab'))?.click();
            setTimeout(() => {
                const si = document.getElementById('symbolInputField');
                if (si && this.researchSymbol) { si.value = this.researchSymbol; si.dispatchEvent(new Event('blur')); }
            }, 60);
        };
    },

    // Depuis une position détenue -> ouvre l'onglet Explorer sur cette valeur.
    goToResearch(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return;
        this.researchSymbol = symbol;
        document.querySelector('.tab-btn[data-tab="research"]')?.click();
        this.runResearch(symbol);
    },

    onResearchTabShown() {
        this.renderResearchQuick();
        if (this.researchSymbol) { if (this.researchChart) this.researchChart.resize(); return; }
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const top = (stats.holdings || []).slice().sort((a, b) => b.valueUSD - a.valueUSD)[0];
        if (top) this.runResearch(top.symbol);
    },

    renderResearchQuick() {
        const wrap = document.getElementById('researchQuick');
        if (!wrap) return;
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const syms = (stats.holdings || []).slice().sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 6).map(h => h.symbol);
        wrap.innerHTML = syms.map(s => `<button type="button" data-sym="${s}">${s}</button>`).join('');
    },

    perSymbolRealized(symbol) {
        const trades = this.service.getSortedTrades().filter(t => t.symbol === symbol);
        let q = 0, cost = 0, realized = 0, dividends = 0;
        for (const t of trades) {
            if (t.type === 'BUY') { q += t.qty; cost += t.qty * t.price; }
            else if (t.type === 'SELL') {
                const sq = Math.min(t.qty, q);
                if (sq > 0) { const c = (cost / q) * sq; realized += sq * t.price - c; q -= sq; cost -= c; if (q <= 1e-6) { q = 0; cost = 0; } }
            } else if (t.type === 'DIVIDEND') { dividends += t.amount || 0; }
        }
        return { realized, dividends };
    },

    async runResearch(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return;
        this.researchSymbol = symbol;

        document.getElementById('researchEmpty').hidden = true;
        document.getElementById('researchContent').hidden = false;
        const input = document.getElementById('researchSearchInput');
        if (input) input.value = '';

        const cur = Utils.getCurrency(symbol);
        document.getElementById('researchSymbol').textContent = symbol;
        document.getElementById('researchName').textContent = this.assetNameCache[symbol] || 'Chargement…';
        document.getElementById('researchMeta').textContent = '';
        document.getElementById('researchLogo').src = this.getLogoUrl(symbol);
        document.getElementById('researchLogo').style.visibility = '';

        const [fund, earn, name] = await Promise.all([
            APIService.getFundamentals(symbol),
            APIService.getEarnings(symbol).catch(() => null),
            (this.assetNameCache[symbol] !== undefined ? Promise.resolve(this.assetNameCache[symbol]) : this.fetchAssetName(symbol))
        ]);
        this.assetNameCache[symbol] = name;
        if (this.researchSymbol !== symbol) return; // course annulee entre-temps

        const price = (fund && fund.price != null) ? fund.price : await APIService.getCurrentPrice(symbol);
        const displayName = (fund && fund.name) || name || symbol;

        document.getElementById('researchName').textContent = displayName;
        document.getElementById('researchMeta').textContent = [fund && fund.exchange, cur].filter(Boolean).join(' · ');
        document.getElementById('researchPrice').textContent = Utils.formatCurrency(price, cur);

        const chgEl = document.getElementById('researchChange');
        const pc = fund && fund.previousClose;
        if (pc && price) {
            const chg = price - pc, chgPct = (chg / pc) * 100;
            chgEl.textContent = `${chg >= 0 ? '+' : ''}${Utils.formatCurrency(chg, cur)} (${Utils.formatPercent(chgPct)})`;
            chgEl.className = `research-price-chg ${chg >= 0 ? 'text-green' : 'text-red'}`;
        } else {
            chgEl.textContent = '';
        }

        this.renderResearchPosition(symbol, cur, price);
        this.renderResearchKey(fund, cur, price);
        this.renderResearchAbout(fund, earn);
        await this.renderResearchChart(symbol);
        this.renderResearchNews(symbol, displayName);
        this.renderResearchQuick();
        lucide.createIcons();

        // Analyse approfondie (phases 2+) : chargee en arriere-plan pour ne pas
        // retarder l'affichage des sections rapides ci-dessus.
        this.renderResearchValuation(null);
        this.renderResearchGrowth(null);
        this.renderResearchHealth(null);
        this.renderResearchProfitability(null);
        this.renderResearchSentiment(null);
        this.renderResearchTechnical(null);
        this.renderResearchDividend(null);
        this.researchAnalysis = null;
        AnalysisService.build(symbol).then(a => {
            if (this.researchSymbol !== symbol || !a) return;
            this.researchAnalysis = a;
            this.renderResearchValuation(a);
            this.renderResearchGrowth(a);
            this.renderResearchHealth(a);
            this.renderResearchProfitability(a);
            this.renderResearchSentiment(a);
            this.renderResearchTechnical(a);
            this.renderResearchDividend(a);
            this.applyResearchMaOverlay();
        }).catch(e => console.warn('AnalysisService.build KO', e));
    },

    // Ancre la bulle a gauche ou a droite du "i" si la version centree sortirait de la carte.
    _placeTip(el) {
        el.classList.remove('tip-end', 'tip-start');
        const box = el.closest('.card');
        if (!box) return;
        const r = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const half = 124;   // demi-largeur max de la bulle (240px) + marge
        const c = r.left + r.width / 2;
        if (c + half > b.right) el.classList.add('tip-end');
        else if (c - half < b.left) el.classList.add('tip-start');
    },

    // Petit "i" d'aide reutilisable pour toutes les nouvelles metriques.
    _kvHelp(tip) {
        return `<span class="kv-help" tabindex="0" aria-label="${String(tip).replace(/"/g, '&quot;')}" data-tip="${String(tip).replace(/"/g, '&quot;')}">i</span>`;
    },

    renderResearchValuation(a) {
        const card = document.getElementById('researchValuationCard');
        const grid = document.getElementById('researchValuationGrid');
        const src = document.getElementById('researchValuationSrc');
        if (!card || !grid) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            return;
        }

        const v = a.valuation || {};
        const h = v.hist5y || {};
        const ND = 'Non disponible';
        const mult = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x) + ' ×';

        const kv = (label, valueStr, tip, cmpHtml = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${cmpHtml}</div>`;

        // Repere visuel : valeur courante vs moyenne 5 ans du titre.
        const cmp = (cur, avg) => {
            if (cur == null || avg == null || !isFinite(cur) || !isFinite(avg) || avg <= 0) return '';
            const above = cur > avg;
            return `<span class="kv-cmp ${above ? 'above' : 'below'}">${above ? '▲' : '▼'} ` +
                `${above ? 'au-dessus' : 'sous'} la moy. 5 ans (${mult(avg)})</span>`;
        };

        grid.innerHTML =
            kv('PER (TTM)', mult(v.peTTM),
                'Cours rapporté au bénéfice par action des 12 derniers mois. Plus il est élevé, plus le marché paie cher chaque euro de bénéfice.',
                cmp(v.peTTM, h.pe)) +
            kv('PER prévisionnel', mult(v.peForward),
                'Cours rapporté au bénéfice par action attendu sur les 12 prochains mois. Nettement sous le PER TTM : le marché anticipe une hausse des bénéfices.') +
            kv('PEG', mult(v.peg),
                'PER divisé par la croissance attendue du bénéfice. Sous 1 : la croissance n\'est pas encore payée ; au-dessus de 2 : valorisation tendue.') +
            kv('P/B', mult(v.pb),
                'Cours rapporté à la valeur comptable des capitaux propres. Pertinent surtout pour les sociétés à forts actifs (banques, industrie).',
                cmp(v.pb, h.pb)) +
            kv('P/S', mult(v.ps),
                'Cours rapporté au chiffre d\'affaires par action. Utile pour comparer des sociétés peu ou pas bénéficiaires.',
                cmp(v.ps, h.ps)) +
            kv('VE / EBITDA', mult(v.evEbitda),
                'Valeur d\'entreprise (capitalisation + dette nette) sur l\'EBITDA. Comparable entre sociétés à endettement différent ; repère 8-12 pour une société mûre.',
                cmp(v.evEbitda, h.evEbitda)) +
            kv('VE / CA', mult(v.evRevenue),
                'Valeur d\'entreprise sur le chiffre d\'affaires. Alternative au P/S qui tient compte de la dette.') +
            kv('Rendement FCF', v.fcfYield == null ? null : Utils.formatPercent(v.fcfYield, false),
                'Free cash flow annuel rapporté à la capitalisation : le rendement de trésorerie réelle dégagée. Au-dessus de 5 % est confortable.');

        if (src) {
            const hasHist = [h.pe, h.pb, h.ps, h.evEbitda].some(x => x != null);
            src.textContent = hasHist
                ? 'Yahoo Finance · moyennes 5 ans FMP'
                : (a.isUS ? 'Yahoo Finance · historique 5 ans indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Historique annuel en barres (CA, BPA) : echelle sur la plus grande valeur absolue,
    // variation d'une annee sur l'autre affichee a droite.
    _growthSeries(title, points, fmt, tip) {
        const vals = (points || []).map(p => p.value).filter(v => v != null && isFinite(v));
        const head = `<div class="gs-title">${title} ${this._kvHelp(tip)}</div>`;
        if (!vals.length) return `<div class="gs-block">${head}<div class="gs-empty">Non disponible</div></div>`;

        const max = Math.max(...vals.map(Math.abs)) || 1;
        const rows = points.map((p, i) => {
            const prev = i > 0 ? points[i - 1].value : null;
            let yoy = '<span class="gs-yoy"></span>';
            if (p.value != null && prev != null && prev > 0) {
                const g = (p.value - prev) / prev * 100;
                yoy = `<span class="gs-yoy ${g >= 0 ? 'up' : 'dn'}">${Utils.formatPercent(g)}</span>`;
            }
            const w = p.value == null ? 0 : Math.max(2, Math.abs(p.value) / max * 100);
            return `<div class="gs-row"><span class="gs-year">${p.year || '—'}</span>` +
                `<span class="gs-bar-wrap"><span class="gs-bar${p.value < 0 ? ' neg' : ''}" style="width:${w.toFixed(1)}%"></span></span>` +
                `<span class="gs-val">${p.value == null ? '—' : fmt(p.value)}</span>${yoy}</div>`;
        }).join('');
        return `<div class="gs-block">${head}${rows}</div>`;
    },

    renderResearchGrowth(a) {
        const card = document.getElementById('researchGrowthCard');
        const grid = document.getElementById('researchGrowthGrid');
        const series = document.getElementById('researchGrowthSeries');
        const src = document.getElementById('researchGrowthSrc');
        if (!card || !grid || !series) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            series.innerHTML = '';
            return;
        }

        const g = a.growth || {};
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x);
        const money = (x) => Utils.formatCompact(x, cur);
        const eps = (x) => Utils.formatCurrency(x, cur);

        const kv = (label, valueStr, tip) =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span></div>`;

        // Consensus : estimations annuelles FMP en priorite, sinon l'exercice +1 de Yahoo.
        const estAnnual = AnalysisUtils.arr(g.estimates);
        const lastRevYear = Number((AnalysisUtils.arr(g.revenueAnnual).slice(-1)[0] || {}).year) || 0;
        const nextEst = estAnnual.find(e => Number(e.year) > lastRevYear) || estAnnual[estAnnual.length - 1] || null;
        const yahooY1 = AnalysisUtils.arr(g.estimatesShortTerm).find(e => e.period === '+1y') || null;
        const estRev = (nextEst && nextEst.revenueAvg != null) ? nextEst.revenueAvg : (yahooY1 ? yahooY1.revenueAvg : null);
        const estEps = (nextEst && nextEst.epsAvg != null) ? nextEst.epsAvg : (yahooY1 ? yahooY1.epsAvg : null);
        const estYear = (nextEst && nextEst.year) || (yahooY1 && yahooY1.endDate ? String(yahooY1.endDate).slice(0, 4) : null);
        const analysts = g.analystCount != null ? g.analystCount
            : (nextEst && nextEst.analysts != null ? nextEst.analysts : (yahooY1 ? yahooY1.analysts : null));

        grid.innerHTML =
            kv('TCAC CA 5 ans', pct(g.revenueCagrPct),
                'Taux de croissance annuel moyen du chiffre d\'affaires sur 5 ans. Lisse les à-coups d\'une année isolée.') +
            kv('TCAC BPA 5 ans', pct(g.epsCagrPct),
                'Taux de croissance annuel moyen du bénéfice par action sur 5 ans. Au-dessus du TCAC du CA : les marges progressent.') +
            kv('Croissance CA (1 an)', pct(g.revenueGrowthYoyPct),
                'Variation du chiffre d\'affaires sur les 12 derniers mois par rapport aux 12 précédents.') +
            kv('Croissance BPA (1 an)', pct(g.epsGrowthYoyPct),
                'Variation du bénéfice par action sur les 12 derniers mois. Plus volatile que le CA (effets exceptionnels, rachats d\'actions).') +
            kv(`CA attendu${estYear ? ' ' + estYear : ''}`, estRev == null ? null : money(estRev),
                'Chiffre d\'affaires moyen attendu par les analystes pour le prochain exercice. Une prévision, pas un engagement.') +
            kv(`BPA attendu${estYear ? ' ' + estYear : ''}`, estEps == null ? null : eps(estEps),
                'Bénéfice par action moyen attendu par les analystes pour le prochain exercice. Sert de base au PER prévisionnel.') +
            kv('Analystes suivis', analysts == null ? null : String(Math.round(analysts)),
                'Nombre d\'analystes couvrant la valeur. Sous 5, le consensus est fragile et peut bouger fortement.') +
            kv('Guidance direction', g.guidance,
                'Objectifs communiqués par la direction. Non fournis par les sources gratuites utilisées ici : à vérifier dans le communiqué de résultats.');

        series.innerHTML =
            this._growthSeries('Chiffre d\'affaires', AnalysisUtils.arr(g.revenueAnnual), money,
                'Chiffre d\'affaires annuel publié sur les 5 derniers exercices. La barre est proportionnelle au plus haut de la période.') +
            this._growthSeries('Bénéfice par action', AnalysisUtils.arr(g.epsAnnual), eps,
                'Bénéfice par action annuel publié sur les 5 derniers exercices. Une barre rouge signale un exercice en perte.');

        if (src) {
            const hasHist = AnalysisUtils.arr(g.revenueAnnual).some(p => p.value != null);
            src.textContent = hasHist
                ? 'FMP · consensus analystes Yahoo Finance'
                : (a.isUS ? 'Historique annuel indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Seuils de lecture rapide des ratios de solidite financiere.
    // Volontairement explicites et ajustables : [borne "confortable", borne "vigilance"].
    // `dir` = 'high' quand une valeur elevee est bonne, 'low' quand elle est mauvaise.
    _healthFlag(value, ok, warn, dir) {
        if (value == null || !isFinite(value)) return '';
        const good = dir === 'high' ? value >= ok : value <= ok;
        const bad = dir === 'high' ? value < warn : value > warn;
        const cls = good ? 'ok' : (bad ? 'warn' : 'mid');
        const txt = good ? 'confortable' : (bad ? 'vigilance' : 'correct');
        return `<span class="kv-tag ${cls}">${txt}</span>`;
    },

    renderResearchHealth(a) {
        const card = document.getElementById('researchHealthCard');
        const grid = document.getElementById('researchHealthGrid');
        const series = document.getElementById('researchHealthSeries');
        const src = document.getElementById('researchHealthSrc');
        if (!card || !grid || !series) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            series.innerHTML = '';
            return;
        }

        const h = a.health || {};
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const money = (x) => Utils.formatCompact(x, cur);
        const ratio = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
        const mult = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x) + ' ×';

        const kv = (label, valueStr, tip, tag = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${tag}</div>`;

        const netDebt = (h.totalDebt != null && h.totalCash != null) ? h.totalDebt - h.totalCash : null;

        grid.innerHTML =
            kv('Dette nette / EBITDA', mult(h.netDebtToEbitda),
                'Nombre d\'années d\'EBITDA nécessaires pour rembourser la dette nette. Sous 1 : très solide ; au-dessus de 3 : endettement lourd.',
                this._healthFlag(h.netDebtToEbitda, 1, 3, 'low')) +
            kv('Dette / Capitaux propres', ratio(h.debtToEquity),
                'Dette rapportée aux capitaux propres. Au-dessus de 2, la société dépend fortement de ses créanciers (normal pour les banques et les utilities).',
                this._healthFlag(h.debtToEquity, 1, 2, 'low')) +
            kv('Liquidité générale', ratio(h.currentRatio),
                'Actifs courants divisés par les dettes à moins d\'un an. Sous 1, la trésorerie court terme peut manquer.',
                this._healthFlag(h.currentRatio, 1.5, 1, 'high')) +
            kv('Liquidité réduite', ratio(h.quickRatio),
                'Même calcul en excluant les stocks, plus difficiles à transformer en cash. Sous 1 : dépendance aux ventes de stocks.',
                this._healthFlag(h.quickRatio, 1, 0.7, 'high')) +
            kv('Couverture des intérêts', mult(h.interestCoverage),
                'Résultat d\'exploitation divisé par les intérêts payés. Sous 3, la charge de la dette pèse ; au-dessus de 8, elle est indolore.',
                this._healthFlag(h.interestCoverage, 8, 3, 'high')) +
            kv('Trésorerie', h.totalCash == null ? null : money(h.totalCash),
                'Trésorerie et placements court terme au dernier bilan publié.') +
            kv('Dette totale', h.totalDebt == null ? null : money(h.totalDebt),
                'Dettes financières court et long terme au dernier bilan publié.') +
            kv('Dette nette', netDebt == null ? null : money(netDebt),
                'Dette totale moins la trésorerie. Négative : la société a plus de cash que de dettes.',
                netDebt == null ? '' : `<span class="kv-tag ${netDebt <= 0 ? 'ok' : 'mid'}">${netDebt <= 0 ? 'trésorerie nette' : 'endettée'}</span>`);

        const trendLabel = { croissant: 'en hausse', stable: 'stable', 'décroissant': 'en baisse' }[h.fcfTrend] || null;
        series.innerHTML = this._growthSeries(
            `Flux de trésorerie disponible${trendLabel ? ' — ' + trendLabel : ''}`,
            AnalysisUtils.arr(h.fcfHistory), money,
            'Cash restant après investissements sur les 5 derniers exercices. C\'est lui qui finance dividendes, rachats d\'actions et remboursement de dette.'
        );

        if (src) {
            const hasFcf = AnalysisUtils.arr(h.fcfHistory).some(p => p.value != null);
            src.textContent = hasFcf
                ? 'FMP · Yahoo Finance'
                : (a.isUS ? 'Historique de trésorerie indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Courbe miniature (SVG inline, compatible CSP) d'une serie annuelle.
    _sparkline(points) {
        const pts = AnalysisUtils.arr(points).filter(p => p.value != null && isFinite(p.value));
        if (pts.length < 2) return '';
        const w = 104, h = 26, pad = 3;
        const vals = pts.map(p => p.value);
        const min = Math.min(...vals);
        const span = (Math.max(...vals) - min) || 1;
        const coords = pts.map((p, i) => {
            const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
            const y = h - pad - ((p.value - min) / span) * (h - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${coords}"/></svg>`;
    },

    // Ligne "marge X : courbe 5 ans + niveau actuel + variation en points de %".
    _sparkRow(label, points, tip) {
        const pts = AnalysisUtils.arr(points).filter(p => p.value != null && isFinite(p.value));
        const head = `<span class="spark-lab">${label} ${this._kvHelp(tip)}</span>`;
        if (pts.length < 2) {
            return `<div class="spark-row">${head}<span class="spark-empty">Non disponible</span></div>`;
        }
        const first = pts[0].value;
        const last = pts[pts.length - 1].value;
        const d = last - first;
        const delta = `${d >= 0 ? '+' : '−'}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Math.abs(d))} pts`;
        return `<div class="spark-row">${head}${this._sparkline(pts)}` +
            `<span class="spark-val">${Utils.formatPercent(last, false)}</span>` +
            `<span class="spark-delta ${d >= 0 ? 'up' : 'dn'}" title="${pts[0].year} → ${pts[pts.length - 1].year}">${delta}</span></div>`;
    },

    renderResearchProfitability(a) {
        const card = document.getElementById('researchProfitCard');
        const grid = document.getElementById('researchProfitGrid');
        const sparks = document.getElementById('researchProfitSparks');
        const src = document.getElementById('researchProfitSrc');
        if (!card || !grid || !sparks) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            sparks.innerHTML = '';
            return;
        }

        const p = a.profitability || {};
        const mh = p.marginHistory || {};
        const ND = 'Non disponible';
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x, false);

        const kv = (label, valueStr, tip, tag = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${tag}</div>`;

        grid.innerHTML =
            kv('ROE', pct(p.roe),
                'Résultat net rapporté aux capitaux propres : ce que la société génère avec l\'argent des actionnaires. Au-dessus de 15 % durablement, c\'est solide.',
                this._healthFlag(p.roe, 15, 8, 'high')) +
            kv('ROA', pct(p.roa),
                'Résultat net rapporté au total du bilan : rentabilité de l\'ensemble des actifs, dette comprise. Moins flatteur que le ROE mais moins manipulable.',
                this._healthFlag(p.roa, 8, 3, 'high')) +
            kv('ROIC', pct(p.roic),
                'Rentabilité du capital réellement investi (dette + fonds propres). S\'il dépasse durablement le coût du capital (~8-10 %), la société crée de la valeur.',
                this._healthFlag(p.roic, 12, 6, 'high')) +
            kv('Marge brute', pct(p.grossMargin),
                'Part du chiffre d\'affaires restante après le coût de production. Une marge brute élevée et stable est un bon indice de pouvoir de fixation des prix.') +
            kv('Marge opérationnelle', pct(p.operatingMargin),
                'Part du chiffre d\'affaires restante après tous les coûts d\'exploitation. Mesure l\'efficacité du métier, hors dette et impôts.') +
            kv('Marge nette', pct(p.netMargin),
                'Part du chiffre d\'affaires qui finit en résultat net, une fois tout payé.');

        sparks.innerHTML =
            this._sparkRow('Marge brute (5 ans)', mh.gross,
                'Évolution de la marge brute sur les 5 derniers exercices. En hausse : les prix ou le mix produit s\'améliorent.') +
            this._sparkRow('Marge opérationnelle (5 ans)', mh.operating,
                'Évolution de la marge opérationnelle sur 5 ans. Une érosion continue signale une pression concurrentielle ou des coûts qui dérapent.') +
            this._sparkRow('Marge nette (5 ans)', mh.net,
                'Évolution de la marge nette sur 5 ans. Variation exprimée en points de pourcentage entre le premier et le dernier exercice.');

        if (src) {
            const hasHist = AnalysisUtils.arr(mh.net).some(x => x.value != null);
            src.textContent = hasHist
                ? 'Yahoo Finance · historique de marges FMP'
                : (a.isUS ? 'Yahoo Finance · historique de marges indisponible' : 'Historique complet : actions US uniquement');
        }
    },

    // Repartition des recommandations analystes en barre empilee + legende chiffree.
    _consensusBar(c) {
        const defs = [
            ['sb', 'Achat fort', 'strongBuy'], ['b', 'Achat', 'buy'], ['h', 'Conserver', 'hold'],
            ['s', 'Vente', 'sell'], ['ss', 'Vente forte', 'strongSell']
        ];
        const vals = defs.map(([cls, lab, key]) => ({ cls, lab, n: Number(c && c[key]) || 0 }));
        const total = vals.reduce((s, v) => s + v.n, 0);
        const head = `<div class="sent-title">Recommandations des analystes ${this._kvHelp('Nombre d\'analystes derrière chaque recommandation. Un consensus très majoritairement à l\'achat est souvent déjà intégré dans le cours.')}</div>`;
        if (!total) return `<div class="sent-block">${head}<div class="sent-empty">Non disponible</div></div>`;
        const bar = vals.map(v => v.n
            ? `<span class="cons-seg ${v.cls}" style="width:${(v.n / total * 100).toFixed(1)}%" title="${v.lab} : ${v.n}"></span>`
            : '').join('');
        const legend = vals.filter(v => v.n).map(v =>
            `<span class="cons-leg"><span class="cons-dot cons-seg ${v.cls}"></span>${v.lab} <b>${v.n}</b></span>`).join('');
        return `<div class="sent-block">${head}<div class="cons-bar">${bar}</div>` +
            `<div class="cons-legend">${legend}</div></div>`;
    },

    // Echelle objectif bas / moyen / haut, avec le cours actuel positionne dessus.
    _ptScale(s, price, cur) {
        const head = `<div class="sent-title">Objectif de cours à 12 mois ${this._kvHelp('Fourchette des objectifs publiés par les analystes. Le repère clair est le cours actuel, le repère cyan l\'objectif moyen.')}</div>`;
        const lo = s.targetLow, hi = s.targetHigh, avg = s.targetMean;
        if (lo == null || hi == null || hi <= lo) {
            return `<div class="sent-block">${head}<div class="sent-empty">Non disponible</div></div>`;
        }
        const min = Math.min(lo, price != null ? price : lo);
        const max = Math.max(hi, price != null ? price : hi);
        const span = (max - min) || 1;
        const pos = (v) => ((v - min) / span * 100);
        const money = (v) => Utils.formatCurrency(v, cur);
        const marks =
            `<span class="pt-span" style="left:${pos(lo).toFixed(1)}%;width:${(pos(hi) - pos(lo)).toFixed(1)}%"></span>` +
            (price != null ? `<span class="pt-mark cur" style="left:${pos(price).toFixed(1)}%" title="Cours actuel ${money(price)}"></span>` : '') +
            (avg != null ? `<span class="pt-mark avg" style="left:${pos(avg).toFixed(1)}%" title="Objectif moyen ${money(avg)}"></span>` : '');
        return `<div class="sent-block">${head}<div class="pt-track">${marks}</div>` +
            `<div class="pt-legend"><span>Bas <b>${money(lo)}</b></span>` +
            `<span>Moyen <b>${avg == null ? '—' : money(avg)}</b></span>` +
            `<span>Haut <b>${money(hi)}</b></span></div></div>`;
    },

    renderResearchSentiment(a) {
        const card = document.getElementById('researchSentimentCard');
        const grid = document.getElementById('researchSentimentGrid');
        const top = document.getElementById('researchSentimentTop');
        const src = document.getElementById('researchSentimentSrc');
        if (!card || !grid || !top) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            top.innerHTML = '';
            return;
        }

        const s = a.sentiment || {};
        const price = (a.price && a.price.current) != null ? a.price.current : null;
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const money = (x) => (x == null || !isFinite(x)) ? null : Utils.formatCurrency(x, cur);
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x, false);
        const num1 = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);

        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;

        // Consensus : libelle Yahoo si present, sinon deduit de la note moyenne (1 = achat fort, 5 = vente forte).
        const keyMap = {
            strong_buy: 'Achat fort', buy: 'Achat', hold: 'Conserver',
            underperform: 'Sous-performance', sell: 'Vente', strong_sell: 'Vente forte'
        };
        const m = s.recommendationMean;
        let consLabel = keyMap[s.recommendationKey] || null;
        if (!consLabel && m != null) {
            consLabel = m <= 1.5 ? 'Achat fort' : (m <= 2.5 ? 'Achat' : (m <= 3.5 ? 'Conserver' : (m <= 4.5 ? 'Vente' : 'Vente forte')));
        }
        let consTag = '';
        if (m != null) {
            const cls = m <= 2.5 ? 'ok' : (m <= 3.5 ? 'mid' : 'warn');
            consTag = `<span class="kv-tag ${cls}">${cls === 'ok' ? 'favorable' : (cls === 'mid' ? 'neutre' : 'défavorable')}</span>`;
        }
        if (consLabel && s.analystCount != null) consLabel += ` (${s.analystCount} analystes)`;

        // Potentiel = ecart entre l'objectif moyen et le cours actuel.
        const upside = (s.targetMean != null && price) ? (s.targetMean - price) / price * 100 : null;
        const upsideTag = upside == null ? ''
            : `<span class="kv-cmp ${upside >= 0 ? 'up' : 'dn'}">potentiel ${Utils.formatPercent(upside)}</span>`;

        const shortPct = s.shortPercentOfFloat;
        const shortTag = (shortPct == null) ? ''
            : `<span class="kv-tag ${shortPct < 5 ? 'ok' : (shortPct <= 10 ? 'mid' : 'warn')}">` +
              `${shortPct < 5 ? 'faible' : (shortPct <= 10 ? 'modérée' : 'élevée')}</span>`;

        const ins = s.insider;
        let insStr = null, insTag = '';
        if (ins && (ins.bought || ins.sold)) {
            insStr = `${Utils.formatCompact(ins.net)} titres`;
            insTag = `<span class="kv-cmp ${ins.net >= 0 ? 'up' : 'dn'}">` +
                `${Utils.formatCompact(ins.bought)} achetés / ${Utils.formatCompact(ins.sold)} vendus</span>`;
        }

        top.innerHTML = this._consensusBar(s.consensus) + this._ptScale(s, price, cur);

        grid.innerHTML =
            kv('Consensus analystes', consLabel,
                'Recommandation majoritaire des analystes qui suivent la valeur. Indicatif : le consensus est souvent en retard sur le marché.',
                consTag) +
            kv('Note moyenne', m == null ? null : `${num1(m)} / 5`,
                'Moyenne des recommandations sur une échelle de 1 (achat fort) à 5 (vente forte). Sous 2,5 le consensus est acheteur.') +
            kv('Objectif moyen', money(s.targetMean),
                'Moyenne des objectifs de cours à 12 mois. À relativiser : les objectifs sont révisés après coup, rarement avant.',
                upsideTag) +
            kv('Objectif médian', money(s.targetMedian),
                'Objectif du milieu de la fourchette : moins sensible qu\'une moyenne aux prévisions extrêmes.') +
            kv('Fourchette d\'objectifs', (s.targetLow == null || s.targetHigh == null) ? null : `${money(s.targetLow)} – ${money(s.targetHigh)}`,
                'Objectif le plus bas et le plus haut publiés. Un écart très large signale un désaccord profond sur la valeur.') +
            kv('Révisions d\'objectif', s.ptRevisions == null ? null : s.ptRevisions,
                'Sens des révisions d\'objectifs sur les 3 derniers mois. Non fourni par les sources gratuites utilisées ici.') +
            kv('Détention institutionnelle', pct(s.institutionalOwnership),
                'Part du capital détenue par les fonds et investisseurs professionnels. Très élevée : les mouvements de flux peuvent amplifier les variations.') +
            kv('Détention initiés', pct(s.insiderOwnership),
                'Part du capital détenue par les dirigeants et administrateurs. Une part significative aligne leurs intérêts sur ceux des actionnaires.') +
            kv('Transactions d\'initiés', insStr,
                'Solde net des achats et ventes déclarés par les dirigeants sur les 6 derniers mois. Des ventes sont fréquentes (rémunération en actions) ; les achats sont plus significatifs.',
                insTag) +
            kv('Vente à découvert', pct(shortPct),
                'Part du flottant vendue à découvert : les parieurs à la baisse. Au-dessus de 10 %, le pessimisme est marqué (et un rebond peut être violent).',
                shortTag) +
            kv('Jours de rachat', s.shortRatio == null ? null : `${num1(s.shortRatio)} j`,
                'Nombre de séances nécessaires aux vendeurs à découvert pour racheter leurs positions au volume habituel. Élevé : risque de "short squeeze".');

        if (src) {
            const hasReco = !!(s.consensus || s.recommendationKey || s.targetMean != null);
            src.textContent = hasReco
                ? 'Yahoo Finance · consensus Finnhub'
                : (a.isUS ? 'Consensus analystes indisponible' : 'Consensus analystes : actions US uniquement');
        }
    },

    // Jauge horizontale bornee (RSI, position dans un range) : trait = valeur courante.
    _gauge(title, tip, value, min, max, legend, cls = '') {
        const head = `<div class="sent-title">${title} ${this._kvHelp(tip)}</div>`;
        if (value == null || !isFinite(value)) {
            return `<div class="sent-block">${head}<div class="sent-empty">Non disponible</div></div>`;
        }
        const p = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
        return `<div class="sent-block">${head}` +
            `<div class="gauge-track ${cls}"><span class="gauge-mark" style="left:${p.toFixed(1)}%"></span></div>` +
            `<div class="gauge-legend">${legend}</div></div>`;
    },

    renderResearchTechnical(a) {
        const card = document.getElementById('researchTechCard');
        const grid = document.getElementById('researchTechGrid');
        const top = document.getElementById('researchTechTop');
        const src = document.getElementById('researchTechSrc');
        if (!card || !grid || !top) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            grid.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            top.innerHTML = '';
            return;
        }

        const t = a.technical;
        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';

        if (!t) {
            top.innerHTML = '';
            grid.innerHTML = `<div class="research-kv"><span class="v">${ND}</span></div>`;
            if (src) src.textContent = 'Historique de cours insuffisant';
            return;
        }

        const money = (x) => (x == null || !isFinite(x)) ? null : Utils.formatCurrency(x, cur);
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x);
        const num1 = (x) => (x == null || !isFinite(x))
            ? null
            : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);

        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;
        const gap = (x) => x == null ? '' : `<span class="kv-cmp ${x >= 0 ? 'up' : 'dn'}">cours ${Utils.formatPercent(x)}</span>`;

        // Bloc gauche : rappel de l'overlay trace sur le graphe de cours.
        const maLegend =
            `<div class="sent-block"><div class="sent-title">Moyennes mobiles ${this._kvHelp('Cours moyen des 50 et 200 dernières séances, tracés sur le graphe ci-dessus. Le cours au-dessus des deux moyennes traduit une dynamique haussière.')}</div>` +
            `<div class="ma-legend">` +
            `<span class="ma-leg"><span class="ma-line"></span>MM 50 <b>${money(t.ma50) || '—'}</b></span>` +
            `<span class="ma-leg"><span class="ma-line ma200"></span>MM 200 <b>${money(t.ma200) || '—'}</b></span>` +
            `</div></div>`;

        top.innerHTML = maLegend + this._gauge(
            'RSI 14 séances',
            'Indicateur de momentum entre 0 et 100. Sous 30 le titre est dit survendu, au-dessus de 70 suracheté. À lire comme un excès de court terme, jamais comme un signal isolé.',
            t.rsi14, 0, 100,
            `<span>Survente <b>30</b></span><span><b>${num1(t.rsi14) || '—'}</b></span><span>Surachat <b>70</b></span>`,
            'rsi'
        );

        const trendTag = { 'haussière': 'ok', 'baissière': 'warn', neutre: 'mid' }[t.trend] || 'mid';
        const crossTxt = t.cross
            ? `${t.cross === 'golden' ? 'Golden cross' : 'Death cross'} · ${Utils.formatDateDisplay(t.crossDate)}`
            : null;
        const crossTag = t.cross
            ? `<span class="kv-tag ${t.cross === 'golden' ? 'ok' : 'warn'}">il y a ${t.crossDaysAgo} séances</span>`
            : '';
        const rsiTag = t.rsiZone
            ? `<span class="kv-tag ${t.rsiZone === 'neutre' ? 'mid' : (t.rsiZone === 'survente' ? 'ok' : 'warn')}">${t.rsiZone}</span>`
            : '';
        const volTag = t.volumeRatio == null ? ''
            : `<span class="kv-tag ${t.volumeRatio >= 1.5 ? 'warn' : 'mid'}">${t.volumeRatio >= 1.5 ? 'activité inhabituelle' : 'activité normale'}</span>`;

        grid.innerHTML =
            kv('Tendance', t.trend,
                'Lecture de l\'alignement cours / MM 50 / MM 200. Haussière si le cours est au-dessus des deux moyennes et la MM 50 au-dessus de la MM 200.',
                `<span class="kv-tag ${trendTag}">${t.trend}</span>`) +
            kv('Moyenne mobile 50 j', money(t.ma50),
                'Cours moyen des 50 dernières séances : référence de tendance court/moyen terme.',
                gap(t.priceVsMa50)) +
            kv('Moyenne mobile 200 j', money(t.ma200),
                'Cours moyen des 200 dernières séances : référence de tendance long terme, très suivie par les gérants.',
                gap(t.priceVsMa200)) +
            kv('Dernier croisement', crossTxt,
                'Golden cross : la MM 50 repasse au-dessus de la MM 200 (lu comme haussier). Death cross : l\'inverse. Signal retardé par construction.',
                crossTag) +
            kv('RSI 14', num1(t.rsi14),
                'Force relative sur 14 séances. Sous 30 : excès de baisse possible ; au-dessus de 70 : excès de hausse.',
                rsiTag) +
            kv('Position 52 semaines', t.rangePosition52 == null ? null : Utils.formatPercent(t.rangePosition52, false),
                'Où se situe le cours entre son plus bas et son plus haut des 52 dernières semaines. 0 % = au plus bas, 100 % = au plus haut.') +
            kv('Écart au plus haut 52 sem.', pct(t.pctFromHigh52),
                'Distance qui sépare le cours de son plus haut annuel. Un écart important n\'est pas une décote : il peut refléter une dégradation réelle.') +
            kv('Écart au plus bas 52 sem.', pct(t.pctFromLow52),
                'Distance qui sépare le cours de son plus bas annuel.') +
            kv('Volume vs moyenne', t.volumeRatio == null ? null : `${num1(t.volumeRatio)} ×`,
                'Volume du jour rapporté au volume moyen. Au-delà de 1,5 ×, un événement mobilise le marché sur la valeur.',
                volTag);

        if (src) src.textContent = `Calculé sur ${t.points} séances de cotation`;
    },

    // Carte conditionnelle : masquee pour les valeurs qui ne versent pas de dividende.
    renderResearchDividend(a) {
        const card = document.getElementById('researchDivCard');
        const grid = document.getElementById('researchDivGrid');
        const series = document.getElementById('researchDivSeries');
        const src = document.getElementById('researchDivSrc');
        if (!card || !grid || !series) return;

        if (!a) { card.hidden = true; return; }

        const d = a.dividend || {};
        if (!d.paysDividend) { card.hidden = true; return; }
        card.hidden = false;

        const cur = (a.price && a.price.currency) || (a.identity && a.identity.currency) || 'USD';
        const ND = 'Non disponible';
        const money = (x) => (x == null || !isFinite(x)) ? null : Utils.formatCurrency(x, cur);
        const pct = (x) => (x == null || !isFinite(x)) ? null : Utils.formatPercent(x, false);

        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;

        // Taux de distribution : part du benefice reversee. Seuils explicites et
        // ajustables — au-dela de 80 % la marge de securite devient mince, le
        // dividende dependant alors de la stabilite parfaite des resultats.
        const payoutPct = (d.payoutRatio == null || !isFinite(d.payoutRatio)) ? null : d.payoutRatio * 100;
        const payoutTag = payoutPct == null ? ''
            : `<span class="kv-tag ${payoutPct > 80 ? 'warn' : (payoutPct > 60 ? 'mid' : 'ok')}">` +
              `${payoutPct > 80 ? 'peu soutenable' : (payoutPct > 60 ? 'à surveiller' : 'soutenable')}</span>`;

        // Ecart au rendement moyen des 5 dernieres annees : au-dessus, le titre
        // rapporte plus que d'habitude (souvent parce que le cours a baisse).
        const vsAvg = (d.yieldPct != null && d.avgYield5y) ? d.yieldPct - d.avgYield5y : null;
        const vsAvgTag = vsAvg == null ? ''
            : `<span class="kv-cmp ${vsAvg >= 0 ? 'up' : 'dn'}">` +
              `${vsAvg >= 0 ? '+' : '−'}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Math.abs(vsAvg))} pts vs moyenne 5 ans</span>`;

        const streak = d.growthStreakYears;
        const streakTag = !streak ? ''
            : `<span class="kv-tag ${streak >= 5 ? 'ok' : 'mid'}">${streak >= 5 ? 'régulier' : 'récent'}</span>`;

        const last = d.lastPayment;
        const annual = AnalysisUtils.arr(d.annualPerShare);
        const lastFull = annual.length > 1 ? annual[annual.length - 2] : null;

        grid.innerHTML =
            kv('Rendement actuel', pct(d.yieldPct),
                'Dividende annuel rapporté au cours actuel. Un rendement très élevé traduit souvent un cours qui a chuté, pas une bonne affaire.',
                vsAvgTag) +
            kv('Rendement moyen 5 ans', pct(d.avgYield5y),
                'Rendement moyen des 5 dernières années : sert de repère pour situer le rendement actuel.') +
            kv('Dividende par action', money(d.ratePerShare),
                'Montant annuel versé par action, sur la base du dernier taux connu.') +
            kv('Versé sur le dernier exercice', lastFull == null ? null : money(lastFull.value),
                'Somme réellement versée par action sur le dernier exercice complet, tous détachements confondus.') +
            kv('Taux de distribution', payoutPct == null ? null : pct(payoutPct),
                'Part du bénéfice reversée aux actionnaires. Au-delà de 80 %, le dividende absorbe presque tout le résultat : peu de marge en cas de mauvaise année.',
                payoutTag) +
            kv('Hausses consécutives', streak == null ? null : `${streak} an${streak > 1 ? 's' : ''}`,
                'Nombre d\'exercices complets consécutifs où le dividende annuel a augmenté. Une longue série signale une politique de distribution assumée.',
                streakTag) +
            kv('Dernier versement', !last ? null : money(Number(last.amountPerShare)),
                'Montant et date du dernier détachement connu.',
                (last && last.date) ? `<span class="kv-cmp">${Utils.formatDateDisplay(last.date)}</span>` : '') +
            kv('Historique disponible', annual.length ? `${annual.length} exercices` : null,
                'Profondeur de l\'historique de versements récupéré (source Yahoo Finance).');

        series.innerHTML = this._growthSeries(
            'Dividende annuel par action',
            annual, (x) => Utils.formatCurrency(x, cur),
            'Somme des détachements de chaque année civile. La dernière année est souvent incomplète : elle n\'entre pas dans le calcul des hausses consécutives.'
        );

        if (src) src.textContent = annual.length ? 'Yahoo Finance' : 'Historique de versements indisponible';
    },

    // Trace MM 50 / MM 200 par-dessus la courbe de cours existante. Les moyennes
    // viennent de l'analyse (15 mois d'historique) : rien n'est re-telecharge, et
    // les points hors de cette fenetre restent vides plutot qu'approximes.
    applyResearchMaOverlay() {
        const chart = this.researchChart;
        if (!chart || !chart.data || !Array.isArray(chart.data.datasets) || !chart.data.datasets.length) return;
        const t = this.researchAnalysis && this.researchAnalysis.technical;
        const dates = this.researchChartDates || [];
        const ink = this.chartInk();

        const extra = [];
        if (t && t.maSeries && dates.length) {
            const idx = {};
            t.maSeries.dates.forEach((d, i) => { idx[d] = i; });
            const pick = (serie) => dates.map(d => (idx[d] === undefined ? null : serie[idx[d]]));
            const add = (label, serie, color, dash) => {
                const data = pick(serie);
                if (!data.some(v => v != null)) return;
                extra.push({
                    label, data, borderColor: color, backgroundColor: 'transparent',
                    borderWidth: 1.4, borderDash: dash, fill: false, tension: 0,
                    pointRadius: 0, pointHoverRadius: 0, spanGaps: false
                });
            };
            add('MM 50', t.maSeries.ma50, ink.acc, []);
            add('MM 200', t.maSeries.ma200, ink.tick, [5, 4]);
        }

        chart.data.datasets = [chart.data.datasets[0], ...extra];
        chart.update();
    },

    renderResearchPosition(symbol, cur, price) {
        const card = document.getElementById('researchPositionCard');
        const notHeld = document.getElementById('researchNotHeld');
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const h = (stats.holdings || []).find(x => x.symbol === symbol);
        const { realized, dividends } = this.perSymbolRealized(symbol);

        if (!h) {
            card.hidden = true;
            notHeld.hidden = false;
            return;
        }
        notHeld.hidden = true;
        card.hidden = false;

        const ptfEl = document.getElementById('researchPositionPtf');
        if (this.service.activePortfolioId === 'GLOBAL' && h.portfolios && h.portfolios.length) {
            ptfEl.textContent = h.portfolios.map(id => (this.service.getPortfolioById(id) || {}).name).filter(Boolean).join(', ');
        } else ptfEl.textContent = '';

        const kv = (k, v, cls = '') => `<div class="research-kv"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
        const gainCls = h.gainNative >= 0 ? 'text-green' : 'text-red';
        document.getElementById('researchPositionGrid').innerHTML =
            kv('PRU', Utils.formatCurrency(h.avgPrice, cur)) +
            kv('Quantité', Utils.formatQty(h.qty)) +
            kv('Cours actuel', Utils.formatCurrency(h.currentPrice || price, cur)) +
            kv('Valeur', Utils.formatCurrency(h.valueNative, cur)) +
            kv('+/- value latente', `${h.gainNative >= 0 ? '+' : ''}${Utils.formatCurrency(h.gainNative, cur)} (${Utils.formatPercent(h.gainPercent)})`, gainCls) +
            kv('Poids portefeuille', Utils.formatPercent(h.weightPercent, false)) +
            kv('Dividendes reçus', Utils.formatCurrency(dividends, cur)) +
            kv('P&L réalisé (hors frais)', `${realized >= 0 ? '+' : ''}${Utils.formatCurrency(realized, cur)}`, realized >= 0 ? 'text-green' : 'text-red');
    },

    renderResearchKey(fund, cur, price) {
        const grid = document.getElementById('researchKeyGrid');
        const src = document.getElementById('researchKeySrc');
        const bar = document.getElementById('research52wBar');
        const kv = (k, v, cls = '') => `<div class="research-kv"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
        const n1 = (x, d = 2) => (x == null || isNaN(x)) ? '—' : Number(x).toFixed(d);
        const pct = (x) => (x == null || isNaN(x)) ? '—' : Utils.formatPercent(x, false);

        if (!fund) { grid.innerHTML = `<div class="research-kv"><span class="v">Données indisponibles.</span></div>`; src.textContent = ''; bar.hidden = true; return; }

        src.textContent = fund.fundamentalsSource === 'finnhub'
            ? 'Ratios : Finnhub'
            : 'Ratios fondamentaux : actions US uniquement';

        grid.innerHTML =
            kv('Capitalisation', Utils.formatCompact(fund.marketCap, 'USD')) +
            kv('PER (P/E TTM)', n1(fund.peTTM, 1)) +
            kv('BPA (TTM)', fund.epsTTM == null ? '—' : Utils.formatCurrency(fund.epsTTM, cur)) +
            kv('Bêta', n1(fund.beta)) +
            kv('Cours / Valeur compta. (P/B)', n1(fund.pbAnnual)) +
            kv('Cours / Ventes (P/S)', n1(fund.psTTM)) +
            kv('ROE', pct(fund.roeTTM)) +
            kv('Marge nette', pct(fund.netMarginTTM)) +
            kv('Croissance CA (1 an)', fund.revenueGrowthTTM == null ? '—' : Utils.formatPercent(fund.revenueGrowthTTM)) +
            kv('Volume du jour', Utils.formatCompact(fund.volume)) +
            kv('Clôture veille', fund.previousClose == null ? '—' : Utils.formatCurrency(fund.previousClose, cur));

        const lo = fund.fiftyTwoWeekLow, hi = fund.fiftyTwoWeekHigh;
        if (lo != null && hi != null && hi > lo && price) {
            const p = Math.max(0, Math.min(1, (price - lo) / (hi - lo)));
            document.getElementById('research52wDot').style.left = (p * 100).toFixed(1) + '%';
            document.getElementById('research52wLo').textContent = Utils.formatCurrency(lo, cur);
            document.getElementById('research52wHi').textContent = Utils.formatCurrency(hi, cur);
            bar.hidden = false;
        } else {
            bar.hidden = true;
        }
    },

    renderResearchAbout(fund, earn) {
        const card = document.getElementById('researchAboutCard');
        const grid = document.getElementById('researchAboutGrid');
        const rows = [];
        const kv = (k, v) => rows.push(`<div class="research-kv"><span class="k">${k}</span><span class="v">${v}</span></div>`);
        if (fund && fund.industry) kv('Secteur', fund.industry);
        if (fund && fund.country) kv('Pays', fund.country);
        if (fund && fund.ipo) kv('Introduction en bourse', Utils.formatDateDisplay(fund.ipo));
        if (earn && earn.date) kv('Prochains résultats', Utils.formatDateDisplay(earn.date) + (earn.hour ? ` (${earn.hour})` : ''));
        if (fund && fund.weburl) {
            let host = fund.weburl;
            try { host = new URL(fund.weburl).hostname.replace(/^www\./, ''); } catch (e) {}
            kv('Site', `<a href="${fund.weburl}" target="_blank" rel="noopener noreferrer">${host}</a>`);
        }
        if (!rows.length) { card.hidden = true; return; }
        card.hidden = false;
        grid.innerHTML = rows.join('');
    },

    // Libelle du tooltip du graphe de cours : la serie principale reste nue,
    // les moyennes mobiles sont prefixees par leur nom.
    _researchTip(ctx, cur) {
        if (ctx.parsed.y == null) return null;
        const v = Utils.formatCurrency(ctx.parsed.y, cur);
        return ctx.datasetIndex ? `${ctx.dataset.label} : ${v}` : v;
    },

    async renderResearchChart(symbol) {
        const canvas = document.getElementById('researchChart');
        if (!canvas) return;
        const range = this.chartState.researchRange || '1Y';
        const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 }[range] || 12;
        const end = new Date();
        const start = new Date();
        if (range === 'MAX') start.setFullYear(start.getFullYear() - 50);
        else start.setMonth(start.getMonth() - months);

        const cur = Utils.getCurrency(symbol);
        const stats = this.service.calculatePortfolio(this.chartState.currency);
        const h = (stats.holdings || []).find(x => x.symbol === symbol);

        const history = await APIService.getDailyHistory(symbol, start, end, h && h.avgPrice, h && h.currentPrice);
        if (this.researchSymbol !== symbol) return;
        const dates = Object.keys(history).sort();
        this.researchChartDates = dates;   // dates brutes : alignement de l'overlay MM
        const labels = dates.map(d => Utils.formatDateDisplay(d));
        const values = dates.map(d => history[d]);
        const rising = values.length && values[values.length - 1] >= values[0];
        const lineColor = rising ? '#2ebd85' : '#f6465c';
        const ink = this.chartInk();

        if (this.researchChart) {
            this.researchChart.data.labels = labels;
            this.researchChart.data.datasets[0].data = values;
            this.researchChart.data.datasets[0].borderColor = lineColor;
            this.researchChart.data.datasets[0].label = symbol;
            this.researchChart.options.plugins.tooltip.callbacks.label = (ctx) => this._researchTip(ctx, cur);
            this.researchChart.options.scales.y.ticks.callback = (v) => Utils.formatCurrency(v, cur);
            this.applyResearchMaOverlay();   // re-aligne les MM sur la nouvelle plage
            return;
        }

        this.researchChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [{ label: symbol, data: values, borderColor: lineColor, backgroundColor: 'transparent', fill: false, tension: 0.15, borderWidth: 2.2, borderCapStyle: 'round', pointRadius: 0, pointHoverRadius: 5 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', axis: 'x', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false, callbacks: { label: (ctx) => this._researchTip(ctx, cur) } }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { color: ink.tick, font: { size: 11 }, maxTicksLimit: 7 } },
                    y: { position: 'right', grid: { color: ink.grid, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { color: ink.tick, font: { size: 11 }, callback: (v) => Utils.formatCurrency(v, cur) } }
                }
            }
        });
        this.applyResearchMaOverlay();
    },

    async renderResearchNews(symbol, name) {
        const card = document.getElementById('researchNewsCard');
        const list = document.getElementById('researchNewsList');
        if (!card) return;
        card.hidden = true;
        try {
            const results = await APIService.webSearch(`${symbol} ${name} action bourse`);
            if (this.researchSymbol !== symbol || !results || !results.length) return;
            list.innerHTML = results.slice(0, 4).map(r => {
                const d = r.publishedDate ? Utils.formatDateDisplay(r.publishedDate) : '';
                let host = '';
                try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) {}
                return `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title || host}</a><span class="rn-meta">${[host, d].filter(Boolean).join(' · ')}</span></li>`;
            }).join('');
            card.hidden = false;
        } catch (e) { /* actualités indisponibles */ }
    },
};

window.onerror = function (msg, url, line) {
    console.error("Global Error:", msg, "at line:", line);
};

document.addEventListener('DOMContentLoaded', () => {
    App.init().catch(e => console.error("Critical initialization error:", e));
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.error('SW registration failed:', e));
    });
}
