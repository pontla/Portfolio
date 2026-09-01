/**
 * Constantes de configuration, sans dependance a l'environnement.
 */

// --- CONFIG & CONSTANTS ---
export const CONFIG = {
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
    RESEARCH_AI_CACHE_STORAGE: 'research_ai_analysis_cache_v1',
    PORTFOLIO_ICONS_STORAGE: 'portfolio_icons_v1',
    PROXY_BASE_URL: 'https://fragrant-band-1476.jrichardeau-cloudflare.workers.dev',
    SUPABASE_URL: 'https://ttphzfvgeufoblkqvdsl.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_y3tJvH9sPMyHVW27tEwy2A_Rx-VGXCU'
};

// --- AI PROVIDERS (résumé du portefeuille) — métadonnées d'affichage uniquement.
// L'appel réel et la clé API vivent côté worker (POST /ai/insights) : la clé de
// l'utilisateur n'est jamais chargée ni conservée dans le navigateur.
export const AI_PROVIDERS = {
    anthropic: { label: 'Anthropic (Claude)', keyPlaceholder: 'sk-ant-...', usesLiveSearch: true },
    openai: { label: 'OpenAI (ChatGPT)', keyPlaceholder: 'sk-...', usesLiveSearch: true },
    gemini: { label: 'Google (Gemini)', keyPlaceholder: 'AIza...', usesLiveSearch: false },
    grok: { label: 'xAI (Grok)', keyPlaceholder: 'xai-...', usesLiveSearch: true },
    groq: { label: 'Groq (Llama 3.3 70B)', keyPlaceholder: 'gsk_...', usesLiveSearch: false }
};
