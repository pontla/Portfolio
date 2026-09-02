// Dates de transactions non canoniques. Le moteur normalise toute date au
// chargement, mais la garantie doit tenir de bout en bout : une ligne stockee
// sous une autre ecriture du meme jour doit s'afficher et se filtrer comme une
// ligne canonique. Ce fichier installe son propre jeu de donnees, d'ou
// l'absence de `beforeEach` partage.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.js';

test('une date stockee sans zero de tete s affiche et passe les filtres', async ({ page }) => {
    // Meme jour que le jeu par defaut, ecrit '2024-2-1'. Les bornes du
    // formulaire, elles, sont canoniques : compare en texte, '2024-2-1' passe
    // pour posterieur au '2024-02-01' et la ligne disparaissait du tableau.
    await bootApp(page, { tradeDate: '2024-2-1' });

    await page.locator('button[data-tab="transactions"]:visible').first().click();
    await expect(page.locator('#transactionsTableBody')).toContainText('01/02/2024');

    await page.locator('#txFilterOpenBtn').click();
    await page.locator('#txFromFilter').fill('2024-02-01');
    await page.locator('#txToFilter').fill('2024-02-01');
    await page.locator('#txApplyBtn').click();

    // Le vide se rend lui aussi comme une ligne de tableau : on verifie le
    // contenu, pas le nombre de lignes.
    const body = page.locator('#transactionsTableBody');
    await expect(body).not.toContainText('Aucune transaction');
    await expect(body).toContainText('01/02/2024');
});
