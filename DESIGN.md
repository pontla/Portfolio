---
name: Your Portfolio
description: Terminal de suivi de portefeuille near-black, mobile-first, en verre dépoli
colors:
  bg: '#0a0b0e'
  surf: '#14161b'
  tile: '#1b1e25'
  side: '#0c0e12'
  sheet: 'rgba(24, 27, 33, 0.98)'
  border-hairline: 'rgba(255, 255, 255, 0.07)'
  border-strong: 'rgba(255, 255, 255, 0.1)'
  scrim: 'rgba(4, 5, 7, 0.62)'
  ink-strong: '#ffffff'
  ink-primary: '#eceff4'
  ink-soft: '#c7ccd6'
  ink-dim: '#8b93a1'
  ink-dim2: '#6c7684'
  cyan-signal: '#00d3f2'
  cyan-signal-hi: '#5ce6ff'
  cyan-signal-ink: '#05161c'
  up: '#2ebd85'
  down: '#f6465c'
  warn: '#e8b23a'
  series-2: '#2ebd85'
  series-3: '#a99cff'
  series-4: '#ffb020'
  series-5: '#ff7a8a'
  series-6: '#4c8dff'
  series-7: '#3ddad7'
  series-8: '#6b7280'
  portfolio-azure: '#3b82f6'
  portfolio-emerald: '#10b981'
  portfolio-amber: '#f59e0b'
  portfolio-violet: '#8b5cf6'
  portfolio-fuchsia: '#ec4899'
  portfolio-slate: '#64748b'
typography:
  display:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '34px'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 'normal'
  headline:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '18px'
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 'normal'
  title:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '14px'
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 'normal'
  body:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 'normal'
  caption:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 'normal'
  label:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '11px'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '0.3px'
  numeric:
    fontFamily: "Roboto Mono, ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: '13px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.01em'
rounded:
  xs: '4px'
  sm: '6px'
  md: '8px'
  lg: '12px'
  xl: '16px'
  xxl: '18px'
  pill: '999px'
  circle: '50%'
spacing:
  xxs: '4px'
  xs: '6px'
  sm: '8px'
  md: '10px'
  lg: '12px'
  xl: '16px'
  xxl: '20px'
components:
  button-primary:
    backgroundColor: '{colors.cyan-signal}'
    textColor: '{colors.cyan-signal-ink}'
    rounded: '{rounded.md}'
    padding: '10px 16px'
  button-primary-hover:
    backgroundColor: '{colors.cyan-signal}'
    textColor: '{colors.cyan-signal-ink}'
    rounded: '{rounded.md}'
    padding: '10px 16px'
  card:
    backgroundColor: '{colors.surf}'
    textColor: '{colors.ink-primary}'
    rounded: '{rounded.xxl}'
    padding: '20px'
  fab:
    backgroundColor: '{colors.cyan-signal}'
    textColor: '{colors.cyan-signal-ink}'
    rounded: '{rounded.circle}'
    size: '52px'
  chip-toggle-active:
    backgroundColor: '{colors.tile}'
    textColor: '{colors.ink-primary}'
    rounded: '{rounded.sm}'
    padding: '6px 12px'
---

# Design System: Your Portfolio

## Overview

**Creative North Star: "Le Terminal de Nuit"**

Your Portfolio revendique sa filiation avec les écrans de trading professionnels — l'ergonomie TradingView portée à un public particulier — mais refuse leur bruit visuel. La surface est near-black par défaut (`#0a0b0e`), les panneaux se détachent par de très fines bordures translucides plutôt que par des ombres, et le verre dépoli (`backdrop-filter: blur()`) marque les couches temporaires (modales, en-têtes, menus) sans jamais devenir un effet décoratif permanent. Tout chiffre — cours, P&L, pourcentage — s'aligne en `Roboto Mono` pour que l'œil compare des colonnes sans effort ; tout le reste parle en `Archivo`.

L'écran refuse deux choses par construction : le bruit chromatique (le cyan de marque est un signal, pas un décor — voir _The One Signal Rule_ ci-dessous) et le chiffre inventé (une valeur absente s'écrit « — », jamais un zéro silencieux ni une carte vide — voir [PRODUCT.md](PRODUCT.md)). Le système assume une densité d'information élevée — c'est un terminal, pas une brochure — et la maîtrise par la hiérarchie typographique et l'espacement plutôt que par la simplification du contenu.

**Key Characteristics:**

- Near-black par défaut, thème clair symétrique et commutable, jamais un simple filtre d'inversion.
- Glassmorphism réservé aux couches temporaires (modales, en-têtes sticky, menus déroulants) — jamais sur une carte au repos.
- Cyan Signal (`#00d3f2`) rare et fonctionnel : CTA principal, état actif, focus. Vert/rouge exclusivement financiers.
- Chiffres toujours en `Roboto Mono` tabulaire ; le reste de l'UI en `Archivo`.
- Bento grid : cartes asymétriques à coins généreusement arrondis (18px), bordures à faible opacité plutôt que des ombres.
- Mobile-first natif : navigation basse fixe, FAB circulaire, modales qui deviennent des bottom sheets sous 1024px.

## Colors

Palette near-black à un seul accent fonctionnel, avec un vocabulaire de gris à deux échelles (opacité sur blanc pour le sombre, sur encre marine pour le clair) qui fait tout le travail de hiérarchie sans multiplier les teintes.

### Primary

- **Cyan Signal** (`#00d3f2`) : CTA principal (`.btn-primary`, FAB), état actif des contrôles segmentés, anneau de focus, liens d'action. **La rareté est la règle** — voir _The One Signal Rule_.
- **Cyan Signal Hi** (`#5ce6ff`) : variante éclaircie pour les cas de contraste renforcé (halos terminaux de graphique).
- **Cyan Signal Ink** (`#05161c`) : encre quasi-noire posée sur fond cyan (texte du bouton primaire, du FAB).

### Neutral

- **Fond** (`#0a0b0e` sombre / `#f4f5f7` clair) : arrière-plan de l'app.
- **Surface** (`#14161b` sombre / `#ffffff` clair) : cartes, modales, champs.
- **Tuile** (`#1b1e25` sombre / `#eff1f5` clair) : élément posé sur une surface (piste de gauge, chip inactive).
- **Panneau latéral** (`#0c0e12` sombre / `#ffffff` clair) : menu desktop repliable.
- **Feuille** (`rgba(24, 27, 33, 0.98)` sombre) : fond des modales/bottom sheets, quasi-opaque sous le flou.
- **Encre forte** (`#ffffff` sombre / `#05070b` clair) : titres, valeurs saillantes.
- **Encre primaire** (`#eceff4` sombre / `#10131a` clair) : texte courant.
- **Encre douce** (`#c7ccd6` sombre / `#414a58` clair) : texte secondaire lisible.
- **Encre atténuée** (`#8b93a1` sombre / `#6a7382` clair) : libellés, méta-information.
- **Bordure fil** (`rgba(255,255,255,0.07)` sombre / `rgba(15,23,42,0.11)` clair) : séparation par défaut des cartes — jamais une ombre.

### Semantic (financier — voir _The Financial Color Rule_)

- **Hausse** (`#2ebd85`) : gain, achat, dividende positif.
- **Baisse** (`#f6465c`) : perte, vente.
- **Avertissement** (`#e8b23a`) : donnée périmée ou estimée (ex. taux de change de repli).

### Series (visualisation)

- Huit teintes de répartition (`--s1`…`--s8`, dont `cyan-signal`, `up`, `#a99cff`, `#ffb020`, `#ff7a8a`, `#4c8dff`, `#3ddad7`, `#6b7280`) réservées aux donuts et graphiques multi-séries — jamais à l'UI de contrôle.

### Portfolio Accent

Six couleurs que l'utilisateur choisit pour identifier _son_ portefeuille — un rôle d'identité personnelle, distinct du Cyan Signal (action système) et des Series (visualisation de données). Utilisées à deux endroits seulement : la puce ronde du sélecteur de portefeuille actif (`#activePortfolioBullet`) et le sélecteur de couleur de la modale de création/édition de portefeuille (`#portfolioColorPicker`).

- **Azur** (`#3b82f6`) : option par défaut d'un nouveau portefeuille.
- **Émeraude** (`#10b981`)
- **Ambre** (`#f59e0b`)
- **Violet** (`#8b5cf6`)
- **Fuchsia** (`#ec4899`)
- **Ardoise** (`#64748b`) : l'option neutre pour un portefeuille qui ne veut pas de teinte marquée.

### Named Rules

**The Portfolio Accent Boundary Rule.** La palette Portfolio Accent n'existe que pour distinguer des portefeuilles entre eux ; elle ne doit jamais migrer vers un contrôle d'UI système (bouton, état actif, focus) ni vers une série de graphique. Un nouveau besoin de couleur d'identité personnelle pioche dans ces six teintes plutôt que d'en inventer une septième.

**The One Signal Rule.** Le Cyan Signal n'apparaît que sur une action ou un état — CTA principal, actif, focus — jamais en décor ou en fond de section. S'il n'y a ni action ni état à signaler, il n'y a pas de cyan sur l'écran.

**The Financial Color Rule.** Vert et rouge ne désignent que la performance financière (gain/perte, achat/vente). Un état d'interface générique (succès de formulaire, erreur de validation) utilise l'encre et le Cyan Signal, jamais vert/rouge — pour qu'aucune couleur ne puisse se lire comme une variation de marché qu'elle n'est pas.

## Typography

**UI Font:** Archivo (avec repli système `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
**Numeric Font:** Roboto Mono (avec repli `ui-monospace, 'SF Mono', Menlo, monospace`)

**Character :** Archivo porte la voix de l'interface — neutre, géométrique, confiante sans être froide. Roboto Mono existe pour une seule raison : aligner les chiffres en colonnes parfaites. Le passage de l'un à l'autre marque visuellement la frontière entre « ce qui s'explique » et « ce qui se compare ».

### Hierarchy

- **Display** (700, 34px, 1.25) : titre hero de la landing publique uniquement.
- **Headline** (700, 18–26px, 1.3) : titres de section, valeur d'en-tête de graphique.
- **Title** (600, 14–15px, 1.3) : titres de carte, de modale.
- **Body** (400, 13px, 1.4) : texte courant, libellés de formulaire.
- **Caption** (400, 12px, 1.3) : annotations secondaires (« estimation, 45 jours »), en-têtes de colonne des tableaux compacts (dividendes/résultats à venir). Non gras, non uppercase — se distingue du Label par son registre plus discret.
- **Label** (600, 11px, 1.2, 0.3px, souvent uppercase) : badges de transaction, libellés de navigation basse.
- **Numeric** (500–700, 12–36px selon contexte, `Roboto Mono`, letter-spacing légèrement négatif sur les grandes valeurs) : cours, P&L, pourcentages, valeur de synthèse du score.

### Named Rules

**The Tabular Numbers Rule.** Toute donnée chiffrée destinée à être comparée en colonne ou suivie dans le temps (cours, PRU, P&L, pourcentages, valeur de score) s'écrit en `Roboto Mono`. Un chiffre en `Archivo` est un signal que ce n'est pas une donnée à comparer (ex. un compteur de caractères).

## Layout

Grille mobile-first : conteneur unique en pile verticale sous 768px, cartes bento en `stats-grid` (`repeat(auto-fit, minmax(200px, 1fr))`, `gap: 20px`) dès que l'espace le permet. Trois paliers actifs : `≤ 768px` (mobile — navigation basse fixe, FAB, sheets), `769–1023px` (tablette — grilles élargies, pas de menu latéral), `≥ 1024px` (desktop — menu latéral repliable `236px ↔ 68px` via `[data-side='collapsed']`, `padding-left` du conteneur qui s'ajuste en transition `0.2s ease`).

Rythme d'espacement en paliers serrés et cohérents : `4px / 6px / 8px / 10px / 12px / 16px / 20px`. Les contrôles denses (chips, boutons de plage temporelle) utilisent le bas de l'échelle (4–10px) ; les cartes et sections utilisent le haut (16–20px). Padding de carte standard : `20px` desktop, `14–16px` mobile.

## Elevation & Depth

Système hybride : **plat par défaut, flou pour le temporaire, ombre pour le flottant.** Les cartes au repos n'ont ni ombre ni surélévation — seule une bordure fil (`rgba(255,255,255,0.07)`) les détache du fond ; une ombre légère (`0 4px 6px -1px var(--shadow)`) n'apparaît qu'au survol comme retour d'interactivité. Le glassmorphism (`backdrop-filter: blur(10–24px)`) est réservé aux couches qui se posent temporairement au-dessus du contenu : modales/sheets (`blur(24px)`), en-têtes sticky, menus déroulants — jamais une carte de contenu statique. Les éléments réellement flottants (FAB, modale, menu déroulant) portent une ombre portée franche pour affirmer qu'ils survolent l'écran : `0 12px 32px rgba(0,211,242,0.34)` pour le FAB (teintée du Cyan Signal), `0 24px 60px var(--shadow)` pour modales et menus.

### Shadow Vocabulary

- **Hover de carte** (`box-shadow: 0 4px 6px -1px var(--shadow)`) : retour d'interactivité sur une carte statique.
- **FAB** (`box-shadow: 0 6px 16px rgba(0,0,0,0.25)` mobile / `0 12px 32px rgba(0,211,242,0.34)` teinté accent) : affirme le flottement au-dessus de la nav basse.
- **Modale / sheet** (`box-shadow: 0 24px 60px var(--shadow)`) : la couche la plus élevée du système.
- **Focus d'input** (`box-shadow: 0 0 0 3px rgba(0,211,242,0.18)`) : anneau de focus teinté accent, pas de bordure épaissie.

### Named Rules

**The Flat-At-Rest Rule.** Aucune carte, tuile ou conteneur de contenu ne porte d'ombre à l'état de repos. La profondeur au repos vient uniquement de la bordure fil et du contraste de surface ; l'ombre est réservée à la réponse (hover) ou au flottement réel (FAB, modale, menu).

## Shapes

Coins généreusement arrondis et cohérents par rôle plutôt qu'une échelle unique : `4px` (badges, micro-éléments), `6px` (état actif de chip), `8px` (boutons, inputs, groupes de toggle), `12px` (petites cartes historiques), `16px` (haut d'une bottom sheet — coins bas carrés puisqu'elle colle au bord de l'écran), `18px` (cartes principales — `.card`, `.stat-card`, `.analysis-card`), `999px` (pilules — chips de filtre, badges de plage), `50%` (cercles — FAB, avatars, logo de marque). Aucune découpe, aucun clip-path : le langage de forme reste des rectangles à coins arrondis et des cercles.

### Named Rules

**The Sheet Corner Rule.** Une modale desktop a quatre coins arrondis (`12px`) posée au centre de l'écran ; la même modale sur mobile n'arrondit que ses deux coins hauts (`16px 16px 0 0`) car elle colle au bord bas de l'écran, en cohérence avec sa physique de bottom sheet (`animation: sheetUp`).

## Components

### Buttons

- **Shape :** `8px` de rayon (`6px` en variante `sm`).
- **Primary :** fond Cyan Signal, texte encre quasi-noire (`--acc-ink`), padding `10px 16px`, poids `500`.
- **Hover / Focus :** transition `background 0.18s, opacity 0.2s` ; le survol atténue légèrement l'opacité plutôt que de changer la teinte.
- **Outline / Ghost :** fond quasi-transparent (`--f4`), bordure fil (`--l3`), texte encre primaire — pour les actions secondaires (export CSV, régénérer l'analyse).

### FAB (Floating Action Button)

- **Style :** cercle `52px`, fond Cyan Signal, ombre teintée accent, ancré `bottom: calc(66px + safe-area-inset-bottom)` pour flotter au-dessus de la nav basse. Visible uniquement sous `1024px` — le desktop utilise le bouton primaire du header à la place.

### Chips / Toggles

- **Toggle group** (devise, plage) : fond tuile (`--f3`), padding `4px`, rayon `8px` ; état actif = fond surface + ombre légère (`0 1px 2px`), ou halo accent (`box-shadow: inset 0 0 0 1px rgba(0,211,242,0.4)`) pour le sélecteur de devise.
- **Badges de transaction :** pilule discrète, `padding: 2px 8px`, `rayon 4px`, `font-size: 11px`, `uppercase`, `letter-spacing: 0.3px` ; couleur par type (achat/vente en vert/rouge, dépôt en bleu série, dividende en orange série, frais en gris neutre) — jamais la paire vert/rouge financière pour un type non directionnel.

### Cards / Containers

- **Corner Style :** `18px` (voir Shapes).
- **Background :** surface (`--surf`).
- **Shadow Strategy :** aucune au repos, hover léger — voir Elevation & Depth.
- **Border :** `1px solid` bordure fil (`--l1`).
- **Internal Padding :** `20px` desktop, `14–16px` mobile.

### Inputs / Fields

- **Style :** fond transparent sur bordure fil, rayon `8px`, padding `10px`, police héritée.
- **Focus :** bordure teintée Cyan Signal + anneau `box-shadow: 0 0 0 3px rgba(0,211,242,0.18)` — pas de changement de fond.
- **Error / Disabled :** non standardisé dans le code actuel — à établir lors d'un futur `harden`.

### Navigation

- **Mobile (`< 1024px`) :** nav basse fixe (`bottom-nav`), 5 onglets, icône + label `11px`/600, état actif teinté Cyan Signal, `env(safe-area-inset-bottom)` respecté.
- **Desktop (`≥ 1024px`) :** menu latéral fixe repliable `236px ↔ 68px`, transition `width/padding 0.2s ease`, logo en médaillon dégradé (`linear-gradient(140deg, #00d3f2, #0a7d92)`), libellés masqués à l'état replié.

### Score Dial (signature)

Demi-donut SVG (`score-arc`) qui synthétise un score d'analyse fondamentale en un seul geste visuel : piste neutre (`--tile`), arc de valeur qui se dessine par `stroke-dashoffset` (transition `0.7s cubic-bezier(0.22,1,0.36,1)`), teinté vert/rouge selon le signal (`data-signal="buy"/"sell"`) — jamais de cyan ici, la couleur porte un verdict financier, pas une action d'UI. Le chiffre du score est centré dans l'arc en `Roboto Mono` `36px/700`.

## Do's and Don'ts

### Do:

- **Do** garder le Cyan Signal réservé à l'action et à l'état actif — _The One Signal Rule_.
- **Do** écrire toute donnée chiffrée comparable en `Roboto Mono` — _The Tabular Numbers Rule_.
- **Do** détacher une carte au repos par la seule bordure fil, jamais par une ombre — _The Flat-At-Rest Rule_.
- **Do** remplacer toute donnée manquante par un tiret discret « — », jamais une carte vide ni « Donnée indisponible » (règle produit, voir [PRODUCT.md](PRODUCT.md)).
- **Do** arrondir une bottom sheet mobile uniquement en haut (`16px 16px 0 0`) — _The Sheet Corner Rule_.
- **Do** piocher dans les six teintes Portfolio Accent pour toute nouvelle identité de portefeuille plutôt que d'en créer une septième — _The Portfolio Accent Boundary Rule_.

### Don't:

- **Don't** utiliser une couleur Portfolio Accent pour un contrôle d'UI système ou une série de graphique — _The Portfolio Accent Boundary Rule_.
- **Don't** utiliser vert/rouge pour un état d'UI générique (succès/erreur de formulaire) — réservés à la performance financière, _The Financial Color Rule_.
- **Don't** appliquer `backdrop-filter: blur()` à une carte de contenu statique ; le flou signale une couche temporaire (modale, en-tête, menu), pas une carte au repos.
- **Don't** introduire une étape de build ou un framework JS : le projet est vanilla JS/CSS zero-build par contrainte technique assumée (voir [PRODUCT.md](PRODUCT.md)).
- **Don't** reformater `public/index.html` avec un outil générique — son script inline est verrouillé par un hash CSP (`npm run check:csp`).
