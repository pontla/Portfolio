# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Investisseurs particuliers gérant eux-mêmes leur portefeuille en actions et ETF.
Aujourd'hui : l'auteur du projet et un petit cercle de proches et de bêta-testeurs,
chacun sur son propre portefeuille et son propre compte. L'inscription est ouverte,
mais il n'y a pas encore d'audience acquise.

Situation d'usage dominante : consultation courte et fréquente sur téléphone
(vérifier la valeur du jour, une position, une actualité), avec des sessions plus
longues et plus analytiques sur desktop (Explorer, répartition, historique annuel).

## Product Purpose

Donner à un particulier une vision honnête et compréhensible de son portefeuille :
combien il possède, ce qu'il a gagné ou perdu (latent et réalisé), comment c'est
réparti, et _pourquoi_ ça bouge. Le produit réussit quand l'utilisateur repart avec
une compréhension, pas seulement avec des chiffres.

## Positioning

Deux mécanismes constituent la différence, et tout futur travail doit les préserver :

1. **Résumés IA nourris de vraies actualités.** Chaque actualisation croise les
   positions réelles de l'utilisateur avec des actualités de marché sourcées
   (Tavily) pour produire un résumé en langage clair et spécifique à ce
   portefeuille — jamais un commentaire générique de marché.
2. **Explorer : analyse fondamentale de profondeur professionnelle.** Valorisation,
   santé financière, croissance, rentabilité, dividende, sentiment de marché,
   comparaison sectorielle et score de synthèse, agrégés dans une app grand public
   — une densité d'analyse habituellement réservée aux terminaux payants.

## Operating Context

- **Comptes et données :** authentification Supabase, données par utilisateur
  protégées par RLS. Plusieurs portefeuilles par compte, conversion USD / EUR.
- **Écrans :** Vue d'ensemble, Holdings, Transactions, Analyse, Explorer, plus une
  landing publique et un écran d'authentification.
- **Saisie :** transactions manuelles (achat, vente, dividende, dépôt, retrait,
  frais), import / export CSV.
- **Sources de marché :** Yahoo Finance (cours, historique), Finnhub (ratios,
  calendrier de résultats, recommandations, initiés, peers), FMP (états financiers,
  key-metrics, estimations, DCF, profil), Tavily (actualités) — toutes via un
  Worker Cloudflare qui sert de BFF et garde les clés hors du navigateur.
- **IA :** chaque utilisateur fournit sa propre clé d'API, chiffrée en AES-GCM
  côté serveur, jamais renvoyée au navigateur.
- **PWA :** installable sur l'écran d'accueil, fonctionnement hors-ligne.

## Capabilities and Constraints

- **Zero-build assumé.** Vanilla JS (ES6+) et CSS vanilla, aucun framework, aucun
  bundler : le JS source est exactement ce que reçoit le navigateur. TypeScript
  n'intervient qu'en `checkJs` / JSDoc / `noEmit`. Toute proposition impliquant une
  étape de build est un changement de contrat, pas un détail d'implémentation.
- **CSP à hash.** `public/index.html` est exclu de Prettier : le script inline de
  thème est autorisé par un hash `sha256` dans `public/_headers`, qu'un simple
  reformatage invaliderait en production. `npm run check:csp` garde la
  correspondance.
- **Aucune donnée inventée.** Si une source de marché ne répond pas, le cours vaut
  `null` : la position est valorisée à son prix de revient, la plus-value latente
  s'affiche « — » plutôt qu'un zéro, et un avertissement nomme les valeurs
  concernées. Seul le taux de change admet un repli (live → dernier taux connu →
  estimation), et ce repli est signalé à l'utilisateur. C'est une règle produit
  avant d'être une règle technique.
- **Terminologie :** PRU (prix de revient unitaire), plus-value latente vs réalisée,
  BPA, rendement du dividende, benchmarks (S&P 500, NASDAQ, CAC 40, MSCI World,
  Bitcoin).
- **Qualité bloquante en CI :** ESLint zéro avertissement, Prettier, `tsc --noEmit`,
  vitest, Playwright.
- **Limites de quota des sources gratuites** (Finnhub 60 req/min et actions US
  seulement, FMP 250 req/jour, Tavily ~1000 req/mois) : le produit doit rester
  lisible quand une source est épuisée ou muette.
- **Non décidé :** monétisation future — aucune n'est prévue, aucun écran de plan
  payant n'existe.

## Brand Commitments

- Nom : **Your Portfolio** (nom court « Portfolio »).
- Langue de l'interface : français.
- Identité visuelle en place : thème near-black par défaut, thème clair
  commutable, glassmorphism, `Archivo` pour l'UI et `Roboto Mono` pour toute donnée
  numérique tabulaire, structures type bento grid.
- Convention établie : une donnée absente s'écrit avec un tiret discret « — »,
  jamais « Donnée indisponible » ni une carte vide.

## Evidence on Hand

- Le produit lui-même, fonctionnel et déployé (Cloudflare Workers static assets +
  Worker proxy).
- Preuves techniques mesurées, réutilisables telles quelles : `getHistoricalTimeline`
  passée de 4 631 ms à 152 ms sur 400 transactions et 3 ans d'historique ;
  `portfolio.js` couvert à 98 % des instructions et 85 % des branches ; instantanés
  figés sur treize portefeuilles de référence.
- Copy de la landing existante et captures possibles de tous les écrans.
- **Absences à ne jamais combler par de l'invention :** aucun témoignage, aucun
  client, aucun chiffre d'audience, aucune mention presse, aucun logo partenaire,
  aucun tarif. Le produit est gratuit et sans plan payant.

## Product Principles

1. **L'honnêteté avant la complétude.** Un trou assumé (« — ») vaut mieux qu'un
   chiffre plausible. Cela vaut pour les données de marché comme pour le marketing.
2. **Expliquer, pas seulement afficher.** Chaque écran doit rapprocher l'utilisateur
   d'une compréhension : le « pourquoi » (actualités, fondamentaux, contexte) est
   une fonction, pas un ornement.
3. **Le téléphone d'abord, sans amputer le desktop.** L'usage majoritaire est court
   et mobile ; la profondeur analytique reste entière sur grand écran.
4. **Densité lisible.** Le produit assume beaucoup de chiffres ; la hiérarchie, la
   typographie tabulaire et l'espacement font le travail que la simplification
   ferait au prix de l'information.
5. **Rester léger.** Zero-build, vanilla, PWA : la rapidité de chargement et la
   simplicité de la chaîne font partie du produit.

## Accessibility & Inclusion

Aucun standard formel n'a été arrêté à ce jour. Les acquis à ne pas régresser :
labels ARIA sur les contrôles d'action, thème clair commutable, cibles tactiles
dimensionnées pour l'usage mobile à une main. Décision ouverte : viser ou non
WCAG AA explicitement.
