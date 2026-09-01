/**
 * STOCK PORTFOLIO APP — CONTROLEUR UI
 *
 * Le moteur financier (calculs, acces marche, analyse) vit dans ./core/*.js,
 * sans aucune dependance au DOM, et se teste par import direct. Ce fichier ne
 * garde que le rendu, les evenements et l'amorcage.
 *
 * Charge en module natif (`<script type="module">`) : aucun bundler.
 */

import { CONFIG, AI_PROVIDERS } from './core/config.js';
import { setSupabaseClient } from './core/supabase.js';
import { AuthService, isJwtTimingError } from './core/auth.js';
import { Utils } from './core/utils.js';
import { APIService } from './core/api.js';
import { AnalysisUtils, AnalysisService } from './core/analysis.js';
import { PortfolioService } from './core/portfolio.js';
import { Icons } from './icons.js';

// Le client Supabase est construit ici : le global provient de la balise
// <script> CDN de index.html, que le moteur n'a pas a connaitre.
setSupabaseClient(window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY));

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
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#themeSegmented .theme-seg-btn')).forEach(b => {
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
            /** @type {NodeListOf<HTMLElement>} */ (seg.querySelectorAll('.theme-seg-btn')).forEach(btn => {
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
        Icons.render();
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
        const authForm = /** @type {HTMLFormElement} */ (document.getElementById('authForm'));
        const authTitle = document.getElementById('authTitle');
        const authSubmitBtn = document.getElementById('authSubmitBtn');
        const authToggleBtn = document.getElementById('authToggleBtn');
        const authForgotBtn = document.getElementById('authForgotBtn');
        const authError = document.getElementById('authError');
        const authInfo = document.getElementById('authInfo');
        const emailGroup = document.getElementById('authEmailGroup');
        const passwordGroup = document.getElementById('authPasswordGroup');
        const emailInput = /** @type {HTMLInputElement} */ (authForm.querySelector('input[name="email"]'));
        const passwordInput = /** @type {HTMLInputElement} */ (authForm.querySelector('input[name="password"]'));
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
                if (img.nextElementSibling) /** @type {HTMLElement} */ (img.nextElementSibling).style.display = 'flex';
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
            const sumBtn = /** @type {Element} */ (e.target).closest('.insights-summary-toggle');
            if (sumBtn) {
                const clamped = sumBtn.previousElementSibling.classList.toggle('is-clamped');
                sumBtn.textContent = clamped ? 'Afficher plus' : 'Afficher moins';
                return;
            }
            const grpBtn = /** @type {Element} */ (e.target).closest('.insights-toggle-btn');
            if (grpBtn) {
                const more = /** @type {HTMLElement} */ (grpBtn.parentElement.querySelector('.insights-more'));
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
                const card = /** @type {HTMLElement} */ (statsGrid.querySelector('.stat-card'));
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
        const portfolioForm = /** @type {HTMLFormElement} */ (document.getElementById('portfolioForm'));
        const portfolioModalTitle = document.getElementById('portfolioModalTitle');

        if (switcherBtn && switcherContainer) {
            switcherBtn.onclick = (e) => {
                e.stopPropagation();
                switcherContainer.classList.toggle('open');
            };

            document.addEventListener('click', (e) => {
                if (!switcherContainer.contains(/** @type {Node} */ (e.target))) {
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
                /** @type {HTMLInputElement} */ (document.getElementById('portfolioEditId')).value = '';
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
                const editId = /** @type {string} */ (fd.get('portfolioEditId'));
                const name = /** @type {string} */ (fd.get('portfolioName'));
                const color = /** @type {string} */ (fd.get('portfolioColor'));
                const icon = /** @type {string} */ (fd.get('portfolioIcon')) || '';

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
        const syncDividendsBtn = /** @type {HTMLButtonElement} */ (document.getElementById('syncDividendsBtn'));
        const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
        const exportCsvBtn = document.getElementById('exportCsvBtn');
        const importCsvBtn = document.getElementById('importCsvBtn');
        const importCsvInput = /** @type {HTMLInputElement} */ (document.getElementById('importCsvInput'));
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
        const refreshDataBtn = /** @type {HTMLButtonElement} */ (document.getElementById('refreshDataBtn'));
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
        const aiProviderSelect = /** @type {HTMLSelectElement} */ (document.getElementById('aiProviderSelect'));
        const aiKeyInput = /** @type {HTMLInputElement} */ (document.getElementById('aiKeyInput'));
        const saveAiKeyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('saveAiKeyBtn'));
        const clearAiKeyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clearAiKeyBtn'));

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

        // Analyse détaillée d'une valeur (Explorer)
        const researchAiRefreshBtn = document.getElementById('researchAiRefreshBtn');
        if (researchAiRefreshBtn) {
            researchAiRefreshBtn.onclick = () => this.refreshResearchAiAnalysis(true);
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
        const form = /** @type {HTMLFormElement} */ (document.getElementById('transactionForm'));
        const modalTitle = document.getElementById('transactionModalTitle');
        if (form.elements['date']) form.elements['date'].max = Utils.getDateString();

        const symbolGroup = document.getElementById('symbolGroup');
        const symbolInput = /** @type {HTMLInputElement} */ (document.getElementById('symbolInputField'));
        const qtyPriceRow = document.getElementById('qtyPriceRow');
        const qtyInput = /** @type {HTMLInputElement} */ (document.getElementById('qtyInputField'));
        const priceInput = /** @type {HTMLInputElement} */ (document.getElementById('priceInputField'));
        const amountGroup = document.getElementById('amountGroup');
        const amountInput = /** @type {HTMLInputElement} */ (document.getElementById('amountInputField'));
        const amountLabel = document.getElementById('amountLabel');
        const priceCurrencyGroup = document.getElementById('priceCurrencyGroup');
        const priceCurrencyField = /** @type {HTMLSelectElement} */ (document.getElementById('priceCurrencyField'));
        const feesGroup = document.getElementById('feesGroup');
        const feesInput = /** @type {HTMLInputElement} */ (document.getElementById('feesInputField'));

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
                updateFormFieldsForType(/** @type {HTMLInputElement} */ (e.target).value);
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
            const portSelect = /** @type {HTMLSelectElement} */ (document.getElementById('targetPortfolioSelect'));
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
            const type = /** @type {string} */ (fd.get('type'));
            const dateValue = /** @type {string} */ (fd.get('date'));
            const symbol = /** @type {string} */ (fd.get('symbol')) || '$CASH';

            let price = parseFloat(/** @type {string} */ (fd.get('price'))) || 0;
            let fees = parseFloat(/** @type {string} */ (fd.get('fees'))) || 0;
            let amount = parseFloat(/** @type {string} */ (fd.get('amount'))) || 0;
            if (type === 'BUY' || type === 'SELL') {
                const enteredCurrency = /** @type {string} */ (fd.get('priceCurrency')) || Utils.getCurrency(symbol);
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
        const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('globalSearchInput'));
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
            const query = /** @type {HTMLInputElement} */ (e.target).value.trim();
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
            /** @type {NodeListOf<HTMLElement>} */ (currencyToggle.querySelectorAll('.toggle-btn')).forEach(btn => {
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
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.toggle-group:not(#currencyToggle) .toggle-btn')).forEach(btn => {
            btn.onclick = () => {
                btn.parentElement.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.mode = btn.textContent.trim() === 'Performance' ? 'PERF' : 'VALUE';
                this.render();
            };
        });

        // Benchmarks
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.benchmark-checkbox-btn')).forEach(btn => {
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
            /** @type {NodeListOf<HTMLElement>} */ (perfFilterGroup.querySelectorAll('.filter-btn')).forEach(btn => {
                btn.onclick = () => {
                    perfFilterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.chartState.perfFilter = btn.dataset.filter;
                    this.render();
                };
            });
        }

        // Range Buttons
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#timeRangeSelector .range-btn')).forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#timeRangeSelector .range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.range = btn.dataset.range || 'ALL';
                this.render();
            };
        });

        // Profit chart range buttons
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#profitRangeSelector .range-btn')).forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#profitRangeSelector .range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.profitRange = btn.dataset.range || 'ALL';
                this.render();
            };
        });

        // Navigation Tabs — sous-nav, nav basse et menu lateral pilotent le meme etat
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-btn')).forEach(btn => {
            btn.onclick = () => {
                const tab = btn.dataset.tab;
                /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-btn')).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
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
            const txMenuBtn = /** @type {Element} */ (e.target).closest('.tx-menu-btn');
            document.querySelectorAll('.tx-card.menu-open').forEach(c => {
                if (!txMenuBtn || c !== txMenuBtn.closest('.tx-card')) c.classList.remove('menu-open');
            });
            if (txMenuBtn) {
                e.stopPropagation();
                txMenuBtn.closest('.tx-card').classList.toggle('menu-open');
                return;
            }

            const editTradeBtn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.edit-trade-btn'));
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

                    const portSelect = /** @type {HTMLSelectElement} */ (document.getElementById('targetPortfolioSelect'));
                    if (portSelect) portSelect.value = trade.portfolioId;

                    modal.classList.add('open');
                }
            }

            const delBtn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.delete-trade-btn'));
            if (delBtn) {
                if (confirm('Voulez-vous vraiment supprimer cette transaction ?')) {
                    try {
                        await this.service.removeTrade(delBtn.dataset.id);
                    } catch (err) {
                        alert('Erreur : ' + err.message);
                    }
                }
            }

            const assetCell = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.holding-asset-cell'));
            if (assetCell) {
                this.goToResearch(assetCell.dataset.symbol);
            }

            const sellBtn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.quick-sell-btn'));
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
            const editPortBtn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.edit-portfolio-btn'));
            if (editPortBtn) {
                e.stopPropagation();
                switcherContainer.classList.remove('open');
                const pId = editPortBtn.dataset.id;
                const port = this.service.getPortfolioById(pId);
                if (port) {
                    portfolioModalTitle.textContent = 'Modifier le portefeuille';
                    /** @type {HTMLInputElement} */ (document.getElementById('portfolioEditId')).value = port.id;
                    /** @type {HTMLInputElement} */ (document.getElementById('portfolioNameInput')).value = port.name;
                    const radio = /** @type {HTMLInputElement} */ (document.querySelector(`input[name="portfolioColor"][value="${port.color}"]`));
                    if (radio) radio.checked = true;
                    const curIcon = Utils.portfolioIconOverrides()[port.id] || '';
                    const iconRadio = /** @type {HTMLInputElement} */ (document.querySelector(`input[name="portfolioIcon"][value="${curIcon}"]`));
                    if (iconRadio) iconRadio.checked = true;
                    document.getElementById('portfolioSubmitBtn').textContent = 'Sauvegarder';
                    portfolioModal.classList.add('open');
                }
            }

            // Delete portfolio
            const delPortBtn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.delete-portfolio-btn'));
            if (delPortBtn) {
                e.stopPropagation();
                const pId = delPortBtn.dataset.id;
                const port = this.service.getPortfolioById(pId);
                if (confirm(`Voulez-vous vraiment supprimer le portefeuille "${port.name}" et toutes ses transactions ?`)) {
                    try {
                        const removed = await this.service.deletePortfolio(pId);
                        if (!removed) {
                            alert("Impossible de supprimer le seul portefeuille existant.");
                            return;
                        }
                    } catch (err) {
                        alert('Erreur : ' + err.message);
                    }
                }
            }

            // Switch to specific portfolio
            const portItem = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.portfolio-item-select'));
            if (portItem) {
                const pId = portItem.dataset.id;
                this.service.setActivePortfolio(pId);
                switcherContainer.classList.remove('open');
            }
        });

        // --- TRANSACTIONS FILTERS (feuille de filtres) ---
        const txSearchInput = /** @type {HTMLInputElement} */ (document.getElementById('txSearchInput'));
        const txFromFilter = /** @type {HTMLInputElement} */ (document.getElementById('txFromFilter'));
        const txToFilter = /** @type {HTMLInputElement} */ (document.getElementById('txToFilter'));
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

        Icons.render();
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

        Icons.render();

        const uniqueSymbols = [...new Set(sortedHistory.map(t => t.symbol))];
        this.refreshAssetNames(uniqueSymbols, curr);
    },

    initHoldingsSwipe() {
        const list = document.getElementById('holdingsCardsList');
        if (!list) return;
        const OPEN = -96;
        list.querySelectorAll('.holding-swipe').forEach(sw => {
            const card = /** @type {HTMLElement} */ (sw.querySelector('.holding-card'));
            if (!card) return;
            let x0 = 0, y0 = 0, dx = 0, open = false, active = false, decided = false, horiz = false;
            const set = (v) => { card.style.transform = `translateX(${v}px)`; };
            const closeOthers = () => {
                list.querySelectorAll('.holding-swipe.is-open').forEach(o => {
                    if (o === sw) return;
                    o.classList.remove('is-open');
                    const c = /** @type {HTMLElement} */ (o.querySelector('.holding-card'));
                    if (c) c.style.transform = 'translateX(0)';
                });
            };
            card.addEventListener('touchstart', (e) => {
                const t = /** @type {TouchEvent} */ (e).touches[0];
                x0 = t.clientX; y0 = t.clientY; dx = 0;
                active = true; decided = false; horiz = false;
                sw.classList.add('dragging');
            }, { passive: true });
            card.addEventListener('touchmove', (e) => {
                if (!active) return;
                const t = /** @type {TouchEvent} */ (e).touches[0];
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
                if (/** @type {Element} */ (e.target).closest('.holding-swipe-action')) return;
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
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#timeRangeSelector .range-btn')).forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === this.chartState.range);
        });
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#profitRangeSelector .range-btn')).forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === this.chartState.profitRange);
        });

        // Sync Currency Toggle UI
        const currencyToggle = document.getElementById('currencyToggle');
        if (currencyToggle) {
            /** @type {NodeListOf<HTMLElement>} */ (currencyToggle.querySelectorAll('.toggle-btn')).forEach(b => {
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
                const el = /** @type {HTMLElement} */ (document.querySelector(`[data-range-val="${rangeKey}"]`));
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

        Icons.render();
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
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('profitChart'));
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
            const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById(canvasId));
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
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('portfolioChart'));
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
                                if (this.chartState.mode === 'PERF') return Number(value).toFixed(1) + '%';
                                if (Math.abs(Number(value)) >= 1000) {
                                    return (Number(value) / 1000).toFixed(1) + 'k ' + (this.chartState.currency === 'EUR' ? '€' : '$');
                                }
                                return Number(value).toFixed(0) + ' ' + (this.chartState.currency === 'EUR' ? '€' : '$');
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

        // Hors mode Performance, l'axe porte des montants : y tracer un indice
        // boursier en devise native n'aurait aucun sens. Le mode est force a
        // l'activation d'un benchmark, mais l'utilisateur peut revenir sur Valeur.
        if (isPerf && benchmarks.length > 0 && rawDates.length > 0) {
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
                // La courbe du portefeuille n'est pas rebasee a 0 : elle affiche la
                // plus-value cumulee vs prix de revient. On cale donc le benchmark
                // sur son point de depart, sinon un portefeuille a +50 % semble
                // ecraser un indice a +2 % alors qu'il a peut-etre sous-performe.
                // Ainsi l'ecart lu entre les deux courbes est bien l'ecart de
                // performance sur la fenetre affichee.
                const offset = primaryData && primaryData.length ? (primaryData[0] || 0) : 0;
                const bData = rawSeries.map(v => (v === null || v === undefined || !baseline)
                    ? null
                    : parseFloat((offset + ((v / baseline) - 1) * 100).toFixed(2)));

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
        const input = /** @type {HTMLInputElement} */ (document.getElementById('researchSearchInput'));
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
            const row = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.rs-row'));
            if (row) { closeSuggest(); this.runResearch(row.dataset.sym); }
        });

        document.getElementById('researchQuick').addEventListener('click', (e) => {
            const btn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('button[data-sym]'));
            if (btn) this.runResearch(btn.dataset.sym);
        });

        /** @type {NodeListOf<HTMLElement>} */ (document.getElementById('researchRange').querySelectorAll('.range-btn')).forEach(btn => {
            btn.addEventListener('click', () => {
                /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#researchRange .range-btn')).forEach(b => b.classList.toggle('active', b === btn));
                this.chartState.researchRange = btn.dataset.range || '1Y';
                if (this.researchSymbol) this.renderResearchChart(this.researchSymbol);
            });
        });

        // Legende / interrupteurs des moyennes mobiles
        const maLegend = document.getElementById('researchMaLegend');
        if (maLegend) {
            maLegend.addEventListener('click', (e) => {
                const btn = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.ma-toggle'));
                if (!btn || !btn.dataset.ma) return;
                const key = btn.dataset.ma;
                this.researchMaVisible[key] = !this.researchMaVisible[key];
                this.applyResearchMaOverlay();
            });
        }

        const deepBtn = document.getElementById('researchDeepBtn');
        if (deepBtn) deepBtn.onclick = () => this.runDeepAnalysis();

        const addBtn = document.getElementById('researchAddBtn');
        if (addBtn) addBtn.onclick = () => {
            (document.getElementById('addTransactionBtn') || document.getElementById('addTransactionFab'))?.click();
            setTimeout(() => {
                const si = /** @type {HTMLInputElement} */ (document.getElementById('symbolInputField'));
                if (si && this.researchSymbol) { si.value = this.researchSymbol; si.dispatchEvent(new Event('blur')); }
            }, 60);
        };
    },

    // Depuis une position détenue -> ouvre l'onglet Explorer sur cette valeur.
    goToResearch(symbol) {
        symbol = (symbol || '').trim().toUpperCase();
        if (!symbol) return;
        this.researchSymbol = symbol;
        /** @type {HTMLElement} */ (document.querySelector('.tab-btn[data-tab="research"]'))?.click();
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
        const input = /** @type {HTMLInputElement} */ (document.getElementById('researchSearchInput'));
        if (input) input.value = '';

        const cur = Utils.getCurrency(symbol);
        document.getElementById('researchSymbol').textContent = symbol;
        document.getElementById('researchName').textContent = this.assetNameCache[symbol] || 'Chargement…';
        document.getElementById('researchMeta').textContent = '';
        /** @type {HTMLImageElement} */ (document.getElementById('researchLogo')).src = this.getLogoUrl(symbol);
        document.getElementById('researchLogo').style.visibility = '';

        // Le calendrier de resultats n'est plus appele ici : AnalysisService le
        // recupere deja pour la carte "Profil & risques" (une requete de moins).
        const [fund, name] = await Promise.all([
            APIService.getFundamentals(symbol),
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
        this.renderResearchAbout(fund);
        await this.renderResearchChart(symbol);
        this.renderResearchNews(symbol, displayName);
        this.renderResearchQuick();
        Icons.render();

        // Analyse approfondie (phases 2+) : elle consomme le quota FMP (250
        // requetes/jour), donc elle n'est plus declenchee automatiquement.
        // L'utilisateur la lance via le bouton dedie ; si elle est deja en
        // cache pour ce symbole, on la reaffiche sans nouvelle requete.
        this.clearResearchAnalysis();
        const cachedAnalysis = AnalysisService.cached(symbol);
        if (cachedAnalysis) this.applyResearchAnalysis(symbol, cachedAnalysis);
        else this.showResearchDeepCta();
    },

    // Cartes alimentees uniquement par l'analyse approfondie.
    DEEP_CARD_IDS: ['researchScoreCard', 'researchAiCard', 'researchValuationCard', 'researchGrowthCard',
        'researchHealthCard', 'researchProfitCard', 'researchSentimentCard', 'researchTechCard',
        'researchDivCard', 'researchPeersCard', 'researchQualCard'],

    // Remet les cartes d'analyse approfondie a vide et les masque : tant que
    // l'analyse n'est pas lancee, elles n'ont rien a montrer.
    clearResearchAnalysis() {
        this.researchAnalysis = null;
        this.renderResearchScore(null);
        this.renderResearchAi(null);
        this.renderResearchValuation(null);
        this.renderResearchGrowth(null);
        this.renderResearchHealth(null);
        this.renderResearchProfitability(null);
        this.renderResearchSentiment(null);
        this.renderResearchTechnical(null);
        this.renderResearchDividend(null);
        this.renderResearchQualitative(null);
        this.renderResearchPeers(null);
        for (const id of this.DEEP_CARD_IDS) {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        }
    },

    applyResearchAnalysis(symbol, a) {
        if (this.researchSymbol !== symbol || !a) return;
        this.researchAnalysis = a;
        this.renderResearchScore(a);
        this.renderResearchAi(a);
        this.renderResearchValuation(a);
        this.renderResearchGrowth(a);
        this.renderResearchHealth(a);
        this.renderResearchProfitability(a);
        this.renderResearchSentiment(a);
        this.renderResearchTechnical(a);
        this.renderResearchDividend(a);
        this.renderResearchQualitative(a);
        this.renderResearchPeers(a);
        this.applyResearchMaOverlay();
        this.hideResearchDeepCta();
    },

    showResearchDeepCta() {
        const card = document.getElementById('researchDeepCard');
        const btn = /** @type {HTMLButtonElement} */ (document.getElementById('researchDeepBtn'));
        if (!card || !btn) return;
        card.hidden = false;
        btn.disabled = false;
        btn.textContent = "Lancer l'analyse approfondie";
    },

    hideResearchDeepCta() {
        const card = document.getElementById('researchDeepCard');
        if (card) card.hidden = true;
    },

    // Declenchee uniquement par le bouton : c'est le seul point d'entree qui
    // consomme le quota FMP.
    async runDeepAnalysis() {
        const symbol = this.researchSymbol;
        if (!symbol || this.deepAnalysisRunning) return;
        const btn = /** @type {HTMLButtonElement} */ (document.getElementById('researchDeepBtn'));
        const msg = document.getElementById('researchDeepMsg');
        this.deepAnalysisRunning = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Analyse en cours…'; }
        try {
            // Etat "Chargement…" des cartes pendant la requete.
            this.renderResearchScore(null);
            this.renderResearchAi(null);
            this.renderResearchValuation(null);
            this.renderResearchGrowth(null);
            this.renderResearchHealth(null);
            this.renderResearchProfitability(null);
            this.renderResearchSentiment(null);
            this.renderResearchTechnical(null);
            this.renderResearchDividend(null);
            const a = await AnalysisService.build(symbol);
            if (this.researchSymbol !== symbol) return;
            if (a) { this.applyResearchAnalysis(symbol, a); Icons.render(); }
            else if (msg) msg.textContent = 'Analyse indisponible pour cette valeur.';
        } catch (e) {
            console.warn('AnalysisService.build KO', e);
            if (msg) msg.textContent = 'Analyse indisponible : erreur de récupération des données.';
        } finally {
            this.deepAnalysisRunning = false;
            if (btn && !document.getElementById('researchDeepCard')?.hidden) {
                btn.disabled = false;
                btn.textContent = 'Réessayer';
            }
        }
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
    _kvHelp(tip, cls = '') {
        const safe = String(tip).replace(/"/g, '&quot;');
        return `<span class="kv-help ${cls}" tabindex="0" aria-label="${safe}" data-tip="${safe}">i</span>`;
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

        // Un denominateur negatif rend le ROE (et parfois le ROIC) trompeur : on
        // affiche la raison au lieu d'un pourcentage flatteur assorti d'une
        // pastille verte, pour rester coherent avec la notation et l'analyse IA.
        const prof = AnalysisService._profitabilityFlags(a);
        const NS = 'Non significatif';

        grid.innerHTML =
            kv('ROE', prof.roeReliable ? pct(p.roe) : (p.roe == null ? null : NS),
                'Résultat net rapporté aux capitaux propres : ce que la société génère avec l\'argent des actionnaires. Au-dessus de 15 % durablement, c\'est solide.' +
                (prof.roeReliable ? '' : ' Ici les fonds propres sont négatifs : le ratio change de signe et n\'est plus interprétable.'),
                prof.roeReliable ? this._healthFlag(p.roe, 15, 8, 'high') : '') +
            kv('ROA', pct(p.roa),
                'Résultat net rapporté au total du bilan : rentabilité de l\'ensemble des actifs, dette comprise. Moins flatteur que le ROE mais moins manipulable.',
                this._healthFlag(p.roa, 8, 3, 'high')) +
            kv('ROIC', prof.roicReliable ? pct(p.roic) : (p.roic == null ? null : NS),
                'Rentabilité du capital réellement investi (dette + fonds propres). S\'il dépasse durablement le coût du capital (~8-10 %), la société crée de la valeur.' +
                (prof.roicReliable ? '' : ' Ici le capital investi est négatif : le ratio n\'est plus interprétable.'),
                prof.roicReliable ? this._healthFlag(p.roic, 12, 6, 'high') : '') +
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

    // ---------- Synthese / score global ----------
    // L'affichage ne recalcule rien : toute la logique de notation (bornes,
    // ponderations, seuils du signal) vit dans AnalysisService._scoreBlock.
    renderResearchScore(a) {
        const card = document.getElementById('researchScoreCard');
        const top = document.getElementById('researchScoreTop');
        const subsEl = document.getElementById('researchScoreSubs');
        const src = document.getElementById('researchScoreSrc');
        if (!card || !top || !subsEl) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            top.innerHTML = '<span class="research-kv-loading">Chargement…</span>';
            subsEl.innerHTML = '';
            return;
        }

        const sc = a.score || {};
        const subs = AnalysisUtils.arr(sc.subs);
        const T = AnalysisService.SIGNAL_THRESHOLDS;
        const r0 = (x) => Math.round(x);

        const signalCls = { 'Achat': 'buy', 'Conserver': 'hold', 'Vente': 'sell' }[sc.signal] || 'hold';
        const tipGlobal = `Moyenne pondérée des dimensions notées : valorisation ${r0(AnalysisService.SCORE_WEIGHTS.valuation * 100)} %, ` +
            `rentabilité ${r0(AnalysisService.SCORE_WEIGHTS.profitability * 100)} %, croissance ${r0(AnalysisService.SCORE_WEIGHTS.growth * 100)} %, ` +
            `santé financière ${r0(AnalysisService.SCORE_WEIGHTS.health * 100)} %, sentiment & technique ${r0(AnalysisService.SCORE_WEIGHTS.momentum * 100)} %. ` +
            `Signal : ${T.buy} et plus = Achat, ${T.hold} à ${T.buy} = Conserver, en dessous = Vente.`;

        if (sc.global == null) {
            top.innerHTML = `<div class="score-side"><span class="score-signal hold">Non disponible</span>` +
                `<span class="score-caption">Trop peu de données publiques sur cette valeur pour calculer un score fiable.</span></div>`;
            subsEl.innerHTML = '';
            if (src) src.textContent = '';
        } else {
            top.innerHTML =
                `<div class="score-dial"><span class="score-val">${r0(sc.global)}</span><span class="score-max">/ 100</span></div>` +
                `<div class="score-side"><span class="score-signal ${signalCls}">${sc.signal}</span>` +
                `<span class="score-caption">Synthèse de ${sc.subsUsed} dimension${sc.subsUsed > 1 ? 's' : ''} sur ${subs.length}. ` +
                `${this._kvHelp(tipGlobal)}</span></div>`;

            subsEl.innerHTML = subs.map(s => {
                const v = s.value;
                const bar = v == null ? '' :
                    `<div class="score-bar"><i class="${v >= T.buy ? 'high' : (v < T.hold ? 'low' : '')}" style="width:${Math.max(2, Math.min(100, v)).toFixed(0)}%"></i></div>`;
                return `<div class="score-sub">` +
                    `<span class="score-sub-lab">${s.label} ${this._kvHelp(`Pondération ${r0(s.weight * 100)} % du score global. ${s.used} critère${s.used > 1 ? 's' : ''} disponible${s.used > 1 ? 's' : ''} sur ${s.total}.`)}</span>` +
                    `<span class="score-sub-val">${v == null ? 'Non disponible' : r0(v) + ' / 100'}</span>` +
                    bar +
                    `<span class="score-note">${Utils.escapeHtml(s.note)}</span>` +
                    `</div>`;
            }).join('');
            if (src) src.textContent = `Mis à jour le ${Utils.formatDateDisplay(a.asOf)}`;
        }
    },

    // ---------- Analyse detaillee redigee par l'IA ----------
    // Le texte est produit cote worker (POST /ai/stock-analysis), a partir du seul
    // payload structure renvoye par AnalysisService.buildAiPayload : le modele ne
    // recoit aucune donnee brute et ne va rien chercher lui-meme.
    // Trois niveaux de cache evitent de rappeler le fournisseur : le cache local
    // ci-dessous (une generation par valeur et par jour), puis le cache KV du
    // worker, puis rien du tout si l'utilisateur force la regeneration.
    RESEARCH_AI_CACHE_MAX: 20,

    _researchAiCacheRead() {
        try { return JSON.parse(localStorage.getItem(CONFIG.RESEARCH_AI_CACHE_STORAGE) || '{}') || {}; }
        catch (e) { return {}; }
    },

    _researchAiCacheWrite(key, entry) {
        const all = this._researchAiCacheRead();
        all[key] = entry;
        const keys = Object.keys(all);
        if (keys.length > this.RESEARCH_AI_CACHE_MAX) {
            keys.sort((a, b) => (all[a].storedAt || 0) - (all[b].storedAt || 0))
                .slice(0, keys.length - this.RESEARCH_AI_CACHE_MAX)
                .forEach(k => delete all[k]);
        }
        try { localStorage.setItem(CONFIG.RESEARCH_AI_CACHE_STORAGE, JSON.stringify(all)); }
        catch (e) { /* quota localStorage : le cache worker prend le relais */ }
    },

    _researchAiCacheKey(symbol, provider) {
        return `${symbol}:${provider}:${Utils.getDateString()}`;
    },

    _setResearchAiUpdated(iso) {
        const el = document.getElementById('researchAiUpdated');
        if (!el) return;
        if (!iso) { el.textContent = ''; return; }
        const d = new Date(iso);
        el.textContent = isNaN(d.getTime())
            ? ''
            : `Analyse générée le ${Utils.formatDateDisplay(Utils.getDateString(d))} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },

    // Paragraphes + « Afficher plus » : meme pattern que le resume du portefeuille
    // (le gestionnaire de clic .insights-summary-toggle est deja delegue au document).
    _researchAiTextHtml(text) {
        const paras = String(text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        const html = paras.map(p => `<p>${Utils.escapeHtml(p)}</p>`).join('');
        if (paras.length <= 2 && text.length <= 400) return `<div class="research-ai-text">${html}</div>`;
        return `<div class="research-ai-text is-clamped">${html}</div>` +
            `<button type="button" class="insights-summary-toggle">Afficher plus</button>`;
    },

    renderResearchAi(a) {
        const card = document.getElementById('researchAiCard');
        const body = document.getElementById('researchAiBody');
        const btn = document.getElementById('researchAiRefreshBtn');
        if (!card || !body) return;

        if (!a) {
            card.hidden = true;
            body.innerHTML = '';
            this._setResearchAiUpdated(null);
            if (btn) btn.hidden = true;
            return;
        }
        card.hidden = false;
        this.refreshResearchAiAnalysis(false);
    },

    async refreshResearchAiAnalysis(force = false) {
        const card = document.getElementById('researchAiCard');
        const body = document.getElementById('researchAiBody');
        const btn = /** @type {HTMLButtonElement} */ (document.getElementById('researchAiRefreshBtn'));
        const a = this.researchAnalysis;
        const symbol = this.researchSymbol;
        if (!card || !body || !a || !symbol) return;

        const provider = this.service.aiProvider;
        const hasKey = !!provider && (this.service.aiConfigured || []).includes(provider) && !!AI_PROVIDERS[provider];
        if (!hasKey) {
            body.innerHTML = '<div class="insights-plain-note">Analyse rédigée indisponible : ajoutez une clé IA dans les paramètres pour l\'activer.</div>';
            this._setResearchAiUpdated(null);
            if (btn) btn.hidden = true;
            return;
        }
        if (btn) btn.hidden = false;

        const cacheKey = this._researchAiCacheKey(symbol, provider);
        if (!force) {
            const hit = this._researchAiCacheRead()[cacheKey];
            if (hit && hit.text) {
                body.innerHTML = this._researchAiTextHtml(hit.text);
                this._setResearchAiUpdated(hit.generatedAt);
                return;
            }
        }

        if (this.researchAiRunning) return;
        this.researchAiRunning = true;
        if (btn) btn.disabled = true;
        body.innerHTML = '<div class="research-ai-skeleton"><span></span><span></span><span></span><span></span></div>';
        this._setResearchAiUpdated(null);
        try {
            const payload = AnalysisService.buildAiPayload(a, this.researchNewsItems || []);
            const out = await APIService.aiStockAnalysis(provider, payload, force);
            if (this.researchSymbol !== symbol) return;   // l'utilisateur a change de valeur
            const text = (out && out.text) || '';
            if (!text.trim()) throw new Error('réponse vide');
            body.innerHTML = this._researchAiTextHtml(text);
            this._setResearchAiUpdated(out.generatedAt);
            this._researchAiCacheWrite(cacheKey, { text, generatedAt: out.generatedAt, storedAt: Date.now() });
        } catch (e) {
            // Une analyse indisponible ne doit jamais casser le reste de la page.
            console.warn('Analyse IA indisponible', e);
            if (this.researchSymbol === symbol) {
                body.innerHTML = `<div class="insights-plain-note">Analyse temporairement indisponible (${Utils.escapeHtml(e.message || 'erreur inconnue')}).</div>`;
                this._setResearchAiUpdated(null);
            }
        } finally {
            this.researchAiRunning = false;
            if (btn) btn.disabled = false;
        }
    },

    // ---------- Comparaison sectorielle ----------
    // Sens de lecture explicite par metrique (`dir`), pour pouvoir l'ajuster :
    //   dir = -1 -> plus bas vaut mieux (PER : moins cher a benefices egaux)
    //   dir =  1 -> plus haut vaut mieux (marge, croissance, rentabilite)
    //   dir =  0 -> pas de "mieux" (la taille n'est pas un critere de qualite)
    // Seule la ligne de la valeur analysee est coloree, et toujours par rapport
    // a la mediane du groupe : un comparable isole ne fait pas reference.
    _peerCols() {
        const mult = (x) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x) + ' ×';
        const pct = (x) => Utils.formatPercent(x, false);
        return [
            { key: 'marketCap', label: 'Capitalisation', dir: 0, fmt: (x) => Utils.formatCompact(x, 'USD'),
              tip: 'Valeur totale des actions en circulation. Sert à situer la taille des entreprises comparées, pas leur qualité.' },
            { key: 'peTTM', label: 'PER', dir: -1, fmt: mult,
              tip: 'Cours rapporté au bénéfice des 12 derniers mois. Plus bas que le groupe : la valeur se paie moins cher — à condition que la rentabilité suive.' },
            { key: 'netMargin', label: 'Marge nette', dir: 1, fmt: pct,
              tip: 'Part du chiffre d\'affaires qui reste en bénéfice. Une marge nettement au-dessus du groupe traduit souvent un avantage concurrentiel.' },
            { key: 'revenueGrowth', label: 'Croissance CA', dir: 1, fmt: (x) => Utils.formatPercent(x),
              tip: 'Croissance du chiffre d\'affaires sur un an. À comparer au groupe : croître moins vite que son secteur est un signal à creuser.' },
            { key: 'roe', label: 'ROE', dir: 1, fmt: pct,
              tip: 'Rentabilité des capitaux propres : ce que l\'entreprise dégage pour 100 € apportés par les actionnaires.' }
        ];
    },

    async renderResearchPeers(a) {
        const card = document.getElementById('researchPeersCard');
        const table = document.getElementById('researchPeersTable');
        const src = document.getElementById('researchPeersSrc');
        if (!card || !table) return;
        card.hidden = false;

        const loading = (msg) => `<tbody><tr><td class="research-kv-loading">${msg}</td></tr></tbody>`;
        if (!a) {
            if (src) src.textContent = '';
            table.innerHTML = loading('Chargement…');
            return;
        }

        const symbol = a.symbol;
        table.innerHTML = loading('Chargement des comparables…');
        const d = await AnalysisService.buildPeers(a).catch(e => { console.warn('buildPeers KO', e); return null; });
        if (this.researchSymbol !== symbol) return;   // course annulee entre-temps

        if (!d || !d.peers.length) {
            table.innerHTML = loading('Non disponible — comparables sectoriels fournis pour les actions US uniquement.');
            if (src) src.textContent = '';
            return;
        }

        const cols = this._peerCols();
        const ND = '<span class="research-kv-loading">—</span>';
        const med = d.median || {};

        const head = '<thead><tr><th>Valeur</th>' +
            cols.map(c => `<th><span>${c.label} ${this._kvHelp(c.tip, 'tip-below')}</span></th>`).join('') +
            '</tr></thead>';

        const cells = (r, colored) => cols.map(c => {
            const v = r[c.key];
            if (v == null || !isFinite(v)) return `<td>${ND}</td>`;
            let cls = '';
            const m = med[c.key];
            if (colored && c.dir && m != null && isFinite(m) && v !== m) {
                cls = ((v > m) === (c.dir > 0)) ? ' class="better"' : ' class="worse"';
            }
            return `<td${cls}>${c.fmt(v)}</td>`;
        }).join('');

        const nameCell = (r) =>
            `<td><span class="peer-sym">${Utils.escapeHtml(r.symbol)}</span>` +
            `<span class="peer-name">${Utils.escapeHtml(r.name || r.symbol)}</span></td>`;

        const rows =
            `<tr class="self">${nameCell(d.self)}${cells(d.self, true)}</tr>` +
            d.peers.map(r => `<tr>${nameCell(r)}${cells(r, false)}</tr>`).join('') +
            `<tr class="median"><td><span class="peer-sym">Médiane</span>` +
            `<span class="peer-name">${d.peers.length + 1} valeurs</span></td>${cells(med, false)}</tr>`;

        table.innerHTML = head + `<tbody>${rows}</tbody>`;
        if (src) src.textContent = `${d.peers.length} comparables · Finnhub + Yahoo Finance`;
    },

    // Sous-section de la carte "Profil & risques" : titre + contenu.
    _qualSec(title, tip, inner) {
        return `<div class="qual-sec"><div class="sent-title">${title} ${this._kvHelp(tip)}</div>${inner}</div>`;
    },

    // Carte qualitative. Regle de la phase : on n'ecrit aucune analyse maison.
    // La description est reprise telle quelle de l'emetteur, les risques se
    // limitent aux scores publies par l'API — si elle n'en fournit pas, la
    // sous-section "Risques" n'est tout simplement pas affichee.
    renderResearchQualitative(a) {
        const card = document.getElementById('researchQualCard');
        const body = document.getElementById('researchQualBody');
        const src = document.getElementById('researchQualSrc');
        if (!card || !body) return;
        card.hidden = false;

        if (!a) {
            if (src) src.textContent = '';
            body.innerHTML = '<div class="research-kv"><span class="v research-kv-loading">Chargement…</span></div>';
            return;
        }

        const ND = 'Non disponible';
        const idn = a.identity || {};
        const r = a.risks || {};
        const kv = (label, valueStr, tip, extra = '') =>
            `<div class="research-kv"><span class="k">${label} ${this._kvHelp(tip)}</span>` +
            `<span class="v">${valueStr == null ? ND : valueStr}</span>${extra}</div>`;
        const secs = [];

        // ----- Activite : texte de l'emetteur, jamais reformule -----
        if (idn.description) {
            const long = idn.description.length > 420;
            secs.push(this._qualSec('Activité',
                'Description de l\'activité publiée par l\'émetteur et reprise telle quelle par la source de données. Ce n\'est pas une analyse.',
                `<p class="qual-text${long ? ' clamp' : ''}" id="researchQualText">${Utils.escapeHtml(idn.description)}</p>` +
                (long ? '<button type="button" class="qual-more" id="researchQualMore">Lire la suite</button>' : '') +
                (idn.employees == null ? '' :
                    `<div class="research-kv-grid" style="margin-top:16px">${kv('Effectif',
                        Utils.formatCompact(idn.employees) + ' salariés',
                        'Nombre de salariés à temps plein déclaré par l\'entreprise. Utile pour situer sa taille au-delà de la capitalisation.')}</div>`)
            ));
        }

        // ----- Risques -----
        // Beta : 1 = amplitude du marche. Seuils explicites et ajustables :
        // < 0,8 defensif, 0,8-1,2 dans la moyenne, > 1,2 plus volatil.
        const beta = (r.beta == null || !isFinite(r.beta)) ? null : r.beta;
        const betaTag = beta == null ? ''
            : `<span class="kv-tag ${beta > 1.2 ? 'warn' : (beta < 0.8 ? 'ok' : 'mid')}">` +
              `${beta > 1.2 ? 'plus volatil' : (beta < 0.8 ? 'défensif' : 'proche du marché')}</span>`;

        // Scores de gouvernance Yahoo : echelle 1 a 10, 1 = risque le plus faible.
        // Seuils explicites et ajustables : <= 3 faible, <= 6 modere, > 6 eleve.
        const govKv = (label, score, tip) => {
            const s = (score == null || !isFinite(score)) ? null : score;
            const tag = s == null ? ''
                : `<span class="kv-tag ${s > 6 ? 'warn' : (s > 3 ? 'mid' : 'ok')}">` +
                  `${s > 6 ? 'élevé' : (s > 3 ? 'modéré' : 'faible')}</span>`;
            return kv(label, s == null ? null : `${s} / 10`, tip, tag);
        };

        if (beta != null || r.hasGovernance) {
            let rows = '';
            if (beta != null) {
                rows += kv('Volatilité (bêta)',
                    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(beta),
                    'Amplitude des variations du titre par rapport au marché. 1 = même amplitude ; au-dessus, le titre bouge plus fort dans les deux sens.',
                    betaTag);
            }
            if (r.hasGovernance) {
                const g = r.governance || {};
                rows +=
                    govKv('Gouvernance (global)', g.overall,
                        'Score de risque de gouvernance publié par la source de données, de 1 (risque le plus faible) à 10 (le plus élevé).') +
                    govKv('Audit', g.audit,
                        'Risque lié aux pratiques comptables et au contrôle des comptes, de 1 (faible) à 10 (élevé).') +
                    govKv('Conseil d\'administration', g.board,
                        'Risque lié à la composition et à l\'indépendance du conseil, de 1 (faible) à 10 (élevé).') +
                    govKv('Rémunération des dirigeants', g.compensation,
                        'Risque lié à l\'alignement des rémunérations des dirigeants avec l\'intérêt des actionnaires, de 1 (faible) à 10 (élevé).') +
                    govKv('Droits des actionnaires', g.shareholderRights,
                        'Risque lié au pouvoir réel des actionnaires minoritaires (droits de vote, protections statutaires), de 1 (faible) à 10 (élevé).');
            }
            secs.push(this._qualSec('Risques',
                'Uniquement les indicateurs de risque publiés par les sources de données. Aucun risque n\'est rédigé ni déduit ici ; les points non couverts par l\'API sont simplement absents.',
                `<div class="research-kv-grid">${rows}</div>`));
        }

        // ----- Calendrier des catalyseurs -----
        const e = a.earnings || {};
        const hourLabel = { bmo: 'avant ouverture', amc: 'après clôture', dmh: 'en séance' }[e.hour] || null;
        const cur = (a.price && a.price.currency) || idn.currency || 'USD';
        const q0 = AnalysisUtils.arr(a.growth && a.growth.estimatesShortTerm).find(x => x.period === '0q');
        const exDate = a.dividend && a.dividend.exDate;

        secs.push(this._qualSec('Calendrier',
            'Prochaines échéances connues susceptibles de faire bouger le cours. Les dates viennent du calendrier des publications, disponible pour les actions américaines uniquement.',
            '<div class="research-kv-grid">' +
            kv('Prochains résultats', !e.date ? null : Utils.formatDateDisplay(e.date),
                'Date de la prochaine publication de résultats trimestriels.',
                hourLabel ? `<span class="kv-cmp">${hourLabel}</span>` : '') +
            kv('BPA attendu', (e.epsEstimate == null) ? null : Utils.formatCurrency(e.epsEstimate, cur),
                'Bénéfice par action attendu en moyenne par les analystes pour ce trimestre. Un écart à la publication déclenche souvent une forte réaction du cours.') +
            kv('CA attendu', (e.revenueEstimate == null) ? null : Utils.formatCompact(e.revenueEstimate, cur),
                'Chiffre d\'affaires attendu en moyenne par les analystes pour ce trimestre.') +
            kv('Fin du trimestre en cours', (q0 && q0.endDate) ? Utils.formatDateDisplay(q0.endDate) : null,
                'Date de clôture du trimestre dont les résultats seront publiés ensuite.') +
            kv('Détachement du dividende', !exDate ? null : Utils.formatDateDisplay(exDate),
                'Date à partir de laquelle le titre s\'échange sans le prochain dividende. Acheter après cette date n\'y donne pas droit.') +
            '</div>'));

        body.innerHTML = secs.join('');

        const more = document.getElementById('researchQualMore');
        if (more) {
            more.addEventListener('click', () => {
                const p = document.getElementById('researchQualText');
                if (!p) return;
                const open = p.classList.toggle('clamp');
                more.textContent = open ? 'Lire la suite' : 'Réduire';
            });
        }

        if (src) src.textContent = idn.description ? 'Profil : émetteur · Risques : Yahoo Finance' : 'Description indisponible';
    },

    // Trace MM 50 / MM 200 par-dessus la courbe de cours existante. Les moyennes
    // viennent de l'analyse (15 mois d'historique) : rien n'est re-telecharge, et
    // les points hors de cette fenetre restent vides plutot qu'approximes.
    // Moyennes mobiles affichees par defaut, mais masquables : la legende sous le
    // graphe sert d'interrupteur. L'etat vit ici pour survivre a un changement de
    // plage ou de valeur, qui reconstruit les datasets.
    researchMaVisible: { ma50: true, ma200: true },

    applyResearchMaOverlay() {
        const chart = this.researchChart;
        if (!chart || !chart.data || !Array.isArray(chart.data.datasets) || !chart.data.datasets.length) return;
        const t = this.researchAnalysis && this.researchAnalysis.technical;
        const dates = this.researchChartDates || [];
        const ink = this.chartInk();
        const colors = { ma50: ink.acc, ma200: ink.tick };
        const available = { ma50: false, ma200: false };

        const extra = [];
        if (t && t.maSeries && dates.length) {
            const idx = {};
            t.maSeries.dates.forEach((d, i) => { idx[d] = i; });
            const pick = (serie) => dates.map(d => (idx[d] === undefined ? null : serie[idx[d]]));
            const add = (key, label, serie, dash) => {
                const data = pick(serie);
                if (!data.some(v => v != null)) return;
                // La moyenne existe : la legende doit l'annoncer meme si l'utilisateur
                // l'a masquee, sinon l'interrupteur devient introuvable.
                available[key] = true;
                if (!this.researchMaVisible[key]) return;
                extra.push({
                    label, data, borderColor: colors[key], backgroundColor: 'transparent',
                    borderWidth: 1.4, borderDash: dash, fill: false, tension: 0,
                    pointRadius: 0, pointHoverRadius: 0, spanGaps: false
                });
            };
            add('ma50', 'MM 50', t.maSeries.ma50, []);
            add('ma200', 'MM 200', t.maSeries.ma200, [5, 4]);
        }

        chart.data.datasets = [chart.data.datasets[0], ...extra];
        chart.update();
        this.renderResearchMaLegend(available, colors);
    },

    renderResearchMaLegend(available, colors) {
        const box = document.getElementById('researchMaLegend');
        if (!box) return;
        const any = available.ma50 || available.ma200;
        box.hidden = !any;
        if (!any) return;

        /** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll('.ma-toggle')).forEach(btn => {
            const key = btn.dataset.ma;
            btn.hidden = !available[key];
            const on = !!this.researchMaVisible[key];
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            const swatch = /** @type {HTMLElement} */ (btn.querySelector('.ma-swatch'));
            // Couleur posee seulement quand la courbe est visible : masquee, le
            // trait reprend le gris defini en CSS.
            if (swatch) swatch.style.borderTopColor = on ? colors[key] : '';
        });
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

    renderResearchAbout(fund) {
        const card = document.getElementById('researchAboutCard');
        const grid = document.getElementById('researchAboutGrid');
        const rows = [];
        const kv = (k, v) => rows.push(`<div class="research-kv"><span class="k">${k}</span><span class="v">${v}</span></div>`);
        if (fund && fund.industry) kv('Secteur', fund.industry);
        if (fund && fund.country) kv('Pays', fund.country);
        if (fund && fund.ipo) kv('Introduction en bourse', Utils.formatDateDisplay(fund.ipo));
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
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('researchChart'));
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
        this.researchNewsItems = [];
        try {
            const results = await APIService.webSearch(`${symbol} ${name} action bourse`);
            if (this.researchSymbol !== symbol || !results || !results.length) return;
            const shown = results.slice(0, 4).map(r => {
                let host = '';
                try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) {}
                return { ...r, host };
            });
            // Memorise les seuls titres affiches : c'est ce que recevra l'analyse
            // IA, jamais le contenu brut de la page.
            this.researchNewsItems = shown
                .filter(r => r.title)
                .map(r => ({ title: r.title, source: r.host || null, date: r.publishedDate || null }));
            list.innerHTML = shown.map(r => {
                const d = r.publishedDate ? Utils.formatDateDisplay(r.publishedDate) : '';
                return `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title || r.host}</a><span class="rn-meta">${[r.host, d].filter(Boolean).join(' · ')}</span></li>`;
            }).join('');
            card.hidden = false;
        } catch (e) { /* actualités indisponibles */ }
    },
};

// Expose le controleur pour les tests end-to-end (page.evaluate).
window.App = App;

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

export { App, AnalysisUtils, AnalysisService, APIService, Utils, PortfolioService, CONFIG, AI_PROVIDERS };
