# Your Portfolio — Dashboard Mobile-First & Thème Sombre

Refonte visuelle et fonctionnelle complète de l'application de gestion de portefeuille et de suivi d'actifs (`Dev/public`). L'application propose une interface **mobile-first native-like** (inspirée de l'ergonomie TradingView) tout en offrant une mise à l'échelle responsive fluide pour les écrans tablettes et desktop.

---

## 💡 Aperçu & Philosophie de Design

- **UI Sombre & Glassmorphism :** Thème _near-black_ TradingView par défaut, effet de verre dépoli (`backdrop-filter: blur`), typographie chiffrée tabulaire (`Roboto Mono`) pour un alignement parfait des montants.
- **Double Thème (Sombre / Clair) :** Thème sombre par défaut avec possibilité de basculer en thème clair commutable depuis les Réglages (via variables CSS sur `:root`).
- **Ergonomie Mobile-First :** Header sticky, navigation basse native, zone de pouce avec bouton d'action flottant (FAB), carrousels snappés et feuilles basses modales (_bottom sheets_).
- **Layout Desktop Responsive (≥ 1024px) :** Menu latéral repliable (236 px ↔ 68 px), grilles multi-colonnes, panneaux ancrés et ajustement dynamique de la zone de contenu.
- **Périmètre Fonctionnel Conservé :** Conservation intégrale de la stack et des fonctionnalités existantes sans retrait de périmètre.

---

## 🛠️ Stack Technique

- **Frontend :** Vanilla JS (ES6+) + CSS3 Vanilla (Design Tokens via variables CSS) — **aucun framework JS (React/Vue/Tailwind) ni étape de build (Zero-build step)**.
- **Graphiques :** [Chart.js](https://www.chartjs.org/) (lignes 2.2px, dégradés verticaux, benchmarks en pointillés, halos terminaux).
- **Données de marché :** API Yahoo Finance.
- **Logos :** `img.logokit.com` avec fallback automatique sur monogramme HTML/CSS.
- **Typographie :** `Archivo` (UI, titres, labels) & `Roboto Mono` (données numériques tabulaires) via Google Fonts.
- **Base de données :** PostgreSQL (`Dev/db/schema.sql`).
- **PWA :** Support natif via `manifest.json`.
- **Typage :** TypeScript en `checkJs` + JSDoc, `noEmit` (`npm run typecheck`, bloquant en CI). Aucun fichier `.ts`, aucun bundler : le code livré au navigateur reste le JS source. `chart.js` et `@supabase/supabase-js` sont des devDependencies **de typage seul**, épinglées sur les mêmes versions que les balises `<script>`.
- **Qualité :** ESLint (flat config, globales déclarées par zone) + Prettier, tous deux bloquants en CI (`npm run lint`, `npm run format:check`). Le formatage appartient à Prettier, ESLint ne juge que la correction.

---

## 🔥 Fonctionnalités Principales

### 1. Vue d'Ensemble

- **Cartes de Synthèse :** Carrousel mobile / Grille 4 colonnes desktop présentant la Valeur du portefeuille, les Gains non réalisés, les Gains réalisés et le Gain total net.
- **Héros Résumé IA :** Résumé synthétique du portefeuille avec indicateurs en couleur, bouton d'actualisation rapide et chips interactives par titre.
- **Graphique Interactif :** Toggle devise ($ / €), mode Valeur ou Performance, benchmarks comparatifs (S&P 500, NASDAQ, CAC 40, MSCI World, Bitcoin) et sélecteur de périodes (1M, 3M, 6M, YTD, 1Y, ALL) avec animation d'interpolation des deltas.
- **Gagnants / Perdants du Jour :** Barres de progression relatives visuelles par actif.
- **Événements à Venir :** Tableau des dividendes estimés (avec taux de rendement) et calendrier des publications de résultats (BPA).

### 2. Holdings (Positions)

- Suivi détaillé par position : pourcentage d'allocation, quantité, PRU, cours et P&L.
- **Swipe-to-sell (Mobile) :** Glissement horizontal sur la carte de position dévoilant un bouton d'action _Vendre_.

### 3. Transactions

- Historique filtrable avec barre de recherche et filtres par types d'opérations (Achat, Vente, Dividende, Retrait, Dépôt, Frais) et plages de dates.
- Badges colorés et formatés selon la nature de l'opération.

### 4. Analyse & Répartition

- **4 Donuts d'Allocation :** Visualisation par actif, classe d'actif, devise et secteur.
- **Classement de Performance :** Classement filtrable (_Tout_, _En hausse_, _En baisse_, _Dividendes_).
- **Profit & Performance Annuelle :** Évolution des plus-values et historique par année (2023 à YTD 2026).

---

## 📁 Structure du Projet

```text
.
├── db/
│   └── schema.sql            # Schéma PostgreSQL (Supabase) + policies RLS
├── worker/
│   ├── proxy.js              # Worker BFF : marché (Yahoo/Finnhub/FMP), Tavily, /ai/*
│   └── proxy.test.js
├── public/
│   ├── index.html            # HTML sémantique, modales & bottom sheets
│   ├── style.css             # CSS vanilla (~5300 lignes), design tokens & thèmes
│   ├── manifest.json         # Configuration PWA
│   ├── sw.js                 # Service worker (réseau d'abord sur le code)
│   ├── icons/                # Icônes PWA
│   └── js/
│       ├── app.js            # Assemblage : état partagé + fusion des fragments UI
│       ├── app.test.js       # Tests du contrôleur (stubs DOM + import dynamique)
│       ├── icons.js          # Registre d'icônes SVG inline
│       ├── globals.d.ts      # Globales CDN & propriétés ad hoc sur les nœuds DOM
│       ├── ui/               # Fragments de l'objet App, un par écran
│       │   ├── shell.js      # Thème, menu latéral, accueil, authentification
│       │   ├── events.js     # Câblage des événements, découpé par écran
│       │   ├── overview.js   # Cartes de synthèse, positions, palmarès
│       │   ├── transactions.js
│       │   ├── holdings.js
│       │   ├── insights.js   # Résumé IA, dividendes, résultats à venir
│       │   ├── charts.js     # Chart.js : valeur, plus-values, donuts
│       │   ├── research.js   # Explorer : recherche, orchestration, graphe
│       │   ├── research-fundamentals.js
│       │   └── research-market.js
│       └── core/             # Moteur financier — aucune dépendance au DOM
│           ├── config.js     # Constantes
│           ├── platform.js   # Stockage local & bus d'événements, tolérants à l'absence
│           ├── supabase.js   # Point d'injection du client Supabase
│           ├── auth.js       # Supabase Auth + garde-fous sur l'horodatage des jetons
│           ├── utils.js      # Formatage, dates, classification, CSV
│           ├── api.js        # Accès marché via le proxy
│           ├── analysis.js   # Agrégation d'analyse de valeur & score global
│           ├── portfolio.js  # P&L, allocations, séries historiques
│           └── *.test.js     # Tests par import direct (pas de stub de DOM)
├── e2e/                      # Parcours Playwright
├── scripts/
│   └── check-csp-hash.mjs    # Garde-fou : hash CSP ↔ script inline de index.html
├── eslint.config.mjs
├── .prettierrc.json
└── README.md
```

### Vérifications locales

| Commande            | Rôle                                                      |
| ------------------- | --------------------------------------------------------- |
| `npm run lint`      | ESLint, zéro avertissement toléré                         |
| `npm run format`    | Prettier en écriture (`format:check` en lecture seule)    |
| `npm run typecheck` | `tsc --noEmit` sur l'app et sur le service worker         |
| `npm run check:csp` | Vérifie que les hash CSP correspondent aux scripts inline |
| `npm test`          | Tests unitaires (vitest)                                  |
| `npm run test:e2e`  | Parcours Playwright                                       |

`public/index.html` est **exclu de Prettier** : la CSP de `public/_headers`
autorise son script inline de thème par un hash `sha256`, que le moindre
reformatage invaliderait — le navigateur bloquerait alors le script en
production, sans qu'aucun test ne le voie. `npm run check:csp` garde cette
correspondance sous surveillance.

Le moteur (`public/js/core/`) ne touche ni au DOM ni au stockage direct : il
s'importe tel quel sous Node, ce qui rend sa couverture réellement mesurable
(`npx vitest run --coverage`).

Les fragments de `public/js/ui/` sont fusionnés dans un unique objet `App` par
`Object.assign` : ils partagent donc le même `this`, et l'état commun est
déclaré à un seul endroit, dans `app.js`.
