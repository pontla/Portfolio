# Your Portfolio — Dashboard Mobile-First & Thème Sombre

Refonte visuelle et fonctionnelle complète de l'application de gestion de portefeuille et de suivi d'actifs (`Dev/public`). L'application propose une interface **mobile-first native-like** (inspirée de l'ergonomie TradingView) tout en offrant une mise à l'échelle responsive fluide pour les écrans tablettes et desktop.

---

## 💡 Aperçu & Philosophie de Design

* **UI Sombre & Glassmorphism :** Thème *near-black* TradingView par défaut, effet de verre dépoli (`backdrop-filter: blur`), typographie chiffrée tabulaire (`Roboto Mono`) pour un alignement parfait des montants.
* **Double Thème (Sombre / Clair) :** Thème sombre par défaut avec possibilité de basculer en thème clair commutable depuis les Réglages (via variables CSS sur `:root`).
* **Ergonomie Mobile-First :** Header sticky, navigation basse native, zone de pouce avec bouton d'action flottant (FAB), carrousels snappés et feuilles basses modales (*bottom sheets*).
* **Layout Desktop Responsive (≥ 1024px) :** Menu latéral repliable (236 px ↔ 68 px), grilles multi-colonnes, panneaux ancrés et ajustement dynamique de la zone de contenu.
* **Périmètre Fonctionnel Conservé :** Conservation intégrale de la stack et des fonctionnalités existantes sans retrait de périmètre.

---

## 🛠️ Stack Technique

* **Frontend :** Vanilla JS (ES6+) + CSS3 Vanilla (Design Tokens via variables CSS) — **aucun framework JS (React/Vue/Tailwind) ni étape de build (Zero-build step)**.
* **Graphiques :** [Chart.js](https://www.chartjs.org/) (lignes 2.2px, dégradés verticaux, benchmarks en pointillés, halos terminaux).
* **Données de marché :** API Yahoo Finance.
* **Logos :** `img.logokit.com` avec fallback automatique sur monogramme HTML/CSS.
* **Typographie :** `Archivo` (UI, titres, labels) & `Roboto Mono` (données numériques tabulaires) via Google Fonts.
* **Base de données :** PostgreSQL (`Dev/db/schema.sql`).
* **PWA :** Support natif via `manifest.json`.
* **Typage :** TypeScript en `checkJs` + JSDoc, `noEmit` (`npm run typecheck`, bloquant en CI). Aucun fichier `.ts`, aucun bundler : le code livré au navigateur reste le JS source. `chart.js` et `@supabase/supabase-js` sont des devDependencies **de typage seul**, épinglées sur les mêmes versions que les balises `<script>`.

---

## 🔥 Fonctionnalités Principales

### 1. Vue d'Ensemble
* **Cartes de Synthèse :** Carrousel mobile / Grille 4 colonnes desktop présentant la Valeur du portefeuille, les Gains non réalisés, les Gains réalisés et le Gain total net.
* **Héros Résumé IA :** Résumé synthétique du portefeuille avec indicateurs en couleur, bouton d'actualisation rapide et chips interactives par titre.
* **Graphique Interactif :** Toggle devise ($ / €), mode Valeur ou Performance, benchmarks comparatifs (S&P 500, NASDAQ, CAC 40, MSCI World, Bitcoin) et sélecteur de périodes (1M, 3M, 6M, YTD, 1Y, ALL) avec animation d'interpolation des deltas.
* **Gagnants / Perdants du Jour :** Barres de progression relatives visuelles par actif.
* **Événements à Venir :** Tableau des dividendes estimés (avec taux de rendement) et calendrier des publications de résultats (BPA).

### 2. Holdings (Positions)
* Suivi détaillé par position : pourcentage d'allocation, quantité, PRU, cours et P&L.
* **Swipe-to-sell (Mobile) :** Glissement horizontal sur la carte de position dévoilant un bouton d'action *Vendre*.

### 3. Transactions
* Historique filtrable avec barre de recherche et filtres par types d'opérations (Achat, Vente, Dividende, Retrait, Dépôt, Frais) et plages de dates.
* Badges colorés et formatés selon la nature de l'opération.

### 4. Analyse & Répartition
* **4 Donuts d'Allocation :** Visualisation par actif, classe d'actif, devise et secteur.
* **Classement de Performance :** Classement filtrable (*Tout*, *En hausse*, *En baisse*, *Dividendes*).
* **Profit & Performance Annuelle :** Évolution des plus-values et historique par année (2023 à YTD 2026).

---

## 📁 Structure du Projet

```text
.
├── Dev/
│   ├── db/
│   │   └── schema.sql        # Schéma de base de données PostgreSQL
│   └── public/
│       ├── index.html        # Structure semantic HTML, modales & bottom sheets
│       ├── style.css         # CSS Vanilla (~2000+ lignes), design tokens & thèmes
│       ├── manifest.json     # Configuration PWA
│       ├── js/
│       │   └── app.js        # Gestion d'état, fonctions render* & appels API
│       └── icons/            # Icônes PWA
├── design/                   # Maquettes et prototypes de référence en HTML/CSS
└── README.md                 # Documentation du projet