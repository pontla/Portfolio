/**
 * Onglet Transactions : filtres, cache des noms d'actifs, rendu du tableau et des cartes.
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */

import { Utils } from '../core/utils.js';
import { APIService } from '../core/api.js';
import { Icons } from '../icons.js';

export const transactions = {
    updateTxFilterCounts(matchCount) {
        const f = this.txFilters;
        const n = f.types.length + (f.from ? 1 : 0) + (f.to ? 1 : 0);
        const countEl = document.getElementById('txFilterCount');
        if (countEl) countEl.textContent = n ? ` · ${n}` : '';
        const openBtn = document.getElementById('txFilterOpenBtn');
        if (openBtn) openBtn.classList.toggle('has-filters', n > 0);
        const applyBtn = document.getElementById('txApplyBtn');
        if (applyBtn)
            applyBtn.textContent = `Appliquer · ${matchCount} transaction${matchCount > 1 ? 's' : ''}`;
    },

    txFilters: { search: '', types: [], from: '', to: '' },

    assetNameCache: {},

    async fetchAssetName(symbol) {
        if (symbol.startsWith('$')) return null;
        try {
            const results = await APIService.searchSymbol(symbol);
            const match =
                results.find((r) => (r.displaySymbol || r.symbol) === symbol) || results[0];
            return (match && match.description) || null;
        } catch (e) {
            return null;
        }
    },

    async fetchWebNewsContext(symbols, namesList) {
        const blocks = await Promise.all(
            symbols.map(async (symbol, idx) => {
                const label = namesList[idx] || symbol;
                const results = await APIService.webSearch(
                    `${label} actualité résultats financiers`
                );
                if (!results.length) return null;
                const items = results
                    .slice(0, 5)
                    .map((r) => {
                        const date = r.publishedDate ? `[${r.publishedDate}] ` : '';
                        return `- ${date}${r.title} : ${(r.content || '').slice(0, 500)}`;
                    })
                    .join('\n');
                return `### ${symbol}\n${items}`;
            })
        );
        return blocks.filter(Boolean).join('\n\n');
    },

    async refreshAssetNames(symbols, _curr) {
        const toFetch = symbols.filter((s) => !(s in this.assetNameCache));
        if (!toFetch.length) return;
        await Promise.all(
            toFetch.map(async (s) => {
                this.assetNameCache[s] = await this.fetchAssetName(s);
            })
        );
        this.render();
    },

    renderTransactionsTable(curr) {
        const tBody = document.getElementById('transactionsTableBody');
        if (!tBody) return;

        const f = this.txFilters;
        const searchTerm = f.search.trim().toUpperCase();

        let sortedHistory = this.service.getSortedTrades().reverse();

        if (searchTerm)
            sortedHistory = sortedHistory.filter((t) =>
                t.symbol.toUpperCase().includes(searchTerm)
            );
        if (f.types && f.types.length)
            sortedHistory = sortedHistory.filter((t) => f.types.includes(t.type));
        // Bornes saisies par l'utilisateur : comparees comme dates, pas comme
        // texte, pour rester justes si une borne n'est pas au format canonique.
        if (f.from)
            sortedHistory = sortedHistory.filter((t) => Utils.compareDates(t.date, f.from) >= 0);
        if (f.to)
            sortedHistory = sortedHistory.filter((t) => Utils.compareDates(t.date, f.to) <= 0);

        this.updateTxFilterCounts(sortedHistory.length);

        tBody.innerHTML = sortedHistory.length
            ? sortedHistory
                  .map((t) => {
                      let badgeClass = 'badge-buy';
                      let typeLabel = 'Achat';

                      if (t.type === 'BUY' && t.cashSource === 'DIRECT') {
                          // Achat hors cash : distingue visuellement les lignes qui
                          // ne pesent pas sur le solde de cash du portefeuille.
                          typeLabel = 'Achat direct';
                      } else if (t.type === 'SELL') {
                          badgeClass = 'badge-sell';
                          typeLabel = 'Vente';
                      } else if (t.type === 'DEPOSIT') {
                          badgeClass = 'badge-deposit';
                          typeLabel = 'Dépôt';
                      } else if (t.type === 'WITHDRAWAL') {
                          badgeClass = 'badge-withdrawal';
                          typeLabel = 'Retrait';
                      } else if (t.type === 'DIVIDEND') {
                          badgeClass = 'badge-dividend';
                          typeLabel = 'Dividende';
                      } else if (t.type === 'FEE') {
                          badgeClass = 'badge-fee';
                          typeLabel = 'Frais';
                      }

                      const port = this.service.getPortfolioById(t.portfolioId);
                      const tradeCurrency = Utils.getCurrency(t.symbol);
                      const totalFormatted =
                          t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL'
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
                  })
                  .join('')
            : '<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--dim);">Aucune transaction ne correspond aux filtres.</td></tr>';

        // Cartes mobiles
        const txCards = document.getElementById('txCardsList');
        if (txCards) {
            const MONTHS = [
                'JANV.',
                'FÉVR.',
                'MARS',
                'AVR.',
                'MAI',
                'JUIN',
                'JUIL.',
                'AOÛT',
                'SEPT.',
                'OCT.',
                'NOV.',
                'DÉC.',
            ];
            txCards.innerHTML = sortedHistory.length
                ? sortedHistory
                      .map((t) => {
                          const isCash = t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL';
                          let badgeClass = 'badge-buy',
                              typeLabel = 'Achat';
                          if (t.type === 'BUY' && t.cashSource === 'DIRECT') {
                              typeLabel = 'Achat direct';
                          } else if (t.type === 'SELL') {
                              badgeClass = 'badge-sell';
                              typeLabel = 'Vente';
                          } else if (t.type === 'DEPOSIT') {
                              badgeClass = 'badge-deposit';
                              typeLabel = 'Dépôt';
                          } else if (t.type === 'WITHDRAWAL') {
                              badgeClass = 'badge-withdrawal';
                              typeLabel = 'Retrait';
                          } else if (t.type === 'DIVIDEND') {
                              badgeClass = 'badge-dividend';
                              typeLabel = 'Dividende';
                          } else if (t.type === 'FEE') {
                              badgeClass = 'badge-fee';
                              typeLabel = 'Frais';
                          }

                          const tradeCurrency = Utils.getCurrency(t.symbol);
                          const d = Utils.parseDate(t.date);
                          const sym = t.symbol.replace(/^\$/, '') || 'CASH';
                          const sub = isCash
                              ? '_'
                              : `${t.qty} × ${Utils.formatCurrency(t.price, tradeCurrency)}`;

                          let amount,
                              amountCls = '';
                          if (t.type === 'DEPOSIT' || t.type === 'DIVIDEND') {
                              amount =
                                  '+' +
                                  Utils.formatCurrency(
                                      isCash ? t.amount : t.qty * t.price,
                                      isCash ? curr : tradeCurrency
                                  );
                              amountCls = 'text-green';
                          } else if (t.type === 'WITHDRAWAL' || t.type === 'FEE') {
                              amount =
                                  '−' +
                                  Utils.formatCurrency(
                                      isCash ? t.amount : t.qty * t.price,
                                      isCash ? curr : tradeCurrency
                                  );
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
                      })
                      .join('')
                : '<div class="tx-cards-empty">Aucune transaction ne correspond aux filtres.</div>';
        }

        Icons.render();

        const uniqueSymbols = [...new Set(sortedHistory.map((t) => t.symbol))];
        this.refreshAssetNames(uniqueSymbols, curr);
    },
};
