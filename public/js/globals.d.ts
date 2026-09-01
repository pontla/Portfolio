// Declarations ambiantes des globales chargees par CDN dans index.html, et des
// quelques proprietes ad hoc posees sur des noeuds DOM.
//
// Les paquets npm correspondants sont des devDependencies **de typage seul**,
// epinglees sur les memes versions que les balises <script> (Chart.js 4.5.1,
// supabase-js 2.112.4) : rien n'est bundle, le runtime reste zero-dependance.

import type { Chart as ChartJs, ChartConfiguration, ChartType } from 'chart.js';
import type { createClient } from '@supabase/supabase-js';

declare global {
    /** Chart.js UMD (cdn.jsdelivr.net, cf. index.html). */
    const Chart: {
        new <TType extends ChartType>(
            ctx: CanvasRenderingContext2D | HTMLCanvasElement,
            config: ChartConfiguration<TType>
        ): ChartJs<TType>;
    };

    interface Window {
        supabase: { createClient: typeof createClient };
        /** Controleur de l'app, expose pour les tests e2e (page.evaluate). */
        App?: Record<string, any>;
    }

    interface HTMLElement {
        /** Marqueur « handlers deja poses » (initTheme / initSideNav). */
        _bound?: boolean;
        /** Animation de compteur en cours (App.animateNumber). */
        _animating?: boolean;
    }
}
