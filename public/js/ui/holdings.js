/**
 * Onglet Holdings : glissement horizontal des cartes de position (mobile).
 *
 * Fragment de l'objet App : fusionne dans le controleur par app.js, d'ou le
 * `this` partage avec les autres fragments.
 */



export const holdings = {
    initHoldingsSwipe() {
        const list = document.getElementById('holdingsCardsList');
        if (!list) return;
        const OPEN = -96;
        list.querySelectorAll('.holding-swipe').forEach(sw => {
            const card = /** @type {HTMLElement} */ (sw.querySelector('.holding-card'));
            if (!card) return;
            let x0 = 0, y0 = 0, dx = 0, open = false, active = false, decided = false, horiz = false;
            const set = (v) => { card.style.transform = `translateX(${v}px)`; };
            const closeOthers = () => {
                list.querySelectorAll('.holding-swipe.is-open').forEach(o => {
                    if (o === sw) return;
                    o.classList.remove('is-open');
                    const c = /** @type {HTMLElement} */ (o.querySelector('.holding-card'));
                    if (c) c.style.transform = 'translateX(0)';
                });
            };
            card.addEventListener('touchstart', (e) => {
                const t = /** @type {TouchEvent} */ (e).touches[0];
                x0 = t.clientX; y0 = t.clientY; dx = 0;
                active = true; decided = false; horiz = false;
                sw.classList.add('dragging');
            }, { passive: true });
            card.addEventListener('touchmove', (e) => {
                if (!active) return;
                const t = /** @type {TouchEvent} */ (e).touches[0];
                dx = t.clientX - x0;
                const dy = t.clientY - y0;
                if (!decided) {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                    decided = true;
                    horiz = Math.abs(dx) > Math.abs(dy);
                    if (horiz) closeOthers();
                }
                if (!horiz) return;
                e.preventDefault();
                let v = (open ? OPEN : 0) + dx;
                if (v > 0) v = 0;
                if (v < OPEN) v = OPEN;
                set(v);
            }, { passive: false });
            const end = () => {
                if (!active) return;
                active = false;
                sw.classList.remove('dragging');
                if (!horiz) return;
                const v = (open ? OPEN : 0) + dx;
                open = v <= OPEN / 2;
                sw.classList.toggle('is-open', open);
                set(open ? OPEN : 0);
            };
            card.addEventListener('touchend', end);
            card.addEventListener('touchcancel', end);
            sw.addEventListener('click', (e) => {
                if (/** @type {Element} */ (e.target).closest('.holding-swipe-action')) return;
                if (open) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    open = false;
                    sw.classList.remove('is-open');
                    set(0);
                }
            }, true);
        });
    },
};
