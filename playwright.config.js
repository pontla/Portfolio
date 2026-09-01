import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    // Serveur de fichiers plats plutôt que `wrangler dev` : le Worker n'a aucun
    // code, seulement `[assets] directory = "./public"`. Le serveur reproduit le
    // contrat observable de la plateforme (`_headers`, `.assetsignore`, 307 HTML),
    // démarre en quelques millisecondes et ne s'effondre pas en cours de campagne.
    webServer: {
        command: `node scripts/static-server.mjs --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
