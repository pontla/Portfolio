/**
 * Contrat du serveur statique de test.
 *
 * Ce serveur remplace `wrangler dev` pendant la campagne e2e : toute la suite
 * end-to-end passe par lui. S'il s'écarte du comportement de Cloudflare Workers
 * static assets, les tests valident une application qui n'existe pas en ligne.
 * Les attentes ci-dessous ont été relevées sur le site déployé, pas déduites de
 * la documentation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStaticServer, parseAssetsIgnore, parseHeadersFile } from './static-server.mjs';

const REPO_PUBLIC = new URL('../public/', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Analyse des fichiers de configuration
// ---------------------------------------------------------------------------

describe('parseAssetsIgnore', () => {
    /** @param {string} pattern @param {string} path */
    const ignores = (pattern, path) => parseAssetsIgnore(pattern).some((re) => re.test(path));

    it('un motif sans separateur s applique a toute profondeur', () => {
        expect(ignores('.assetsignore', '.assetsignore')).toBe(true);
        expect(ignores('.assetsignore', 'js/core/.assetsignore')).toBe(true);
    });

    it('`**/*.test.js` attrape les tests a la racine comme en profondeur', () => {
        expect(ignores('**/*.test.js', 'js/app.test.js')).toBe(true);
        expect(ignores('**/*.test.js', 'js/core/portfolio.test.js')).toBe(true);
        expect(ignores('**/*.test.js', 'app.test.js')).toBe(true);
        expect(ignores('**/*.test.js', 'js/app.js')).toBe(false);
        expect(ignores('**/*.test.js', 'js/core/api.js')).toBe(false);
    });

    it('un repertoire ignore emporte son contenu', () => {
        expect(ignores('**/__snapshots__/', 'js/core/__snapshots__/a.snap')).toBe(true);
        expect(ignores('.claude-flow/', '.claude-flow/policy/state.json')).toBe(true);
        // Syntaxe .gitignore : sans separateur interne, le motif s'applique a
        // toute profondeur, la barre finale ne fait que le restreindre aux
        // repertoires.
        expect(ignores('.claude-flow/', 'js/.claude-flow/x.json')).toBe(true);
        // Avec un separateur interne, le motif est ancre sur la racine.
        expect(ignores('js/tmp/', 'js/tmp/x.json')).toBe(true);
        expect(ignores('js/tmp/', 'autre/js/tmp/x.json')).toBe(false);
    });

    it('ignore les commentaires et les lignes vides', () => {
        expect(parseAssetsIgnore('# rien\n\n  \n*.map')).toHaveLength(1);
    });

    it('une etoile simple ne traverse pas les repertoires', () => {
        expect(ignores('js/*.js', 'js/app.js')).toBe(true);
        expect(ignores('js/*.js', 'js/core/api.js')).toBe(false);
    });
});

describe('parseHeadersFile', () => {
    it('associe les lignes indentees au motif qui les precede', () => {
        const rules = parseHeadersFile(
            ['/*', '  X-A: 1', '  X-B: valeur: avec deux-points', '/js/*', '  X-C: 3'].join('\n')
        );
        expect(rules).toHaveLength(2);
        expect(rules[0].headers).toEqual([
            ['X-A', '1'],
            ['X-B', 'valeur: avec deux-points'],
        ]);
        expect(rules[1].headers).toEqual([['X-C', '3']]);
        expect(rules[1].pattern.test('/js/app.js')).toBe(true);
        expect(rules[1].pattern.test('/style.css')).toBe(false);
    });

    it('`/*` couvre la racine et toute la profondeur', () => {
        const [rule] = parseHeadersFile('/*\n  X: 1');
        for (const p of ['/', '/index.html', '/js/core/api.js']) {
            expect(rule.pattern.test(p)).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// Contrat HTTP, sur une arborescence controlee
// ---------------------------------------------------------------------------

describe('serveur statique', () => {
    /** @type {Awaited<ReturnType<typeof startStaticServer>>} */
    let server;
    /** @type {string} */
    let dir;
    /** @type {string} */
    let horsRacine;

    beforeAll(async () => {
        // La racine servie est un sous-repertoire : on peut ainsi deposer un
        // fichier juste au-dessus et verifier qu'aucune remontee ne l'atteint.
        horsRacine = await mkdtemp(join(tmpdir(), 'static-server-'));
        await writeFile(join(horsRacine, 'hors-racine.txt'), 'secret');
        dir = join(horsRacine, 'public');
        await mkdir(join(dir, 'js', '__snapshots__'), { recursive: true });
        await writeFile(join(dir, 'index.html'), '<h1>racine</h1>');
        await writeFile(join(dir, 'style.css'), 'body{}');
        await writeFile(join(dir, 'manifest.json'), '{}');
        await writeFile(join(dir, 'js', 'app.js'), 'export const a = 1;');
        await writeFile(join(dir, 'js', 'app.test.js'), 'secret');
        await writeFile(join(dir, 'js', 'types.d.ts'), 'secret');
        await writeFile(join(dir, 'js', '__snapshots__', 'a.snap'), 'secret');
        await writeFile(join(dir, '_headers'), '/*\n  X-Global: oui\n/js/*\n  X-Script: oui\n');
        await writeFile(
            join(dir, '.assetsignore'),
            '.assetsignore\n**/*.test.js\n**/__snapshots__/\n**/*.d.ts\n'
        );
        server = await startStaticServer({ dir, port: 0, hosts: ['127.0.0.1'] });
    });

    afterAll(async () => {
        await server.close();
        await rm(horsRacine, { recursive: true, force: true });
    });

    /**
     * @param {string} path
     * @param {RequestInit} [init]
     */
    const get = (path, init) => fetch(`${server.url}${path}`, { redirect: 'manual', ...init });

    it('sert index.html a la racine', async () => {
        const res = await get('/');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html');
        expect(await res.text()).toContain('racine');
    });

    it('redirige /index.html et /index vers / en 307', async () => {
        for (const p of ['/index.html', '/index']) {
            const res = await get(p);
            expect(res.status).toBe(307);
            expect(res.headers.get('location')).toBe('/');
        }
    });

    it('type MIME correct pour les modules ES', async () => {
        // Un `application/octet-stream` suffirait a empecher le navigateur de
        // charger l'application entiere.
        expect((await get('/js/app.js')).headers.get('content-type')).toBe('text/javascript');
        expect((await get('/style.css')).headers.get('content-type')).toBe('text/css');
        expect((await get('/manifest.json')).headers.get('content-type')).toBe('application/json');
    });

    it('applique _headers, y compris les motifs par sous-chemin', async () => {
        const racine = await get('/');
        expect(racine.headers.get('x-global')).toBe('oui');
        expect(racine.headers.get('x-script')).toBeNull();

        const script = await get('/js/app.js');
        expect(script.headers.get('x-global')).toBe('oui');
        expect(script.headers.get('x-script')).toBe('oui');
    });

    it('applique _headers aussi sur les 404, comme la plateforme', async () => {
        const res = await get('/inexistant');
        expect(res.status).toBe(404);
        expect(res.headers.get('x-global')).toBe('oui');
    });

    it('ne sert jamais les fichiers de configuration de la plateforme', async () => {
        for (const p of ['/_headers', '/_redirects', '/.assetsignore']) {
            expect((await get(p)).status).toBe(404);
        }
    });

    it('404 sur tout ce que .assetsignore exclut', async () => {
        for (const p of ['/js/app.test.js', '/js/types.d.ts', '/js/__snapshots__/a.snap']) {
            const res = await get(p);
            expect(res.status).toBe(404);
            expect(await res.text()).not.toContain('secret');
        }
    });

    it('aucun index de repertoire, aucun repli SPA', async () => {
        for (const p of ['/js', '/js/', '/route/inconnue']) {
            expect((await get(p)).status).toBe(404);
        }
    });

    it('refuse de sortir de la racine servie', async () => {
        // Propriete observable : rien au-dessus de la racine n'est lisible.
        // L'analyseur d'URL normalise `..` et `%2e%2e` avant la resolution de
        // fichier ; la garde du module est une seconde barriere.
        for (const p of ['/%2e%2e/hors-racine.txt', '/js/%2e%2e/%2e%2e/hors-racine.txt']) {
            const res = await fetch(`${server.url}${p}`, { redirect: 'manual' });
            expect(res.status, p).toBe(404);
            expect(await res.text()).not.toContain('secret');
        }
    });

    it('ETag stable et 304 sur if-none-match', async () => {
        const first = await get('/style.css');
        const etag = first.headers.get('etag');
        expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
        expect(first.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');

        const second = await get('/style.css', { headers: { 'if-none-match': etag } });
        expect(second.status).toBe(304);
        expect(await second.text()).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Le vrai repertoire public : la garde anti-fuite
// ---------------------------------------------------------------------------

describe('serveur statique sur le public/ du depot', () => {
    /** @type {Awaited<ReturnType<typeof startStaticServer>>} */
    let server;

    beforeAll(async () => {
        server = await startStaticServer({ dir: REPO_PUBLIC, port: 0, hosts: ['127.0.0.1'] });
    });
    afterAll(() => server.close());

    it('la CSP de production est bien active pendant les tests', async () => {
        // Sans cet en-tete, une CSP cassee reste invisible jusqu'a la mise en
        // ligne : c'est precisement ce que `wrangler dev` couvrait et qu'il
        // fallait conserver.
        const csp = (await fetch(`${server.url}/`)).headers.get('content-security-policy');
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain('sha256-');
    });

    it('le code de test du depot n est pas servi', async () => {
        // Regression deja survenue en production : l instantane de la timeline
        // etait telecharge publiquement, plus gros que l application entiere.
        const chemins = [
            '/js/app.test.js',
            '/js/core/api.test.js',
            '/js/core/__snapshots__/portfolio-timeline.test.js.snap',
            '/js/globals.d.ts',
            '/.assetsignore',
            '/_headers',
        ];
        for (const p of chemins) {
            expect((await fetch(`${server.url}${p}`)).status, p).toBe(404);
        }
    });

    it('les entrees reellement necessaires a l application repondent', async () => {
        for (const p of ['/', '/style.css', '/sw.js', '/manifest.json', '/js/app.js']) {
            expect((await fetch(`${server.url}${p}`)).status, p).toBe(200);
        }
    });
});
