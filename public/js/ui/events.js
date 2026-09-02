/**
 * Cablage des evenements, decoupe par ecran, et actions de la modale de transaction.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { CONFIG, AI_PROVIDERS } from '../core/config.js';
import { AuthService } from '../core/auth.js';
import { Utils } from '../core/utils.js';
import { APIService } from '../core/api.js';

export const events = {
    // Le cablage est decoupe par ecran : chaque bind* ne connait que ses propres
    // elements. Les methodes qui manipulent la modale de transaction passent par
    // _txForm(), pour ne pas dependre d'une closure de cablage.
    setupEventListeners() {
        this.bindGlobalFallbacks();
        this.bindStatsCarousel();
        this.bindPortfolioSwitcher();
        this.bindSettingsModal();
        this.bindTransactionModal();
        this.bindSymbolSearch();
        this.bindChartControls();
        this.bindDelegatedActions();
        this.bindTransactionFilters();
    },

    // --- REPLIS SANS HANDLERS INLINE (compat CSP stricte) ---
    bindGlobalFallbacks() {
        // --- REPLIS SANS HANDLERS INLINE (compat CSP stricte) ---
        // Image cassée : masquer et, si demandé, afficher le monogramme voisin.
        // Les évènements `error` ne bouillonnent pas -> écoute en phase de capture.
        document.addEventListener(
            'error',
            (e) => {
                const img = e.target;
                if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
                if (img.dataset.fallback === 'hide') {
                    img.style.visibility = 'hidden';
                } else if (img.dataset.fallback === 'sibling') {
                    img.style.display = 'none';
                    if (img.nextElementSibling)
                        /** @type {HTMLElement} */ (img.nextElementSibling).style.display = 'flex';
                }
            },
            true
        );

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
                const more = /** @type {HTMLElement} */ (
                    grpBtn.parentElement.querySelector('.insights-more')
                );
                if (!more) return;
                const expanded = more.style.display !== 'none';
                more.style.display = expanded ? 'none' : 'block';
                grpBtn.textContent = expanded ? 'Afficher plus' : 'Afficher moins';
            }
        });
    },

    // --- CARROUSEL DES CARTES DE SYNTHESE (mobile) ---
    bindStatsCarousel() {
        // --- STATS CAROUSEL DOTS (mobile) ---
        const statsGrid = document.getElementById('statsGrid');
        const statsDots = document.getElementById('statsDots');
        if (statsGrid && statsDots) {
            const dots = statsDots.querySelectorAll('.dot');
            statsGrid.addEventListener(
                'scroll',
                () => {
                    const card = /** @type {HTMLElement} */ (statsGrid.querySelector('.stat-card'));
                    const step = card ? card.offsetWidth + 12 : statsGrid.clientWidth || 1;
                    const idx = Math.max(
                        0,
                        Math.min(dots.length - 1, Math.round(statsGrid.scrollLeft / step))
                    );
                    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
                },
                { passive: true }
            );
        }
    },

    // --- SWITCHER DE PORTEFEUILLE + MODALE CREATION/EDITION ---
    bindPortfolioSwitcher() {
        // --- PORTFOLIO SWITCHER DROPDOWN ---
        const switcherContainer = document.getElementById('portfolioDropdownContainer');
        const switcherBtn = document.getElementById('portfolioSwitcherBtn');
        const openCreateBtn = document.getElementById('openCreatePortfolioBtn');
        const portfolioModal = document.getElementById('portfolioModal');
        const closePortfolioModalBtn = document.getElementById('closePortfolioModalBtn');
        const portfolioForm = /** @type {HTMLFormElement} */ (
            document.getElementById('portfolioForm')
        );
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
                /** @type {HTMLInputElement} */ (document.getElementById('portfolioEditId')).value =
                    '';
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
    },

    // --- MODALE DE REGLAGES (donnees, CSV, fournisseur IA, compte) ---
    bindSettingsModal() {
        // SETTINGS MODAL
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettings = document.getElementById('closeSettingsBtn');
        const reloadPricesBtn = document.getElementById('reloadPricesBtn');
        const syncDividendsBtn = /** @type {HTMLButtonElement} */ (
            document.getElementById('syncDividendsBtn')
        );
        const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
        const exportCsvBtn = document.getElementById('exportCsvBtn');
        const importCsvBtn = document.getElementById('importCsvBtn');
        const importCsvInput = /** @type {HTMLInputElement} */ (
            document.getElementById('importCsvInput')
        );
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
        const refreshDataBtn = /** @type {HTMLButtonElement} */ (
            document.getElementById('refreshDataBtn')
        );
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
                    alert(
                        added > 0 ? `${added} dividende(s) ajouté(s).` : 'Aucun nouveau dividende.'
                    );
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
                this.downloadCSV(
                    `portefeuille_${Utils.getDateString()}.csv`,
                    this.service.exportToCSV()
                );
            };
        }
        if (downloadTemplateBtn) {
            downloadTemplateBtn.onclick = () => {
                const headers = [
                    'date',
                    'type',
                    'symbol',
                    'qty',
                    'price',
                    'currency',
                    'fees',
                    'amount',
                    'cashSource',
                    'portfolio',
                ];
                // cashSource (achats uniquement) : CASH = prelevé sur le cash du
                // portefeuille, DIRECT = titre acquis hors cash. Vide = CASH.
                const rows = [
                    [
                        '2026-01-01',
                        'DEPOSIT',
                        '',
                        '',
                        '',
                        '',
                        '',
                        '2000',
                        '',
                        'Portefeuille Principal',
                    ],
                    [
                        '2026-01-15',
                        'BUY',
                        'AAPL',
                        '10',
                        '185,50',
                        'USD',
                        '5',
                        '',
                        'CASH',
                        'Portefeuille Principal',
                    ],
                    [
                        '2026-02-10',
                        'BUY',
                        'MC.PA',
                        '5',
                        '720',
                        'EUR',
                        '3,5',
                        '',
                        'DIRECT',
                        'Portefeuille Principal',
                    ],
                    [
                        '2026-03-05',
                        'SELL',
                        'AAPL',
                        '4',
                        '195,20',
                        'USD',
                        '5',
                        '',
                        '',
                        'Portefeuille Principal',
                    ],
                    [
                        '2026-04-01',
                        'WITHDRAWAL',
                        '',
                        '',
                        '',
                        '',
                        '',
                        '500',
                        '',
                        'Portefeuille Principal',
                    ],
                    [
                        '2026-02-20',
                        'DIVIDEND',
                        'AAPL',
                        '',
                        '',
                        '',
                        '',
                        '12,34',
                        '',
                        'Portefeuille Principal',
                    ],
                    ['2026-01-20', 'FEE', '', '', '', '', '', '9,99', '', 'Portefeuille Principal'],
                ];
                const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
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
                    if (errors.length)
                        msg += `\n${errors.length} erreur(s) :\n` + errors.slice(0, 10).join('\n');
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
        const aiProviderSelect = /** @type {HTMLSelectElement} */ (
            document.getElementById('aiProviderSelect')
        );
        const aiKeyInput = /** @type {HTMLInputElement} */ (document.getElementById('aiKeyInput'));
        const saveAiKeyBtn = /** @type {HTMLButtonElement} */ (
            document.getElementById('saveAiKeyBtn')
        );
        const clearAiKeyBtn = /** @type {HTMLButtonElement} */ (
            document.getElementById('clearAiKeyBtn')
        );

        const refreshAiKeyInputForProvider = () => {
            if (!aiProviderSelect || !aiKeyInput) return;
            const p = aiProviderSelect.value;
            const configured = p && (this.service.aiConfigured || []).includes(p);
            aiKeyInput.value = '';
            aiKeyInput.placeholder = !p
                ? 'Clé API'
                : configured
                  ? '•••••••••• (clé enregistrée — saisir pour remplacer)'
                  : AI_PROVIDERS[p]
                    ? AI_PROVIDERS[p].keyPlaceholder
                    : 'Clé API';
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
                    alert(
                        "Impossible d'enregistrer le fournisseur sur le compte : " +
                            (e.message || e)
                    );
                }
            };
        }
        if (saveAiKeyBtn) {
            saveAiKeyBtn.onclick = async () => {
                const p = aiProviderSelect.value;
                if (!p) {
                    alert('Choisis un fournisseur IA.');
                    return;
                }
                const key = aiKeyInput.value.trim();
                if (!key) {
                    alert('Saisis une clé API.');
                    return;
                }
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
    },

    // --- MODALE DE TRANSACTION : ouverture et soumission -------------------
    bindTransactionModal() {
        const f = this._txForm();
        if (f.form.elements['date']) f.form.elements['date'].max = Utils.getDateString();
        this.editingTradeId = null;

        f.form.querySelectorAll('input[name="type"]').forEach((radio) => {
            radio.addEventListener('change', (e) => {
                this.syncTransactionFormFields(/** @type {HTMLInputElement} */ (e.target).value);
            });
        });

        // Le cash disponible depend de la date, du portefeuille et du montant :
        // le rappel se recalcule a chaque changement de l'un d'eux.
        ['qtyInputField', 'priceInputField', 'feesInputField', 'priceCurrencyField'].forEach(
            (id) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.syncCashSourceHint());
            }
        );
        if (f.form.elements['date']) {
            f.form.elements['date'].addEventListener('change', () => this.syncCashSourceHint());
        }
        if (f.portSelect) {
            f.portSelect.addEventListener('change', () => this.syncCashSourceHint());
        }

        const open = () => this.openTransactionModal();
        document.getElementById('addTransactionBtn').onclick = open;
        const openBtnFab = document.getElementById('addTransactionFab');
        if (openBtnFab) openBtnFab.onclick = open;
        const emptyAddBtn = document.getElementById('emptyAddBtn');
        if (emptyAddBtn) emptyAddBtn.onclick = open;
        const emptyImportBtn = document.getElementById('emptyImportBtn');
        if (emptyImportBtn)
            emptyImportBtn.onclick = () => {
                const inp = document.getElementById('importCsvInput');
                if (inp) inp.click();
            };

        document.getElementById('closeModalBtn').onclick = () => f.modal.classList.remove('open');
        f.form.onsubmit = (e) => this.submitTransactionForm(e);
    },

    // --- RECHERCHE DE SYMBOLE (depuis le champ de la modale) --------------
    bindSymbolSearch() {
        const searchModal = document.getElementById('symbolSearchModal');
        const searchInput = /** @type {HTMLInputElement} */ (
            document.getElementById('globalSearchInput')
        );
        const resultsList = document.getElementById('searchResultsList');
        const f = this._txForm();

        f.symbolInput.addEventListener('blur', () => {
            if (f.symbolInput.value.trim()) {
                f.priceCurrencyField.value = Utils.getCurrency(f.symbolInput.value.trim());
            }
        });

        f.symbolInput.addEventListener('click', () => {
            const currentType = f.form.elements['type'].value;
            if (currentType === 'BUY' || currentType === 'SELL' || currentType === 'DIVIDEND') {
                searchModal.classList.add('open');
                searchInput.value = '';
                searchInput.focus();
                resultsList.innerHTML =
                    '<div class="search-placeholder">Commencez à taper un symbole ou nom d\'entreprise...</div>';
            }
        });

        document.getElementById('closeSearchBtn').onclick = () =>
            searchModal.classList.remove('open');

        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const query = /** @type {HTMLInputElement} */ (e.target).value.trim();
            if (query.length < 1) return;

            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                resultsList.innerHTML =
                    '<div class="search-placeholder">Recherche en cours...</div>';
                const results = await APIService.searchSymbol(query);
                this.renderSymbolSearchResults(results);
            }, 250);
        });
    },

    // --- CONTROLES DU GRAPHIQUE ET NAVIGATION PAR ONGLETS ---
    bindChartControls() {
        // Currency Toggle
        const currencyToggle = document.getElementById('currencyToggle');
        if (currencyToggle) {
            /** @type {NodeListOf<HTMLElement>} */ (
                currencyToggle.querySelectorAll('.toggle-btn')
            ).forEach((btn) => {
                btn.onclick = () => {
                    currencyToggle
                        .querySelectorAll('.toggle-btn')
                        .forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.chartState.currency = btn.dataset.currency || 'USD';
                    localStorage.setItem(CONFIG.CURRENCY_STORAGE, this.chartState.currency);
                    this.render();
                };
            });
        }

        // Value / Perf Toggle
        /** @type {NodeListOf<HTMLElement>} */ (
            document.querySelectorAll('.toggle-group:not(#currencyToggle) .toggle-btn')
        ).forEach((btn) => {
            btn.onclick = () => {
                btn.parentElement
                    .querySelectorAll('.toggle-btn')
                    .forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.mode = btn.textContent.trim() === 'Performance' ? 'PERF' : 'VALUE';
                this.render();
            };
        });

        // Benchmarks
        /** @type {NodeListOf<HTMLElement>} */ (
            document.querySelectorAll('.benchmark-checkbox-btn')
        ).forEach((btn) => {
            btn.onclick = () => {
                btn.classList.toggle('active');
                const symbol = btn.dataset.symbol;
                if (btn.classList.contains('active')) {
                    if (!this.chartState.benchmarks.includes(symbol)) {
                        this.chartState.benchmarks.push(symbol);
                    }
                    if (this.chartState.mode !== 'PERF') {
                        this.chartState.mode = 'PERF';
                        document
                            .querySelectorAll('.toggle-group:not(#currencyToggle) .toggle-btn')
                            .forEach((b) => {
                                b.classList.toggle(
                                    'active',
                                    b.textContent.trim() === 'Performance'
                                );
                            });
                    }
                } else {
                    this.chartState.benchmarks = this.chartState.benchmarks.filter(
                        (s) => s !== symbol
                    );
                }
                this.render();
            };
        });

        // Performance list filter
        const perfFilterGroup = document.getElementById('perfFilterGroup');
        if (perfFilterGroup) {
            /** @type {NodeListOf<HTMLElement>} */ (
                perfFilterGroup.querySelectorAll('.filter-btn')
            ).forEach((btn) => {
                btn.onclick = () => {
                    perfFilterGroup
                        .querySelectorAll('.filter-btn')
                        .forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.chartState.perfFilter = btn.dataset.filter;
                    this.render();
                };
            });
        }

        // Range Buttons
        /** @type {NodeListOf<HTMLElement>} */ (
            document.querySelectorAll('#timeRangeSelector .range-btn')
        ).forEach((btn) => {
            btn.onclick = () => {
                document
                    .querySelectorAll('#timeRangeSelector .range-btn')
                    .forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.range = btn.dataset.range || 'ALL';
                this.render();
            };
        });

        // Profit chart range buttons
        /** @type {NodeListOf<HTMLElement>} */ (
            document.querySelectorAll('#profitRangeSelector .range-btn')
        ).forEach((btn) => {
            btn.onclick = () => {
                document
                    .querySelectorAll('#profitRangeSelector .range-btn')
                    .forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartState.profitRange = btn.dataset.range || 'ALL';
                this.render();
            };
        });

        // Navigation Tabs — sous-nav, nav basse et menu lateral pilotent le meme etat
        /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-btn')).forEach(
            (btn) => {
                btn.onclick = () => {
                    const tab = btn.dataset.tab;
                    /** @type {NodeListOf<HTMLElement>} */ (
                        document.querySelectorAll('.tab-btn')
                    ).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
                    document
                        .querySelectorAll('.tab-content')
                        .forEach((c) => c.classList.remove('active'));
                    const tabTarget = document.getElementById(`view-${tab}`);
                    if (tabTarget) tabTarget.classList.add('active');

                    // Charts created while their tab was hidden (display:none) can be
                    // measured with a stale size by Chart.js; force a resize once visible.
                    [
                        this.chart,
                        this.profitChart,
                        this.assetChart,
                        this.classChart,
                        this.currencyChart,
                        this.sectorChart,
                        this.researchChart,
                    ].forEach((c) => c && c.resize());

                    if (tab === 'research') this.onResearchTabShown();
                };
            }
        );
    },

    // --- ACTIONS DELEGUEES sur du markup injecte (cartes, tableaux, menus) -
    bindDelegatedActions() {
        document.addEventListener('click', async (e) => {
            // Menu "..." des cartes de transaction (mobile)
            const txMenuBtn = /** @type {Element} */ (e.target).closest('.tx-menu-btn');
            document.querySelectorAll('.tx-card.menu-open').forEach((c) => {
                if (!txMenuBtn || c !== txMenuBtn.closest('.tx-card'))
                    c.classList.remove('menu-open');
            });
            if (txMenuBtn) {
                e.stopPropagation();
                txMenuBtn.closest('.tx-card').classList.toggle('menu-open');
                return;
            }

            const editTradeBtn = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.edit-trade-btn')
            );
            if (editTradeBtn) {
                const trade = this.service.trades.find((t) => t.id === editTradeBtn.dataset.id);
                if (trade) this.openTradeEditor(trade);
            }

            const delBtn = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.delete-trade-btn')
            );
            if (delBtn) {
                if (confirm('Voulez-vous vraiment supprimer cette transaction ?')) {
                    try {
                        await this.service.removeTrade(delBtn.dataset.id);
                    } catch (err) {
                        alert('Erreur : ' + err.message);
                    }
                }
            }

            const assetCell = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.holding-asset-cell')
            );
            if (assetCell) {
                this.goToResearch(assetCell.dataset.symbol);
            }

            const sellBtn = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.quick-sell-btn')
            );
            if (sellBtn) {
                this.openQuickSell(
                    sellBtn.dataset.symbol,
                    sellBtn.dataset.qty,
                    sellBtn.dataset.price
                );
            }

            // Edit portfolio
            const editPortBtn = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.edit-portfolio-btn')
            );
            if (editPortBtn) {
                e.stopPropagation();
                document.getElementById('portfolioDropdownContainer').classList.remove('open');
                const port = this.service.getPortfolioById(editPortBtn.dataset.id);
                if (port) this.openPortfolioEditor(port);
            }

            // Delete portfolio
            const delPortBtn = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.delete-portfolio-btn')
            );
            if (delPortBtn) {
                e.stopPropagation();
                const pId = delPortBtn.dataset.id;
                const port = this.service.getPortfolioById(pId);
                if (
                    confirm(
                        `Voulez-vous vraiment supprimer le portefeuille "${port.name}" et toutes ses transactions ?`
                    )
                ) {
                    try {
                        const removed = await this.service.deletePortfolio(pId);
                        if (!removed) {
                            alert('Impossible de supprimer le seul portefeuille existant.');
                            return;
                        }
                    } catch (err) {
                        alert('Erreur : ' + err.message);
                    }
                }
            }

            // Switch to specific portfolio
            const portItem = /** @type {HTMLElement} */ (
                /** @type {Element} */ (e.target).closest('.portfolio-item-select')
            );
            if (portItem) {
                this.service.setActivePortfolio(portItem.dataset.id);
                document.getElementById('portfolioDropdownContainer').classList.remove('open');
            }
        });
    },

    // --- FILTRES DE TRANSACTIONS (feuille de filtres) ---
    bindTransactionFilters() {
        // --- TRANSACTIONS FILTERS (feuille de filtres) ---
        const txSearchInput = /** @type {HTMLInputElement} */ (
            document.getElementById('txSearchInput')
        );
        const txFromFilter = /** @type {HTMLInputElement} */ (
            document.getElementById('txFromFilter')
        );
        const txToFilter = /** @type {HTMLInputElement} */ (document.getElementById('txToFilter'));
        const txFilterModal = document.getElementById('txFilterModal');
        const txFilterOpenBtn = document.getElementById('txFilterOpenBtn');
        const txFilterResetBtn = document.getElementById('txFilterResetBtn');
        const txApplyBtn = document.getElementById('txApplyBtn');
        const txTypePills = document.getElementById('txTypePills');

        const syncTxFilterUI = () => {
            if (txTypePills)
                txTypePills.querySelectorAll('button').forEach((b) => {
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
            txFilterOpenBtn.onclick = () => {
                syncTxFilterUI();
                txFilterModal.classList.add('open');
            };
            txFilterModal.addEventListener('click', (e) => {
                if (e.target === txFilterModal) txFilterModal.classList.remove('open');
            });
        }
        if (txTypePills) {
            txTypePills.querySelectorAll('button').forEach((btn) => {
                btn.onclick = () => {
                    const t = btn.dataset.type;
                    const i = this.txFilters.types.indexOf(t);
                    if (i === -1) this.txFilters.types.push(t);
                    else this.txFilters.types.splice(i, 1);
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

    // Poignees DOM de la modale de transaction. Relues a chaque appel : les
    // elements sont statiques dans index.html, et cela evite que les methodes
    // qui manipulent le formulaire dependent d'une closure de cablage.
    _txForm() {
        const $ = (id) => document.getElementById(id);
        return {
            modal: $('transactionModal'),
            title: $('transactionModalTitle'),
            form: /** @type {HTMLFormElement} */ ($('transactionForm')),
            symbolGroup: $('symbolGroup'),
            symbolInput: /** @type {HTMLInputElement} */ ($('symbolInputField')),
            qtyPriceRow: $('qtyPriceRow'),
            qtyInput: /** @type {HTMLInputElement} */ ($('qtyInputField')),
            priceInput: /** @type {HTMLInputElement} */ ($('priceInputField')),
            amountGroup: $('amountGroup'),
            amountInput: /** @type {HTMLInputElement} */ ($('amountInputField')),
            amountLabel: $('amountLabel'),
            priceCurrencyGroup: $('priceCurrencyGroup'),
            priceCurrencyField: /** @type {HTMLSelectElement} */ ($('priceCurrencyField')),
            feesGroup: $('feesGroup'),
            feesInput: /** @type {HTMLInputElement} */ ($('feesInputField')),
            cashSourceGroup: $('cashSourceGroup'),
            cashSourceHint: $('cashSourceHint'),
            portSelect: /** @type {HTMLSelectElement} */ ($('targetPortfolioSelect')),
        };
    },

    // Adapte les champs visibles et obligatoires au type d'operation choisi.
    syncTransactionFormFields(type) {
        const f = this._txForm();
        if (type === 'DEPOSIT' || type === 'WITHDRAWAL') {
            f.symbolGroup.style.display = 'none';
            f.symbolInput.removeAttribute('required');
            f.symbolInput.value = '$CASH';

            f.qtyPriceRow.style.display = 'none';
            f.qtyInput.removeAttribute('required');
            f.priceInput.removeAttribute('required');
            f.priceCurrencyGroup.style.display = 'none';
            f.feesGroup.style.display = 'none';

            f.amountGroup.style.display = 'block';
            f.amountInput.setAttribute('required', 'true');
            f.amountLabel.textContent =
                type === 'DEPOSIT' ? 'Montant du dépôt ($)' : 'Montant du retrait ($)';
            f.cashSourceGroup.style.display = 'none';
        } else if (type === 'DIVIDEND' || type === 'FEE') {
            f.symbolGroup.style.display = 'block';
            f.symbolInput.removeAttribute('required');
            f.symbolInput.placeholder =
                type === 'DIVIDEND' ? 'Symbole concerné (ex: AAPL)' : 'Frais de courtage';

            f.qtyPriceRow.style.display = 'none';
            f.qtyInput.removeAttribute('required');
            f.priceInput.removeAttribute('required');
            f.priceCurrencyGroup.style.display = 'none';
            f.feesGroup.style.display = 'none';

            f.amountGroup.style.display = 'block';
            f.amountInput.setAttribute('required', 'true');
            f.amountLabel.textContent =
                type === 'DIVIDEND' ? 'Montant du dividende net ($)' : 'Montant des frais ($)';
            f.cashSourceGroup.style.display = 'none';
        } else {
            f.symbolGroup.style.display = 'block';
            f.symbolInput.setAttribute('required', 'true');
            f.symbolInput.placeholder = 'Rechercher (ex: AAPL, MC.PA...)';

            f.qtyPriceRow.style.display = 'grid';
            f.qtyInput.setAttribute('required', 'true');
            f.priceInput.setAttribute('required', 'true');
            f.priceCurrencyGroup.style.display = 'block';
            f.feesGroup.style.display = 'block';

            f.amountGroup.style.display = 'none';
            f.amountInput.removeAttribute('required');

            // Le financement ne concerne que l'achat : une vente alimente
            // toujours le cash, elle n'a pas d'origine a choisir.
            f.cashSourceGroup.style.display = type === 'BUY' ? 'block' : 'none';
        }
        if (type === 'BUY') this.syncCashSourceHint();
    },

    // Rappelle le cash disponible a la date saisie et bascule sur « Achat direct »
    // quand il ne couvre pas l'operation : le cash ne peut jamais etre negatif.
    syncCashSourceHint() {
        const f = this._txForm();
        if (!f.cashSourceHint || !f.form) return;
        const fd = new FormData(f.form);
        if (fd.get('type') !== 'BUY') return;

        const portfolioId =
            /** @type {string} */ (fd.get('portfolioId')) ||
            (this.service.activePortfolioId !== 'GLOBAL' ? this.service.activePortfolioId : null);
        const date = /** @type {string} */ (fd.get('date')) || Utils.getDateString();
        const availableUSD = this.service.getCashAvailableOnDate(date, {
            excludeTradeId: this.editingTradeId,
            portfolioId,
        });

        const symbol = /** @type {string} */ (fd.get('symbol') || '').toUpperCase();
        const enteredCurrency =
            /** @type {string} */ (fd.get('priceCurrency')) ||
            (symbol ? Utils.getCurrency(symbol) : 'USD');
        const available = this.service.convertCurrency(availableUSD, 'USD', enteredCurrency);
        const cost =
            (parseFloat(/** @type {string} */ (fd.get('qty'))) || 0) *
                (parseFloat(/** @type {string} */ (fd.get('price'))) || 0) +
            (parseFloat(/** @type {string} */ (fd.get('fees'))) || 0);

        const enough = cost > 0 && cost <= available + 0.0001;
        const radios = /** @type {NodeListOf<HTMLInputElement>} */ (
            f.form.querySelectorAll('input[name="cashSource"]')
        );
        radios.forEach((r) => {
            if (r.value === 'CASH') r.disabled = !(available > 0.0001);
        });
        // Rien a prelever : on force l'achat direct plutot que de laisser
        // l'utilisateur buter sur une erreur de validation.
        if (!(available > 0.0001)) {
            radios.forEach((r) => {
                r.checked = r.value === 'DIRECT';
            });
        }

        f.cashSourceHint.textContent = !(available > 0.0001)
            ? `Aucun cash disponible au ${Utils.formatDateDisplay(date)} : l'achat est enregistré en direct, sans impact sur le cash.`
            : cost > 0 && !enough
              ? `Cash disponible au ${Utils.formatDateDisplay(date)} : ${Utils.formatCurrency(available, enteredCurrency)} — insuffisant pour ${Utils.formatCurrency(cost, enteredCurrency)}. Choisissez « Achat direct ».`
              : `Cash disponible au ${Utils.formatDateDisplay(date)} : ${Utils.formatCurrency(available, enteredCurrency)}. « Achat direct » pour un titre acquis hors cash du portefeuille.`;
    },

    // Nouvelle transaction : formulaire vierge, date du jour, portefeuille actif.
    openTransactionModal() {
        const f = this._txForm();
        this.editingTradeId = null;
        f.title.textContent = 'Nouvelle Transaction';
        f.form.reset();
        f.form.elements['date'].value = Utils.getDateString();
        f.form.elements['type'].value = 'BUY';
        if (f.portSelect && this.service.activePortfolioId !== 'GLOBAL') {
            f.portSelect.value = this.service.activePortfolioId;
        }
        this.syncTransactionFormFields('BUY');

        f.modal.classList.add('open');
    },

    // Edition : le formulaire est pre-rempli avec la transaction existante.
    openTradeEditor(trade) {
        const f = this._txForm();
        this.editingTradeId = trade.id;
        f.title.textContent = 'Modifier la transaction';
        f.form.reset();
        f.form.elements['type'].value = trade.type;
        this.syncTransactionFormFields(trade.type);

        f.form.elements['date'].value = trade.date;
        f.symbolInput.value = trade.symbol;
        f.qtyInput.value = trade.qty;
        f.priceInput.value = trade.price;
        f.priceCurrencyField.value = Utils.getCurrency(trade.symbol);
        f.feesInput.value = trade.fees || '';
        f.amountInput.value = trade.amount;
        if (f.portSelect) f.portSelect.value = trade.portfolioId;
        if (trade.type === 'BUY') {
            // Les lignes anterieures a la colonne n'ont pas d'origine : elles sont
            // relues comme un achat sur le cash, ecrete au solde disponible.
            f.form.elements['cashSource'].value = trade.cashSource || 'CASH';
            this.syncCashSourceHint();
        }

        f.modal.classList.add('open');
    },

    // Vente rapide depuis une position : formulaire pre-rempli en SELL.
    openQuickSell(symbol, qty, price) {
        const f = this._txForm();
        f.title.textContent = `Vendre ${symbol}`;
        f.form.reset();
        f.form.elements['date'].value = Utils.getDateString();
        f.form.elements['type'].value = 'SELL';
        this.syncTransactionFormFields('SELL');

        f.symbolInput.value = symbol;
        f.qtyInput.value = qty;
        f.priceInput.value = price;
        f.priceCurrencyField.value = Utils.getCurrency(symbol);

        f.modal.classList.add('open');
    },

    async submitTransactionForm(e) {
        e.preventDefault();
        const f = this._txForm();
        const fd = new FormData(f.form);
        const type = /** @type {string} */ (fd.get('type'));
        const dateValue = /** @type {string} */ (fd.get('date'));
        const symbol = /** @type {string} */ (fd.get('symbol')) || '$CASH';

        let price = parseFloat(/** @type {string} */ (fd.get('price'))) || 0;
        let fees = parseFloat(/** @type {string} */ (fd.get('fees'))) || 0;
        let amount = parseFloat(/** @type {string} */ (fd.get('amount'))) || 0;
        if (type === 'BUY' || type === 'SELL') {
            const enteredCurrency =
                /** @type {string} */ (fd.get('priceCurrency')) || Utils.getCurrency(symbol);
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
            const prev = this.service.trades.find((t) => t.id === this.editingTradeId);
            if (
                prev &&
                prev.fxRate > 0 &&
                Utils.getCurrency(prev.symbol) === Utils.getCurrency(symbol)
            ) {
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
            cashSource: fd.get('cashSource'),
            date: dateValue ? Utils.getDateString(dateValue) : Utils.getDateString(),
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
        f.modal.classList.remove('open');
        f.form.reset();
    },

    // Edition d'un portefeuille : la modale reprend nom, couleur et icone.
    openPortfolioEditor(port) {
        const modal = document.getElementById('portfolioModal');
        document.getElementById('portfolioModalTitle').textContent = 'Modifier le portefeuille';
        /** @type {HTMLInputElement} */ (document.getElementById('portfolioEditId')).value =
            port.id;
        /** @type {HTMLInputElement} */ (document.getElementById('portfolioNameInput')).value =
            port.name;
        const radio = /** @type {HTMLInputElement} */ (
            document.querySelector(`input[name="portfolioColor"][value="${port.color}"]`)
        );
        if (radio) radio.checked = true;
        const curIcon = Utils.portfolioIconOverrides()[port.id] || '';
        const iconRadio = /** @type {HTMLInputElement} */ (
            document.querySelector(`input[name="portfolioIcon"][value="${curIcon}"]`)
        );
        if (iconRadio) iconRadio.checked = true;
        document.getElementById('portfolioSubmitBtn').textContent = 'Sauvegarder';
        modal.classList.add('open');
    },

    renderSymbolSearchResults(results) {
        const resultsList = document.getElementById('searchResultsList');
        const searchModal = document.getElementById('symbolSearchModal');
        resultsList.innerHTML = '';
        if (!results || results.length === 0) {
            resultsList.innerHTML = '<div class="search-placeholder">Aucun résultat trouvé</div>';
            return;
        }

        results.forEach((item) => {
            const sym = item.displaySymbol || item.symbol;
            const row = document.createElement('div');
            row.className = 'search-result-row';

            const isCrypto =
                (item.type || '').toLowerCase().includes('crypto') ||
                sym.includes('BTC') ||
                sym.includes('ETH');
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
                const f = this._txForm();
                f.symbolInput.value = sym;
                searchModal.classList.remove('open');
                f.priceCurrencyField.value = Utils.getCurrency(sym);

                const livePrice = await APIService.getCurrentPrice(sym);
                f.priceInput.value = livePrice.toFixed(2);
            };

            resultsList.appendChild(row);
        });
    },
};
