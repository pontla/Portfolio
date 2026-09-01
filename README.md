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
│           ├── portfolio.test.js            # calculs : P&L, validation, séries
│           ├── portfolio-io.test.js         # persistance Supabase, CRUD, CSV
│           ├── portfolio-aggregates.test.js # variations, dividendes, résultats
│           ├── portfolio-timeline.test.js   # référence figée de la série quotidienne
│           ├── api.test.js                  # comportement du proxy en panne
│           └── *.test.js                    # import direct, aucun stub de DOM
├── e2e/                      # Parcours Playwright
├── scripts/
│   ├── check-csp-hash.mjs    # Garde-fou : hash CSP ↔ script inline de index.html
│   ├── static-server.mjs     # Serveur d'assets pour les tests e2e
│   └── static-server.test.js # Contrat du serveur, relevé sur le site déployé
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
| `npm run serve`     | Sert `public/` sur le port 8788 (assets seuls)            |

`public/index.html` est **exclu de Prettier** : la CSP de `public/_headers`
autorise son script inline de thème par un hash `sha256`, que le moindre
reformatage invaliderait — le navigateur bloquerait alors le script en
production, sans qu'aucun test ne le voie. `npm run check:csp` garde cette
correspondance sous surveillance.

### Serveur des tests end-to-end

La campagne Playwright ne passe plus par `wrangler dev` mais par
`scripts/static-server.mjs`. Le Worker de ce dépôt n'a aucun code — `wrangler.toml`
ne déclare que `[assets] directory = "./public"` — et faire tourner un runtime
`workerd` complet pour servir des fichiers plats coûtait **6,1 s de démarrage**
contre **0,35 s**, en s'effondrant parfois en cours de campagne (`ECONNREFUSED`
au milieu d'une série de tests, une cause d'échec qui n'a rien à voir avec le
code testé).

Le serveur reproduit le contrat _observable_ de Cloudflare Workers static assets,
relevé sur le site déployé et non déduit de la documentation :

- `_headers` appliqué à toutes les réponses, **404 comprises** ;
- `.assetsignore` respecté : tests, instantanés et `.d.ts` renvoient 404 ;
- `_headers` et `_redirects` jamais servis, ce sont de la configuration ;
- `/` sert `index.html`, tandis que `/index.html` et `/index` redirigent en 307 ;
- aucun index de répertoire, aucun repli SPA : un chemin inconnu est un 404 sec.

Il écoute sur `127.0.0.1` **et** `::1` : selon la machine, `localhost` résout
vers l'une ou l'autre, et n'en servir qu'une produisait un `ECONNREFUSED`
intermittent.

Deux conséquences pour les tests. D'abord `scripts/static-server.test.js` vérifie
sur le vrai `public/` qu'aucun fichier de test n'est servi — la régression déjà
survenue en production, où l'instantané de la timeline était téléchargeable
publiquement, échoue maintenant en local. Ensuite **la CSP de production est
réellement active pendant la campagne** : le harnais e2e repasse les en-têtes de
la réponse d'origine au lieu du seul `content-type`, ce qui fait qu'un
`script-src` cassé fait tomber les tests au lieu de ne se voir qu'en ligne.

Le hash du script inline reste, lui, hors de portée des tests e2e : ce script
n'évite qu'un flash de thème avant peinture, et son blocage ne casse aucun
parcours. C'est `npm run check:csp` qui le garde, et c'est sa seule raison d'être.

Le moteur (`public/js/core/`) ne touche ni au DOM ni au stockage direct : il
s'importe tel quel sous Node, ce qui rend sa couverture réellement mesurable
(`npx vitest run --coverage`).

`portfolio.js` — le moteur de P&L, la partie du dépôt où une erreur coûte le
plus cher — est couvert à **98 % des instructions et 85 % des branches**. Son
double Supabase (`portfolio-io.test.js`) imite les chaînages de PostgREST et
enregistre les appels, ce qui permet de vérifier ce qui partirait réellement au
serveur, pas seulement l'état local après coup.

`getHistoricalTimeline` est calculée en **une seule passe** sur les transactions
triées, via un curseur qui avance jour après jour. La version précédente
refiltrait et rejouait tout l'historique à chaque jour, et rappelait
`computeProfitAsOf` (qui retriait à son tour) : le coût était le produit des
jours par les transactions. Mesuré dans le navigateur, sur 400 transactions et
3 ans d'historique : **4 631 ms → 152 ms**. Le coût ne dépend plus du nombre de
transactions (67 ms pour 30 comme pour 400, sur 600 jours), mais seulement du
nombre de jours et de lignes détenues. `portfolio-timeline.test.js` fige la
sortie de l'ancienne implémentation en instantanés, sur treize portefeuilles de
référence et quatre plages, pour que la refonte soit prouvée équivalente et pas
seulement plus rapide.

### Données de marché indisponibles

Aucun cours n'est jamais inventé. Si le proxy ne répond pas, `getCurrentPrice`
renvoie `null` : la position est alors valorisée à son **prix de revient**, sa
plus-value latente s'affiche « — cours indisponible » plutôt que chiffrée à
zéro, et un avertissement nomme les valeurs concernées. Auparavant un cours codé
en dur de 2024 était servi en repli, produisant un P&L faux présenté avec la
même autorité qu'un vrai.

Le taux de change est la seule exception, et elle est assumée : sans taux aucune
conversion n'est possible et le portefeuille devient inaffichable. L'ordre de
préférence est donc taux live → dernier taux live connu même périmé →
estimation de dernier recours, les deux derniers cas étant signalés à
l'utilisateur.

Les fragments de `public/js/ui/` sont fusionnés dans un unique objet `App` par
`Object.assign` : ils partagent donc le même `this`, et l'état commun est
déclaré à un seul endroit, dans `app.js`.
