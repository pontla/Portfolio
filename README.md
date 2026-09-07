# Your Portfolio

Application web de suivi de portefeuille boursier : valorisation en temps réel,
plus-values réalisées et latentes, allocation, historique de transactions,
explorateur de valeurs et résumés rédigés par IA.

Interface **mobile-first** (ergonomie inspirée de TradingView), thème sombre
_near-black_ / glassmorphism, montée en charge responsive jusqu'au desktop, et
installation possible en PWA.

- **Sans étape de build** : le JavaScript livré au navigateur est le code source.
- **Aucun cours inventé** : si une donnée de marché manque, elle est signalée,
  jamais remplacée par une valeur plausible.
- **Clés IA jamais exposées** : les appels aux fournisseurs passent par un
  worker, la clé de l'utilisateur ne touche pas le navigateur.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Démarrage local](#démarrage-local)
- [Tests & qualité](#tests--qualité)
- [Déploiement](#déploiement)
- [Structure du projet](#structure-du-projet)
- [Choix techniques notables](#choix-techniques-notables)
- [Licence](#licence)

---

## Fonctionnalités

### Vue d'ensemble

- Cartes de synthèse : valeur du portefeuille, plus-values latentes, réalisées,
  gain total net.
- Graphique interactif : bascule devise (€ / $), mode **Valeur** ou
  **Performance**, benchmarks (S&P 500, NASDAQ, CAC 40, MSCI World, Bitcoin),
  périodes 1M / 3M / 6M / YTD / 1A / Tout.
- Résumé IA du portefeuille avec indicateurs colorés et chips par titre.
- Gagnants / perdants du jour, dividendes estimés et calendrier de résultats.

### Holdings

- Détail par position : allocation, quantité, PRU, cours, P&L.
- Glisser-pour-vendre sur mobile.

### Transactions

- Historique filtrable (recherche, type d'opération, plage de dates).
- Import de relevés **Degiro** (transactions) et de relevés de **position**
  d'assurance-vie / PER (photo du portefeuille, sans historique).
- Valorisation manuelle pour les supports sans cotation suivie (fonds euros, UC).

### Analyse

- Quatre donuts d'allocation : par actif, classe d'actif, devise, secteur.
- Classement de performance filtrable et historique de plus-values par année.

### Explorer

- Recherche d'une valeur (ticker ou ISIN), fiche marché et fondamentaux
  (5 ans d'états financiers, ratios, comparables sectoriels), actualités et
  analyse rédigée par IA à la demande.
- Depuis toute page, un clic sur un ticker ouvre l'Explorer sur cette valeur.

---

## Architecture

```
Navigateur (PWA, static)
        │
        │  fetch
        ▼
Cloudflare Worker  ──►  Yahoo Finance / Finnhub / FMP   (données de marché)
  (worker/proxy.js) ──►  Tavily                          (actualités)
                    ──►  Anthropic / OpenAI / Gemini…    (résumés IA)
        │
        ▼
   Cloudflare KV        (clés IA chiffrées, cache d'analyses)

Supabase (PostgreSQL + Auth + RLS)  ◄── accès direct depuis le navigateur
```

- **Front** : fichiers statiques dans `public/`, servis par Cloudflare Workers
  static assets. Aucun serveur applicatif, aucun bundler.
- **Proxy** (`worker/proxy.js`) : un worker séparé qui agrège les API de marché,
  ajoute le cache et porte les secrets. Il se déploie indépendamment du front.
- **Base de données** : Supabase. Le navigateur parle directement à PostgREST ;
  l'isolation entre comptes repose sur les _policies_ RLS (`db/schema.sql`).
- **Auth** : Supabase Auth (e-mail + mot de passe).

---

## Stack technique

| Domaine     | Choix                                                               |
| ----------- | ------------------------------------------------------------------- |
| Front       | JavaScript vanilla (modules ES natifs), CSS vanilla (design tokens) |
| Graphiques  | [Chart.js](https://www.chartjs.org/) (chargé par CDN)               |
| Données     | Supabase (`@supabase/supabase-js`, chargé par CDN)                  |
| Backend     | Cloudflare Worker (proxy BFF) + Cloudflare KV                       |
| Hébergement | Cloudflare Workers static assets                                    |
| Typage      | TypeScript en `checkJs` + JSDoc, `noEmit` — aucun fichier `.ts`     |
| Qualité     | ESLint (flat config) + Prettier, bloquants en CI                    |
| Tests       | Vitest (unitaires) + Playwright (e2e)                               |
| PWA         | `manifest.json` + service worker (réseau d'abord sur le code)       |

`chart.js` et `@supabase/supabase-js` ne sont installés que **pour le typage** ;
ils sont épinglés sur les versions des balises `<script>` de `index.html`.

---

## Démarrage local

### Prérequis

- **Node.js 22+**
- Un projet **Supabase** (gratuit) et un compte **Cloudflare** pour un usage réel.
  Sans eux, l'interface se charge mais l'authentification et les données ne
  fonctionnent pas.

### Installation

```bash
git clone <url-du-repo>
cd Portfolio
npm install
cp .env.example .env   # puis renseigner les clés (voir commentaires du fichier)
```

### Lancer l'interface

```bash
npm run serve
```

Sert `public/` sur <http://localhost:8788> (assets seuls, comme en production).

Pour développer le proxy en parallèle :

```bash
npm run dev            # wrangler dev --persist sur worker/proxy.js
```

### Configuration

Les valeurs publiques (URL Supabase, clé anon, URL du proxy, token logos) vivent
dans [`public/js/core/config.js`](public/js/core/config.js). Les secrets du proxy
(clés Finnhub / FMP / Tavily, clé de chiffrement IA) se posent sur le worker
Cloudflare via `wrangler secret put` et **ne sont jamais dans le dépôt** — voir
[`.env.example`](.env.example).

---

## Tests & qualité

| Commande            | Rôle                                                      |
| ------------------- | --------------------------------------------------------- |
| `npm run lint`      | ESLint, zéro avertissement toléré                         |
| `npm run format`    | Prettier en écriture (`format:check` en lecture seule)    |
| `npm run typecheck` | `tsc --noEmit` sur l'app et sur le service worker         |
| `npm run check:csp` | Vérifie que les hash CSP correspondent aux scripts inline |
| `npm test`          | Tests unitaires (Vitest)                                  |
| `npm run test:e2e`  | Parcours end-to-end (Playwright)                          |

La CI (`.github/workflows/ci.yml`) rejoue toute cette liste sur chaque _push_ et
_pull request_. `public/index.html` est **exclu de Prettier** : son script inline
de thème est autorisé par un hash `sha256` dans la CSP, que le moindre
reformatage invaliderait.

---

## Déploiement

Trois cibles indépendantes :

1. **Front (assets)** — automatique : un _push_ sur `main` qui passe la CI
   déclenche `wrangler deploy` (nécessite le secret GitHub `CLOUDFLARE_API_TOKEN`).
   Manuel : `npm run deploy`.
2. **Proxy** — `npm run deploy:proxy` (`wrangler deploy -c wrangler.proxy.toml`).
   Déployé à part pour ne pas exposer ses secrets à la CI.
3. **Base de données** — appliquer `db/schema.sql` puis les `db/migration_*.sql`
   sur le projet Supabase (éditeur SQL ou CLI).

---

## Structure du projet

```text
.
├── db/                       # Schéma PostgreSQL (Supabase) + migrations + RLS
├── worker/
│   └── proxy.js              # Worker BFF : marché, actualités, /ai/*
├── public/                   # Tout ce qui est servi au navigateur
│   ├── index.html            # HTML sémantique, modales & bottom sheets
│   ├── style.css             # CSS vanilla, design tokens & thèmes
│   ├── sw.js                 # Service worker
│   ├── manifest.json         # PWA
│   ├── icons/
│   └── js/
│       ├── app.js            # Assemblage : état partagé + fusion des fragments
│       ├── icons.js          # Registre d'icônes SVG inline
│       ├── ui/               # Un fragment de l'objet App par écran
│       │   ├── shell.js      # Thème, menu latéral, accueil, authentification
│       │   ├── events.js     # Câblage des événements
│       │   ├── overview.js   ├── transactions.js   ├── holdings.js
│       │   ├── insights.js   ├── charts.js
│       │   └── research*.js  # Explorer : recherche, fondamentaux, marché
│       └── core/             # Moteur financier — aucune dépendance au DOM
│           ├── config.js     ├── platform.js   ├── supabase.js   ├── auth.js
│           ├── utils.js      ├── api.js        ├── analysis.js
│           ├── portfolio.js  # P&L, allocations, séries historiques
│           └── import-*.js   # Adaptateurs de relevés (Degiro, position)
├── e2e/                      # Parcours Playwright
├── scripts/                  # Garde-fou CSP, serveur d'assets pour les e2e
└── .github/workflows/ci.yml  # Lint · format · types · CSP · tests · déploiement
```

Les fragments de `public/js/ui/` sont fusionnés dans un unique objet `App` par
`Object.assign` : ils partagent le même `this`, et l'état commun est déclaré au
seul endroit `app.js`. Le moteur (`public/js/core/`) ne touche ni au DOM ni au
stockage : il s'importe tel quel sous Node, ce qui rend sa couverture
directement mesurable.

Voir [`DESIGN.md`](DESIGN.md) pour la charte visuelle et
[`PRODUCT.md`](PRODUCT.md) pour le périmètre produit.

---

## Choix techniques notables

**Aucune donnée de marché n'est inventée.** Si le proxy ne répond pas,
`getCurrentPrice` renvoie `null` : la position est valorisée à son prix de
revient, sa plus-value latente affiche « — cours indisponible » plutôt qu'un
zéro trompeur, et un bandeau nomme les valeurs concernées. Seule exception
assumée : le taux de change, sans lequel aucune conversion n'est possible —
l'ordre de repli (taux live → dernier taux connu même périmé → estimation) est
alors signalé à l'utilisateur.

**Série historique en une passe.** `getHistoricalTimeline` parcourt les
transactions triées une seule fois via un curseur jour par jour. L'ancienne
version rejouait tout l'historique chaque jour : mesuré dans le navigateur sur
400 transactions et 3 ans, **4 631 ms → 152 ms**. Le coût ne dépend plus du
nombre de transactions. `portfolio-timeline.test.js` fige l'ancienne sortie en
instantanés pour prouver l'équivalence.

**Serveur e2e dédié.** Les tests Playwright passent par
`scripts/static-server.mjs` plutôt que `wrangler dev` (**0,35 s** de démarrage
contre **6,1 s**, sans `ECONNREFUSED` intermittent). Le serveur reproduit le
contrat _observable_ de Cloudflare (règles `_headers` appliquées y compris aux
404, `.assetsignore` respecté, `/` → `index.html`, pas de repli SPA) et rejoue
les en-têtes d'origine, si bien qu'une CSP cassée fait échouer la campagne au
lieu de ne se voir qu'en production.

---

## Licence

Propriétaire — voir [`LICENSE`](LICENSE). Le code est consultable à titre de
référence ; toute réutilisation nécessite l'accord écrit préalable du titulaire
des droits.
