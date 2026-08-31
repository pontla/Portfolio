# Handoff : refonte mobile-first, thème sombre — Your Portfolio

## Overview

Refonte visuelle complète de l'app de gestion de portefeuille (`Dev/public`), aujourd'hui un dashboard web en thème clair. La cible est une app **mobile-first native-like** (utilisable en tablette / desktop par mise à l'échelle responsive), UI sombre inspirée de TradingView, typographie de données en chiffres tabulaires, glassmorphism léger, micro-interactions.

**Aucune fonctionnalité n'est retirée.** Le périmètre fonctionnel est exactement celui de l'app actuelle : switcher de portefeuille, 4 cartes de synthèse, 4 onglets (Vue d'ensemble / Holdings / Transactions / Analyse), résumé IA avec chips par titre, graphique de portefeuille (devise, vue, benchmark, période), gagnants / perdants du jour, dividendes et résultats à venir, holdings, transactions filtrables, 4 donuts d'allocation, classement de performance, profit et rendements annuels.

Deux ajouts demandés en cours de route : **thème clair** commutable dans les Réglages, et **menu latéral repliable** sur desktop.

---

## About the Design Files

Les fichiers de `design/` sont des **références de design écrites en HTML** — des prototypes qui montrent l'apparence et le comportement visés. **Ce n'est pas du code de production à copier tel quel.**

La tâche est de **recréer ces designs dans le codebase existant**, avec ses patterns établis. Ici le codebase cible est connu :

```
Dev/public/index.html      structure des écrans, modales, onglets
Dev/public/style.css       ~2035 lignes, tokens dans :root, thème clair
Dev/public/js/app.js       ~3744 lignes, objet app avec render*/init* et innerHTML
Dev/public/manifest.json   PWA
Dev/db/schema.sql          modèle de données
```

Stack : **vanilla JS + CSS, pas de framework, pas de build**, Chart.js pour les graphiques, logos via `img.logokit.com`, prix via Yahoo Finance. **Garder cette stack.** Ne pas introduire React / Vue / Tailwind pour cette refonte : tout le travail se fait dans `style.css` (tokens + nouvelles règles mobile) et dans les fonctions `render*` de `app.js`.

Ordre d'implémentation recommandé :

1. **Tokens** — remplacer le bloc `:root` de `style.css` par les deux thèmes (§ Design Tokens), et faire passer tous les `#hex` en dur du CSS existant par ces variables.
2. **Typographie** — charger Archivo + Roboto Mono, appliquer `font-variant-numeric: tabular-nums` à toutes les cellules de chiffres.
3. **Cartes et surfaces** — rayons, bordures, fonds (§ Design Tokens).
4. **Structure mobile** — nav basse, FAB, carrousels snappés, feuilles basses.
5. **Desktop** — menu latéral repliable, grilles.
6. **États** — squelettes de chargement, états vides.

---

## Fidelity

**High-fidelity.** Couleurs, typographie, espacements, rayons et interactions sont définitifs et documentés ci-dessous en valeurs exactes. Reproduire au pixel avec les moyens du codebase.

Trois exceptions à traiter comme indicatif, pas comme spec :

- Les **graphiques** sont dessinés en SVG statique dans les maquettes. En production, garder **Chart.js** (déjà utilisé) et reproduire l'apparence : ligne 2,2 px, dégradé de remplissage vertical, benchmark en pointillés `4 4`, point terminal avec halo, grille horizontale à 1 px.
- Le **cadre iPhone** autour des maquettes mobiles est un outil de présentation, pas un élément d'UI.
- Les **données** sont fictives et réalistes ; brancher les vraies.

---

## Screens / Views

Viewport mobile de référence : **402 × 874** (iPhone 16 Pro). Viewport desktop de référence : **1440 × 1024**. Basculement à **≥ 1024 px**.

### Chrome global (mobile)

**Header** — `position: sticky`, `padding: 52px 16px 10px` (52 px = safe-area haute), fond `linear-gradient(180deg, var(--hdrA), var(--hdrB))` + `backdrop-filter: blur(18px)`, bordure basse 1 px `var(--l1)`, `z-index: 3`.

- *Switcher de portefeuille* : bouton `flex: 1`, `padding: 8px 12px`, `radius: 12px`, bordure 1 px `var(--l3)`, fond `var(--f4)`, texte `Archivo 600 15px`, label `Portefeuille Principal` tronqué en ellipse. À gauche, pastille 8 px `#00d3f2` avec `box-shadow: 0 0 10px rgba(0,211,242,.9)`. À droite, chevron 7 px (bordures 1,6 px `var(--dim)`, `rotate(45deg)`). Hover : fond `var(--f5)`. Ouvre le panneau switcher.
- *Réglages* : bouton 40 × 40, `radius: 12px`, même bordure / fond. Icône « sliders » : 3 barres 17 × 1,6 px `var(--soft)` avec un point 5 px décalé sur chacune (gauche / droite / centre). Ouvre la feuille Réglages.

**Zone de scroll** — `flex: 1`, `overflow-y: auto`, `padding-bottom: 108px` (nav + FAB), barres de défilement masquées, `touch-action: pan-y`, `z-index: 1`. Porte le pull-to-refresh.

**Sous-navigation** — `position: sticky; top: 0`, `z-index: 2`, `display: flex; gap: 15px`, scroll horizontal, `padding: 10px 16px 0`, même fond en verre que le header. Onglets `Archivo 600 14px` : actif `var(--txt)` + barre 2 px `#00d3f2` en bas, inactif `var(--dim)`. Libellés : `Vue d'ensemble`, `Holdings`, `Transactions`, `Analyse`. Transition `color .18s`.

**FAB** — `position: absolute; right: 16px; bottom: 100px`, 56 × 56, `radius: 20px`, fond `#00d3f2`, `box-shadow: 0 12px 32px rgba(0,211,242,.34)`, croix 20 × 2,4 px `#05161c`, `aria-label="Ajouter une transaction"`. Hover `#5ce6ff`. Zone de pouce, au-dessus de la nav. Ouvre la feuille Nouvelle transaction.

**Nav basse** — `position: absolute; bottom: 0`, `padding: 9px 8px 26px` (26 px = safe-area basse), fond `var(--nav)` + `backdrop-filter: blur(22px)`, bordure haute 1 px `var(--l1)`, `z-index: 8`. 4 items `flex: 1`, colonne, `gap: 5px`, label `Archivo 600 10px`, icône 19 × 19 dessinée en CSS :

| Item | Label | Icône |
|---|---|---|
| overview | Aperçu | grille 2 × 2, `gap: 2.5px` |
| holdings | Holdings | 3 barres alignées en bas (9 / 16 / 12 px) |
| transactions | Transactions | 3 traits 2 px, `gap: 3.5px` |
| analysis | Analyse | cercle, bordure 4 px |

Actif `#00d3f2`, inactif `var(--dim2)`.

### 1. Vue d'ensemble (écran d'accueil)

**Cartes de synthèse** — rangée `display: flex; gap: 12px`, `overflow-x: auto`, `scroll-snap-type: x mandatory`, `padding: 14px 16px 6px`. Chaque carte : `width: 286px`, `flex: none`, `scroll-snap-align: center`, `padding: 16px`, `radius: 18px`, bordure 1 px `var(--l1)`, fond `var(--surf)`. La première seulement : `linear-gradient(155deg, rgba(0,211,242,.10), var(--surfA) 42%, var(--surf))`.

Anatomie : libellé `Archivo 500 10.5px`, `letter-spacing: .08em`, `uppercase`, `var(--dim)` → chiffre principal `Roboto Mono 700 26–29px`, `letter-spacing: -.02em`, tabulaire → séparateur `margin-top: 12px; padding-top: 11px; border-top: 1px var(--l1)` → ligne(s) secondaire(s) en `space-between`, libellé 12 px `var(--dim)`, valeur `Roboto Mono 500` `var(--txt)`.

| Carte | Chiffre | Secondaire |
|---|---|---|
| Valeur du portefeuille | `$133 558,18` (décimales à 18 px `var(--dim)`) | Actions `$126 407,96` · Cash `$7 150,22` |
| Gain non réalisé | `+$40 793` `var(--up)` + `+47,6 %` à 13 px | Coût d'achat actions `$85 614,50` |
| Gain réalisé | `+$6 204,80` `var(--up)` | Dividendes reçus `$1 842,36` |
| Gain total net | `+$46 998` `var(--up)` + `+50,8 %` | Rendement global · sur apport |

Sous la rangée, indicateur de pagination : 4 tirets 3 px, actif 14 px `#00d3f2`, inactifs 5 px `var(--f7)`.

**Carte résumé IA (élément héros)** — bordure en dégradé : conteneur `padding: 1px`, `radius: 20px`, fond `linear-gradient(150deg, rgba(0,211,242,.55), rgba(0,211,242,.05) 38%, var(--l1))`; intérieur `radius: 19px`, fond `linear-gradient(165deg, var(--aiTop), var(--surf) 46%)`, `padding: 16px`, `overflow: hidden`. Halo décoratif : cercle 190 × 170 en `top: -70px; right: -50px`, `radial-gradient(circle, rgba(0,211,242,.20), transparent 70%)`.

- En-tête : glyphe `✦` 14 px `#00d3f2` · titre `Résumé du portefeuille` `Archivo 700 15px` · `il y a 2 min` `Archivo 500 10px uppercase` `var(--dim)` en `margin-left: auto` · **bouton refresh** 32 × 32, `radius: 10px`, bordure 1 px `var(--l3)`, fond `var(--f4)`, SVG 15 px `stroke-width: 2.1` (arc `M20.5 12a8.5 8.5 0 1 1-2.9-6.4` + flèche `M20.5 4v5h-5`), `aria-label="Actualiser le résumé"`. **Il n'y a pas de bouton « Booster avec l'IA ».**
- Corps : `13.5px / 1.62`, `var(--soft)`, `text-wrap: pretty`, chiffres clés en `<b>` coloré `var(--up)` / `var(--dn)`.
- Chips par titre : rangée snappée, `gap: 10px`, débordant en `margin: 14px -16px -2px` / `padding: 0 16px 2px`. Chip `width: 232px`, `padding: 12px`, `radius: 14px`, bordure 1 px `var(--l1)`, fond `var(--f2)`. Contenu : logo 22 px (`radius: 6px`) + ticker `Roboto Mono 700 12.5px` + variation `Roboto Mono 500 11.5px` colorée à droite ; insight `12px / 1.5` `var(--soft2)` ; lien `Afficher plus` `Archivo 600 11.5px` `#00d3f2`.

**Graphique de portefeuille** — carte `radius: 20px`, bordure `var(--l1)`, fond `var(--surf)`, `padding: 16px 0 12px` (le graphe va bord à bord).

- Valeur courante `Roboto Mono 700 24px` + delta de période `Roboto Mono 500 13px` coloré. **Le delta s'anime** à chaque changement de période (voir § Interactions).
- Toggle devise : deux boutons 30 × 28, `radius: 9px`. Actif : fond `rgba(0,211,242,.14)`, bordure `rgba(0,211,242,.4)`, texte `#00d3f2`. Labels `$` / `€`. Taux appliqué dans la maquette : `EUR = USD × 0,918`.
- Toggle vue : conteneur `padding: 3px`, `radius: 11px`, fond `var(--f3)`, bordure `var(--l5)` ; segments `flex: 1`, `padding: 7px 0`, `radius: 8px`. Actif fond `var(--l3)`. Labels `Valeur` / `Performance`. En mode Performance, les montants deviennent des pourcentages.
- Sélecteur de benchmark : rangée de pastilles scrollables, `padding: 6px 11px`, `radius: 20px`, point 7 px devant. Un seul benchmark actif à la fois (re-clic = désactivé). `S&P 500 #a99cff` · `NASDAQ #4c8dff` · `CAC 40 #ffb020` · `MSCI World #3ddad7` · `Bitcoin #ff7a8a`. Actif : fond `var(--f5)`, bordure `var(--f7)`, texte `var(--txt)`, point coloré ; inactif : point `var(--f7)`.
- Zone de tracé `height: 172px`, `viewBox="0 0 340 172"`, `preserveAspectRatio="none"`. 3 lignes de grille horizontales (y = 26 / 72 / 118) `var(--grid)`. Aire `linear-gradient` vertical `#2ebd85` de `.34` à `0`. Ligne 2,2 px `#2ebd85`, jointures et extrémités arrondies. Benchmark : 1,4 px `var(--dim)`, `stroke-dasharray: 4 4`, `opacity: .75`. Point terminal : halo r = 9 `opacity: .16` + point r = 3,4.
- Sélecteur de période : 6 boutons `min-width: 60px`, colonne, `radius: 12px`, `padding: 8px 9px`. **Chaque bouton affiche le gain de sa période** : label `Archivo 600 11.5px` au-dessus, montant `Roboto Mono 500 11px` `var(--up)` en dessous. Actif : fond `rgba(0,211,242,.1)`, bordure `rgba(0,211,242,.35)`.

| Période | Label | Gain | Valeur de départ |
|---|---|---|---|
| 1M | 1 mois | +$3 214 | 130 344 |
| 3M | 3 mois | +$8 942 | 124 616 |
| 6M | 6 mois | +$14 608 | 118 950 |
| YTD | YTD | +$19 377 | 114 181 |
| 1Y | 1 an | +$26 145 | 107 413 |
| ALL | Tout | +$46 998 | 86 560 |

**Gagnants / Perdants du jour** — deux cartes empilées sur mobile, côte à côte (2 colonnes) sur desktop. En-tête : pastille 6 px (`var(--up)` / `var(--dn)`) + titre `Archivo 700 13.5px`. Lignes `gap: 11px`, `display: flex; align-items: center; gap: 10px` : logo 26 px (`radius: 8px`) · ticker largeur fixe 58 px `Roboto Mono 700 12.5px` · barre `flex: 1`, `height: 6px`, `radius: 4px`, rail `var(--l4)`, remplissage `linear-gradient(90deg, rgba(46,189,133,.35), #2ebd85)` (rouge pour les perdants), largeur = |variation| / max de la liste · pourcentage largeur fixe 62 px, aligné à droite, `Roboto Mono 700 12.5px` coloré.

Gagnants : `NVDA +4,12 %` · `TSM +2,87 %` · `AMZN +1,94 %` · `GOOGL +1,21 %`.
Perdants : `MC.PA −2,64 %` · `BTC −1,88 %` · `ASML −1,32 %` · `AAPL −0,41 %`.

**Dividendes à venir** — titre + sous-titre `estimation · 45 jours` 11 px `var(--dim)`. Grille mobile `1fr 88px 54px`, en-têtes `Archivo 500 10px uppercase .07em` `var(--dim)` avec bordure basse `var(--l4)`, lignes `padding: 11px 0`, séparateur `var(--f3)`, dernière ligne sans bordure. Cellule titre : logo 24 px + ticker + date 11,5 px `var(--dim)`. Montant `Roboto Mono 700 13px`, rendement `Roboto Mono 11.5px` `var(--dim)`.

`MSFT 12 sept. $28,22 0,65 %` · `AAPL 15 sept. $17,68 0,45 %` · `URTH 24 sept. $41,30 1,62 %` · `TSM 8 oct. $32,45 1,27 %`.

**Résultats à venir** — sous-titre `90 jours · actions US`. Lignes en flex : logo 24 px · ticker 56 px · date `flex: 1` 12 px `var(--soft)` · `BPA est.` + valeur en `<b>` `var(--txt)`.

`AAPL 29 oct. 2026 · 2,38` · `MSFT 28 oct. 2026 · 3,61` · `GOOGL 4 nov. 2026 · 2,87` · `NVDA 26 nov. 2026 · 1,42`.

### 2. Holdings

En-tête de liste : `10 positions · $126 407,96` à gauche, indice `← glisser pour vendre` 11 px `var(--dim)` à droite.

**Une carte par position** (`gap: 11px`). Chaque carte est un conteneur `display: flex; overflow-x: auto; scroll-snap-type: x mandatory` contenant deux enfants : la carte (`min-width: 100%`, `scroll-snap-align: start`) et le bouton d'action révélé par le glissement.

Carte : `padding: 14px`, `radius: 18px`, bordure `var(--l1)`, fond `var(--surf)`.
- Ligne haute : logo 34 px (`radius: 10px`) · ticker `Roboto Mono 700 14px` + badge d'allocation (`padding: 2px 6px`, `radius: 5px`, fond `rgba(0,211,242,.12)`, texte `#00d3f2`, `Archivo 600 10px`) · nom de société 11,5 px `var(--dim)` tronqué · à droite valeur `Roboto Mono 700 15px` et P&L `Roboto Mono 600 12px` coloré au format `+$10 322,40 · +93,1 %`.
- Barre d'allocation : `margin-top: 12px`, `height: 4px`, `radius: 3px`, rail `var(--l4)`, remplissage `#00d3f2` à la largeur du pourcentage.
- Pied : grille 3 colonnes `Qté` / `PRU` / `Cours`, libellés `Archivo 500 9.5px uppercase .07em` `var(--dim)`, valeurs `Roboto Mono 12.5px` ; `Cours` est coloré selon le signe du P&L.

Bouton *Vendre* : `width: 92px`, `margin-left: 8px`, `radius: 18px`, fond `linear-gradient(180deg, #f6465c, #d0324a)`, texte `Archivo 700 13px #fff`.

Positions maquettées : NVDA 16,9 % · GOOGL 15,4 % · MSFT 13,8 % · MC.PA 4,1 % (en euros, en perte) · BTC-USD 5,0 %.

### 3. Transactions

**Filtres** — barre de recherche `flex: 1`, `padding: 10px 12px`, `radius: 13px`, bordure `var(--f5)`, fond `var(--f3)`, icône loupe en CSS (cercle 11 px bordure 1,6 px + manche 5 × 1,6 px `rotate(45deg)`), placeholder `Rechercher un actif…` 13 px `var(--dim)`. Bouton `Filtres · 1` : `radius: 13px`, bordure `rgba(0,211,242,.35)`, fond `rgba(0,211,242,.1)`, texte `#00d3f2` — le compteur reflète les filtres actifs. Ouvre la feuille de filtres.

**Liste** — carte unique `radius: 18px`, `overflow: hidden`, lignes séparées par `var(--l5)`. Chaque ligne : bloc date 38 px centré (jour `Roboto Mono 700 14px`, mois `9.5px uppercase` `var(--dim)`) · badge de type + ticker · détail `qté × prix` `Roboto Mono 11.5px` `var(--dim)` · total `Roboto Mono 700 13.5px` aligné à droite (coloré pour dividendes / retraits / frais) · bouton `···` 26 × 26 (menu éditer / supprimer).

Badges — `padding: 2px 7px`, `radius: 5px`, `Archivo 700 9.5px uppercase .06em` :

| Type | Fond | Texte |
|---|---|---|
| Achat | `rgba(46,189,133,.14)` | `#2ebd85` |
| Vente | `rgba(246,70,92,.14)` | `#f6465c` |
| Dividende | `rgba(255,176,32,.14)` | `#ffb020` |
| Retrait | `rgba(139,124,255,.16)` | `#a99cff` |
| Dépôt | `rgba(76,141,255,.16)` | `#4c8dff` |
| Frais | `rgba(255,255,255,.08)` | `var(--soft2)` |

### 4. Analyse

**4 donuts** — carrousel snappé sur mobile (`width: 288px` par carte), grille 2 × 2 sur desktop. Carte `padding: 16px`, `radius: 20px`. Donut : `svg viewBox="0 0 120 120"`, `transform: rotate(-90deg)`, cercles `r: 46`, `stroke-width: 15`, segments via `stroke-dasharray` / `stroke-dashoffset` cumulés sur une circonférence de `2π × 46`. Au centre, part du premier segment `Roboto Mono 700 26px` + son libellé 11 px `var(--dim)`. Légende : 5 lignes max, carré 8 px (`radius: 2px`), libellé `flex: 1` 12 px `var(--soft)`, pourcentage `Roboto Mono 500` tabulaire.

Palette de séries (ordre fixe, ne pas thématiser) : `#00d3f2`, `#2ebd85`, `#a99cff`, `#ffb020`, `#ff7a8a`, `#4c8dff`, `#3ddad7`, `#6b7280`.

- *Par actif* : NVDA 16,9 · GOOGL 15,4 · MSFT 13,8 · AMZN 12,5 · AAPL 12,5 · URTH 8,0 · ASML 7,7 · Autres 13,2
- *Par classe d'actif* : Actions 82,3 · ETF 7,6 · Liquidités 5,4 · Crypto 4,7
- *Par devise* : USD 92,4 · EUR 7,6
- *Par secteur* : Semi-conducteurs 28,6 · Tech & logiciels 26,3 · Consommation 16,6 · Diversifié 8,0 · Crypto 5,0 · Autres 15,5

**Performance des positions** — filtres en pastilles `Tout` / `En hausse` / `En baisse` / `Dividendes` (mêmes styles actif / inactif que les benchmarks, mais accent cyan). Classement horizontal : logo 24 px · ticker 56 px · barre `flex: 1` (largeur = |perf| / max du jeu filtré) · pourcentage 58 px aligné à droite. Tri par performance décroissante.

Données : NVDA +93,1 · GOOGL +72,9 · TSM +56,3 · MSFT +56,1 · AMZN +49,1 · BTC +41,4 · AAPL +34,7 · ASML +26,9 · URTH +17,8 · MC.PA −9,9. Le filtre `Dividendes` retient MSFT, AAPL, URTH, TSM.

**Profit** — même anatomie que le graphique principal mais en `#00d3f2` (aire `.30 → 0`), `height: 150px`, `viewBox="0 0 340 150"`, 2 lignes de grille (y = 40 / 90), total `+$46 998,26` en `Roboto Mono 700 15px` en haut à droite. Sélecteur de période identique, valeurs en cyan.

**Performance par année** — grille `1fr 84px 108px`, colonnes `Période` / `Rendement` / `Profit`. `2026 · YTD +18,4 % +$19 377` · `2025 +31,2 % +$21 940` · `2024 +22,7 % +$11 206` · `2023 −8,4 % −$3 118`.

### 5. États transverses

**Squelettes de chargement** — calque `position: absolute; top: 104px; bottom: 0`, `z-index: 4`, fond `var(--bg)`, `padding: 14px 16px`, `gap: 12px`. Blocs aux dimensions des vrais composants : 2 cartes 258 × 134, une rangée d'onglets (3 barres 12 px), un bloc graphique 186 px, un bloc 214 px, un bloc 120 px. Animation : `background: linear-gradient(90deg, var(--surf) 8%, var(--sk1) 22%, var(--surf) 40%)`, `background-size: 400–600px 100%`, `animation: shim 1.3–1.7s linear infinite` avec `@keyframes shim { 0% { background-position: -200px 0 } 100% { background-position: 340px 0 } }`. Durées décalées entre blocs pour éviter l'effet métronome. Un bloc sur deux reste statique.

**État vide** — même calque, centré. Illustration SVG 150 × 105 : rectangle `radius: 12px` rempli d'un `<pattern>` de rayures à 45° (`var(--surf)` / `var(--tile)`), plus un arc `r: 19`, `stroke-width: 6`, `rgba(0,211,242,.5)`, `stroke-dasharray: 60 60`. Titre `Aucune position pour l'instant` `Archivo 700 18px`. Corps `13.5px / 1.6` `var(--dim)`, `max-width: 270px` : « Ajoute ta première transaction — ou importe ton historique en CSV — et le portefeuille se construit tout seul. » CTA primaire `Ajouter une transaction`, CTA secondaire `Importer un CSV`.

### 6. Panneaux et feuilles basses

Toutes les surfaces modales partagent : voile `position: absolute; inset: 0`, fond `var(--scrim)`, `backdrop-filter: blur(3px)`, `animation: fadeIn .2s ease`, fermeture au clic ; feuille `border-radius: 24px 24px 0 0`, fond `var(--sheet)`, `backdrop-filter: blur(24px)`, bordure haute `var(--l2)`, `padding: 10px 16px 34px` (34 px = safe-area), poignée 38 × 4 px `var(--f8)` centrée, `animation: sheetUp .28s cubic-bezier(.22,.9,.24,1)` avec `@keyframes sheetUp { from { transform: translateY(100%) } to { transform: translateY(0) } }`.

- **Switcher de portefeuille** — pas une feuille basse mais un panneau ancré : `top: 104px; left/right: 16px`, `radius: 18px`, `box-shadow: 0 24px 60px var(--shadow)`, `animation: popIn .22s ease`. En-tête `Vues & portefeuilles`. Ligne `Tous les portefeuilles` (vue consolidée), puis un item par portefeuille : pastille colorée 26 px, nom `Archivo 600 13.5px`, valeur + performance en `Roboto Mono 11px`, chevron cyan sur l'actif dont le fond est `rgba(0,211,242,.07)`. Pied : action `Nouveau portefeuille` en cyan avec icône `+`. Portefeuilles maquettés : Principal `$133 558,18 +50,8 %` · PEA `€24 810,40 +12,4 %` · Crypto `$6 298,50 +41,4 %`.
- **Filtres** — titre `Filtres` + action `Réinitialiser`. Section `Type d'opération` : 6 pastilles `padding: 8px 13px`, `radius: 20px` (Achat / Vente / Dividende / Frais / Dépôt / Retrait), sélection multiple, actif en cyan. Section `Période` : deux champs `Depuis` / `Jusqu'à` (`radius: 13px`, libellé 10,5 px `var(--dim)`, valeur `Roboto Mono 13px`). CTA pleine largeur `Appliquer · 42 transactions` — **le compteur est dynamique**.
- **Nouvelle transaction** — titre + bouton `✕`. Segmented `Achat / Vente / Dividende / Autre` (actif : fond `rgba(46,189,133,.16)`, texte `var(--up)`). Carte actif sélectionné (bordure `rgba(0,211,242,.3)`, fond `rgba(0,211,242,.06)`, logo 30 px, ticker, `NVIDIA Corporation · NASDAQ`, lien `Changer`). Deux champs `Quantité` / `Prix unitaire` (`Roboto Mono 700 16px`). Ligne `Total estimé` = quantité × prix, recalculée en direct, `Roboto Mono 700 17px`. CTA `Enregistrer la transaction`.
- **Réglages** — titre `Réglages` + `✕`. Section `Apparence` : segmented **Sombre / Clair**, conteneur `padding: 4px`, `radius: 14px`, fond `var(--f3)` ; segment actif fond `rgba(0,211,242,.14)`, texte `var(--txt)`, anneau 13 px bordure 2 px `#00d3f2` (rempli sur `Clair`). Section `Données` : 4 lignes de navigation (libellé `Archivo 600 13.5px` + sous-titre 11,5 px `var(--dim)` + chevron) — `Recharger les prix`, `Synchroniser les dividendes`, `Importer / exporter un CSV`, `Résumé IA`. Pied : `Se déconnecter` en rouge (bordure `rgba(246,70,92,.35)`, fond `rgba(246,70,92,.1)`).

### 7. Desktop (≥ 1024 px, référence 1440 × 1024)

**Menu latéral, déployé** — `width: 236px`, `flex: none`, fond `var(--side)`, bordure droite `var(--l1)`, `padding: 22px 14px`, `gap: 26px`. Logo : carré 26 px `radius: 8px` `linear-gradient(140deg, #00d3f2, #0a7d92)` avec `Y` `Archivo 800 13px #04141a`, puis `Your Portfolio` `Archivo 700 14.5px`. Navigation : 4 items `padding: 10px 12px`, `radius: 11px`, pastille 6 px + label `Archivo 600 13.5px` ; actif fond `rgba(0,211,242,.1)` et pastille cyan. Bloc `Portefeuilles` : libellé de section `uppercase 10px`, 3 lignes pastille + nom + valeur abrégée (`$133k`, `€24k`, `$6k`). Pied collé en bas (`margin-top: auto`) : carte `Données de marché` avec pastille verte pulsée (`animation: glowD 2.4s ease-in-out infinite`) et `Yahoo Finance · live`.

**Menu latéral, replié** — rail `width: 68px`, colonne centrée : logo 28 px, 4 boutons 40 × 40 (`radius: 12px`, pastille 6–8 px, `title` = nom de l'onglet en infobulle), et en bas 3 pastilles colorées pour les portefeuilles. Le contenu principal reprend la largeur libérée.

**Bouton de repli** — premier élément de la barre supérieure, 38 × 38, `radius: 12px`, bordure `var(--f5)`, fond `var(--f1)`. Icône : rectangle 17 × 14 bordure 1,7 px `var(--soft)` avec un trait vertical 1,7 px à 4 px du bord gauche. `aria-label="Afficher ou masquer le menu"`. Bascule l'état ; persister la préférence.

**Barre supérieure** — `padding: 18px 28px`, bordure basse `var(--l1)`, fond en verre. Ordre : bouton de repli · switcher de portefeuille · espace flexible · recherche 250 px · bouton réglages (icône 3 traits 16 px) · CTA `Ajouter une transaction` (`padding: 11px 18px`, `radius: 12px`, fond `#00d3f2`, texte `#05161c`, `box-shadow: 0 8px 24px rgba(0,211,242,.26)`).

**Panneau Réglages desktop** — pas une feuille basse : panneau ancré `position: absolute; top: 64px; right: 28px`, `width: 296px`, `radius: 16px`, fond `var(--sheet)`, `box-shadow: 0 24px 60px var(--shadow)`, `padding: 14px`. Mêmes sections `Apparence` (segmented Sombre / Clair) et `Données` en lignes compactes.

**Barre d'onglets** — `padding: 0 28px`, `gap: 26px`, onglets `padding: 14px 0`, soulignement 2 px cyan sur l'actif. Redondante avec le menu latéral et synchronisée avec lui : les deux pilotent le même état.

**Contenu** — `padding: 24px 28px 34px`, `gap: 20px`, en colonne :

1. Cartes de synthèse en `grid-template-columns: repeat(4, 1fr)`, `gap: 16px` (plus de carrousel, plus d'indicateur de pagination). Chiffre principal monté à 28–30 px.
2. Rangée `grid-template-columns: 1fr 392px`, `gap: 16px`, `align-items: stretch` : graphique à gauche, résumé IA à droite. **Les deux cartes ont exactement la même hauteur** : la carte graphique est en `display: flex; flex-direction: column` et sa zone de tracé prend `flex: 1; min-height: 296px`. `viewBox="0 0 760 296"`, 4 lignes de grille (y = 52 / 120 / 188 / 256), ligne 2,4 px, point terminal r = 4 avec halo r = 11. Benchmarks sur une seule rangée qui passe à la ligne. Périodes en 6 boutons `flex: 1`. Dans la carte IA, les chips passent en pile verticale.
3. Gagnants / Perdants en 2 colonnes.
4. Dividendes / Résultats en 2 colonnes, en vraies tables : dividendes `1fr 130px 100px 80px` (Titre / Date estimée / Montant / Rendement), résultats `1fr 150px 110px` (Titre / Date de publication / BPA estimé). Dates au format long (`12 sept. 2026`).

---

## Interactions & Behavior

| Interaction | Comportement attendu |
|---|---|
| Onglets (mobile) | Balayage horizontal entre onglets + tap sur la sous-nav et sur la nav basse. Les trois sont synchronisés. Contenu en `animation: fadeIn .25s ease`. |
| Pull-to-refresh | `pointerdown` en haut de scroll (`scrollTop ≤ 2`) → suivi du `pointermove` avec résistance `×0,55`, plafond 72 px ; au relâchement, si le tirage dépasse 42 px, verrouillage à 46 px, spinner 18 px (`border-top-color: #00d3f2`, `animation: spin .8s linear infinite`), rechargement, retour à 0 (~1,4 s). En dessous du seuil, retour immédiat. |
| Bouton refresh du résumé IA | Même retour visuel que le pull-to-refresh (spinner en tête de scroll, ~1,2 s), puis nouveau texte de résumé. |
| Changement de période | Le delta se **compte** de l'ancienne à la nouvelle valeur : `requestAnimationFrame`, 420 ms, easing `1 - (1-t)³`. Le tracé change en même temps. Appliquer le même traitement à tout chiffre qui change de valeur sans changer de nature. |
| Toggle devise | Reformate tous les montants du graphique et des boutons de période. Ne touche pas aux valeurs déjà libellées dans leur devise d'origine (MC.PA reste en euros). |
| Toggle Valeur / Performance | Montants ↔ pourcentages, dans la valeur principale et sur les 6 boutons de période. |
| Benchmark | Sélection exclusive, re-clic pour désactiver. Ajoute / retire la courbe en pointillés. Normaliser les deux séries en base 100 pour que la comparaison ait un sens. |
| Swipe-to-sell | Glissement horizontal sur la carte de position (`scroll-snap` avec deux points d'ancrage) qui révèle `Vendre` à droite. Un seul volet ouvert à la fois. |
| Feuilles basses | Ouverture `sheetUp .28s cubic-bezier(.22,.9,.24,1)`, voile en `fadeIn .2s`. Fermeture par le voile, par `✕` ou par le CTA. Prévoir aussi la fermeture par glissement vers le bas sur la poignée. |
| Panneau switcher | `popIn .22s ease` — `from { opacity: 0; transform: translateY(6px) scale(.98) }`. |
| Filtres | Le compteur du bouton `Filtres · n` et celui du CTA `Appliquer · n transactions` reflètent l'état réel. |
| Bascule de thème | Change l'attribut de thème sur la racine ; toutes les couleurs suivent par variables CSS. Préférence persistée. |
| Repli du menu desktop | Bascule 236 px ↔ 68 px, préférence persistée. Prévoir une transition de largeur (~.2 s) ; les maquettes commutent sèchement. |
| Hover (desktop) | Surfaces interactives : fond `var(--f4)` → `var(--f5)`. CTA cyan : `#00d3f2` → `#5ce6ff`. |
| Cibles tactiles | Jamais moins de 44 px sur mobile. Le `···` des transactions fait 26 px visuellement : agrandir sa zone de frappe par `padding` ou pseudo-élément. |

**Responsive** — un seul point de rupture à **1024 px**. En dessous : carrousels snappés, nav basse, FAB, feuilles basses. Au-dessus : grilles, menu latéral, panneaux ancrés. Le contenu desktop est plafonné à 1440 px et centré au-delà.

**Accessibilité** — `aria-label` sur tous les boutons icône seule (fournis dans les maquettes). Les couleurs de gain / perte doivent être doublées par le signe `+` / `−`, déjà présent partout. En thème clair, le vert et le rouge sont assombris pour rester lisibles sur blanc (voir tokens).

---

## State Management

État à gérer, tel qu'implémenté dans les maquettes :

| Variable | Valeurs | Portée |
|---|---|---|
| `tab` | `overview` \| `holdings` \| `transactions` \| `analysis` | globale |
| `theme` | `dark` \| `light` | **persistée** (localStorage) |
| `sideOpen` | booléen (desktop) | **persistée** |
| `portfolio` | id du portefeuille actif, ou vue consolidée | **persistée** |
| `currency` | `USD` \| `EUR` | persistée |
| `chartMode` | `VALUE` \| `PERF` | de session |
| `benchmark` | `null` \| clé de benchmark | de session |
| `period` | `1M` \| `3M` \| `6M` \| `YTD` \| `1Y` \| `ALL` | de session |
| `profitPeriod` | idem, indépendant du précédent | de session |
| `perfFilter` | `all` \| `up` \| `down` \| `dividends` | de session |
| `txFilters` | `{ search, types[], from, to }` | de session |
| `sheet` | `null` \| `filters` \| `add` \| `settings` | éphémère |
| `switcherOpen` | booléen | éphémère |
| `pull` / `refreshing` | px de tirage, booléen | éphémère |
| `animatedGain` | valeur interpolée du delta | éphémère (rAF) |

**Données** — l'app actuelle a déjà ses appels (prix Yahoo Finance, logos logokit, dividendes, résultats, résumé IA). Aucun nouvel endpoint n'est requis par cette refonte. Chaque section a besoin de trois états : squelette pendant le chargement, contenu, état vide. Ne pas afficher de zéros à la place d'un état vide.

---

## Design Tokens

Deux thèmes par variables CSS. Le thème sombre est le défaut sur `:root`, le clair s'active par un attribut sur la racine (dans les maquettes `[data-om-theme="light"]`; côté production, `[data-theme="light"]` sur `<html>` est plus idiomatique).

```css
:root {
  /* fonds et surfaces */
  --bg: #0a0b0e;            /* fond d'app, near-black TradingView */
  --surf: #14161b;          /* cartes */
  --surfA: rgba(20,22,27,.9);
  --tile: #1b1e25;          /* fond de tuile logo */
  --side: #0c0e12;          /* menu latéral desktop */
  --aiTop: #16202a;         /* haut du dégradé de la carte IA */
  --sheet: rgba(24,27,33,.98);
  --nav: rgba(12,14,18,.82);
  --hdrA: rgba(10,11,14,.94);
  --hdrB: rgba(10,11,14,.72);
  --scrim: rgba(4,5,7,.62);
  --shadow: rgba(0,0,0,.6);
  --sk1: #1d2129;  --sk2: #1a1e25;   /* squelettes */

  /* texte */
  --strong: #ffffff;        /* chiffre principal */
  --txt: #eceff4;           /* texte courant */
  --soft: #c7ccd6;          /* corps secondaire */
  --soft2: #a8b0bd;         /* corps tertiaire */
  --dim: #8b93a1;           /* libellés, méta */
  --dim2: #6c7684;          /* icônes de nav inactives */

  /* traits et remplissages (--l* bordures, --f* fonds) */
  --l1: rgba(255,255,255,.07);  --l2: rgba(255,255,255,.1);
  --l3: rgba(255,255,255,.09);  --l4: rgba(255,255,255,.06);
  --l5: rgba(255,255,255,.05);
  --f0: rgba(255,255,255,.025); --f1: rgba(255,255,255,.03);
  --f2: rgba(255,255,255,.035); --f3: rgba(255,255,255,.04);
  --f4: rgba(255,255,255,.045); --f5: rgba(255,255,255,.08);
  --f6: rgba(255,255,255,.12);  --f7: rgba(255,255,255,.18);
  --f8: rgba(255,255,255,.2);
  --grid: rgba(255,255,255,.045);  /* grille de graphique */

  /* sémantique */
  --up: #2ebd85;
  --dn: #f6465c;
  --accTxt: #00d3f2;
}

[data-theme="light"] {
  --bg: #f4f5f7;  --surf: #ffffff;  --surfA: rgba(248,250,252,.92);
  --tile: #eff1f5;  --side: #ffffff;  --aiTop: #e9f8fc;
  --sheet: rgba(255,255,255,.98);  --nav: rgba(255,255,255,.9);
  --hdrA: rgba(244,245,247,.95);  --hdrB: rgba(244,245,247,.72);
  --scrim: rgba(15,23,42,.32);  --shadow: rgba(15,23,42,.16);
  --sk1: #e8ebf0;  --sk2: #eceff4;

  --strong: #05070b;  --txt: #10131a;  --soft: #414a58;
  --soft2: #55606e;   --dim: #6a7382;  --dim2: #98a1ae;

  --l1: rgba(15,23,42,.11);  --l2: rgba(15,23,42,.15);
  --l3: rgba(15,23,42,.13);  --l4: rgba(15,23,42,.1);
  --l5: rgba(15,23,42,.08);
  --f0: rgba(15,23,42,.03);  --f1: rgba(15,23,42,.035);
  --f2: rgba(15,23,42,.04);  --f3: rgba(15,23,42,.045);
  --f4: rgba(15,23,42,.05);  --f5: rgba(15,23,42,.07);
  --f6: rgba(15,23,42,.09);  --f7: rgba(15,23,42,.14);
  --f8: rgba(15,23,42,.18);
  --grid: rgba(15,23,42,.08);

  --up: #0b9c66;  --dn: #d92c43;  --accTxt: #0b8ba4;
}
```

**Constantes non thématisées** — l'accent d'action reste `#00d3f2` dans les deux thèmes (fond de CTA, avec texte `#05161c`), hover `#5ce6ff`. Les couleurs de séries de graphiques et de benchmarks ne changent pas non plus : `#00d3f2`, `#2ebd85`, `#a99cff`, `#ffb020`, `#ff7a8a`, `#4c8dff`, `#3ddad7`, `#6b7280`. `--up` / `--dn` en revanche s'assombrissent en thème clair : toujours passer par la variable pour les gains et pertes.

**Typographie**

```
Archivo      400 500 600 700 800   — UI, titres, libellés
Roboto Mono  400 500 700           — tous les chiffres
https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500;700&display=swap
```

Toute cellule numérique porte `font-variant-numeric: tabular-nums` pour l'alignement en colonne. Chiffres héros : `Roboto Mono 700`, `letter-spacing: -.02em`.

Échelle : héros 26–30 px · valeur de carte 15–17 px · corps 13–13,5 px · secondaire 12–12,5 px · méta 11–11,5 px · libellé de section 10–10,5 px `uppercase` `letter-spacing: .07–.09em` · micro-libellé 9,5 px. Interlignes : 1,5 pour les insights, 1,6–1,65 pour les paragraphes. Ne pas descendre en dessous de 9,5 px.

**Espacement** — échelle 2 / 3 / 4 / 6 / 8 / 10 / 11 / 12 / 14 / 16 / 18 / 20 / 22 / 26 / 34 px. Gouttière d'écran mobile 16 px, desktop 28 px. `gap` entre cartes : 11–14 px mobile, 16–20 px desktop. Padding interne de carte : 14–16 px mobile, 18–20 px desktop.

**Rayons** — 5 px badge · 6–10 px tuile logo · 8–9 px petit bouton · 11–13 px bouton / champ · 14 px chip · 16 px panneau desktop · 18 px carte · 20 px grande carte · 20 px FAB · 24 px haut de feuille basse · 20 px pastille (pill).

**Ombres** — CTA cyan `0 8px 24px rgba(0,211,242,.26–.28)`, FAB `0 12px 32px rgba(0,211,242,.34)`, panneau flottant `0 24px 60px var(--shadow)`, fenêtre desktop `0 40px 90px rgba(0,0,0,.5)`.

**Flou** — header 18 px · nav basse 22 px · feuilles et panneaux 24 px · voile 3 px. Toujours doubler `backdrop-filter` de `-webkit-backdrop-filter`.

**Animations** — `fadeIn .2–.25s ease` · `popIn .22s ease` · `sheetUp .28s cubic-bezier(.22,.9,.24,1)` · `spin .8s linear infinite` · `shim 1.3–1.7s linear infinite` · `glow 9s ease-in-out infinite` (halo d'ambiance) · `glowD 2.4s ease-in-out infinite` (pastille live) · transitions d'état `.15–.18s`. Respecter `prefers-reduced-motion` : couper les boucles décoratives et l'animation des chiffres.

---

## Assets

- **Polices** : Archivo et Roboto Mono, Google Fonts (lien ci-dessus). Envisager l'auto-hébergement pour la PWA hors-ligne.
- **Logos de sociétés** : `https://img.logokit.com/ticker/{TICKER}?token=pk_fr306e60debfe5e3d2759d` — le token déjà présent dans `app.js` (`LOGOKIT_TOKEN`). Chaque logo est posé **au-dessus d'une tuile monogramme** (fond `var(--tile)`, première lettre du ticker en `Roboto Mono 700` `var(--dim2)`) et masqué par `onerror` si l'image ne charge pas ; on ne voit donc jamais d'icône brisée. Ce repli est déjà implémenté dans les maquettes, à reprendre.
- **Icônes** : aucune bibliothèque. Tout est dessiné en CSS (chevrons, loupe, sliders, grille, barres, croix) ou en SVG inline (refresh, illustration d'état vide). Rien à installer.
- **Illustration d'état vide** : SVG inline, dans la maquette.
- Aucun bitmap. Les icônes PWA existantes de `Dev/public/icons/` restent valables.

---

## Files

Dans `design/` :

| Fichier | Contenu |
|---|---|
| `Portfolio Redesign.dc.html` | **Point d'entrée.** Canvas de revue : les 8 cadres mobiles + le cadre desktop, avec les notes de design. Ouvrir celui-ci en premier. |
| `Portfolio App.dc.html` | L'écran mobile complet, interactif. Toute la spec mobile est là. Props : `initialTab`, `variant` (`normal` / `loading` / `empty`), `theme` (`dark` / `light`), `initialSwitcher`. |
| `Portfolio Desktop.dc.html` | Le breakpoint 1440, interactif. Prop `theme`. |
| `ios-frame.jsx`, `support.js` | Uniquement l'échafaudage de présentation et le runtime des maquettes. **Aucune valeur de design ici — ne pas lire pour l'implémentation.** |

Les maquettes s'ouvrent dans un navigateur et sont **cliquables** : onglets, devise, Valeur / Performance, benchmarks, périodes (le chiffre s'anime), filtres du classement, feuilles Filtres / Nouvelle transaction / Réglages (bascule de thème), switcher de portefeuille, pull-to-refresh (tirer vers le bas), swipe-to-sell (glisser une carte de holding), repli du menu desktop. Interagir avec les maquettes avant d'implémenter : le timing et le ressenti sont plus faciles à lire en direct qu'en prose.

Cadres du canvas : `1a` Aperçu · `1b` Holdings · `1c` Analyse · `1d` Transactions · `1e` chargement · `1f` vide · `1g` switcher ouvert · `1i` thème clair · `1h` desktop 1440.

Fichiers cibles dans le codebase : `Dev/public/style.css` (tokens et styles), `Dev/public/js/app.js` (fonctions `render*` / `init*`, gestion d'état), `Dev/public/index.html` (structure, nav basse, feuilles basses).

---

## Notes pour Claude Code

- La copie est en **français**, comme l'app actuelle. Les libellés exacts sont dans ce document et dans les maquettes ; ne pas les réécrire ni les traduire.
- Les nombres suivent le format français : espace fine comme séparateur de milliers, virgule décimale, espace avant `%`. Le symbole de devise précède le montant (`$133 558,18`). Le signe moins d'affichage est `−` (U+2212), pas un tiret ASCII.
- **Ne pas ajouter de fonctionnalité** absente de cette spec. Si une zone semble vide, c'est un problème de mise en page, pas un manque de contenu.
- Un seul accent (cyan) pour les actions. Le vert et le rouge sont réservés à la donnée financière : jamais un bouton vert, jamais un titre rouge.
- Le codebase actuel construit son DOM par `innerHTML` dans les fonctions `render*`. C'est acceptable pour cette refonte, mais toute chaîne issue de données (nom de société, nom de portefeuille) doit être échappée avant interpolation.
- Le résumé IA est un texte factuel, sans emphase promotionnelle. Le rédacteur reste celui de l'app actuelle.
