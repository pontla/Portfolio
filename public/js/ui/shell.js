/**
 * Ossature de l'app : theme, menu lateral, ecrans d'accueil et d'authentification, amorcage.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { CONFIG } from '../core/config.js';
import { AuthService, isJwtTimingError } from '../core/auth.js';
import { Icons } from '../icons.js';

export const shell = {
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
};
