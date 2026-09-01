/**
 * Serveur statique de développement, en remplacement de `wrangler dev` pour les
 * tests end-to-end.
 *
 * Le Worker de ce projet ne contient aucun code : `wrangler.toml` déclare
 * uniquement `[assets] directory = "./public"`. Faire tourner un runtime
 * `workerd` complet pour servir des fichiers plats coûtait cher et tombait en
 * panne au milieu des campagnes de tests. Ce module reproduit le contrat
 * observable de Cloudflare Workers static assets — et rien de plus :
 *
 *  - `_headers` est appliqué à toutes les réponses, 404 comprises. C'est ce qui
 *    rend la CSP de production réellement active pendant les tests : une
 *    directive cassée devient un échec e2e au lieu d'une panne silencieuse en
 *    production.
 *  - `.assetsignore` renvoie 404. Les fichiers de test, les instantanés et les
 *    `.d.ts` ne sont donc pas plus servis ici qu'en ligne.
 *  - `_headers` et `_redirects` sont de la configuration : jamais servis.
 *  - Résolution HTML « auto-trailing-slash » : `/` sert `index.html`, tandis que
 *    `/index.html` et `/index` renvoient une redirection 307 vers `/`.
 *  - Pas d'index de répertoire, pas de repli SPA : `not_found_handling` vaut
 *    `none` par défaut, un chemin inconnu est un 404 sec.
 *
 * Usage : node scripts/static-server.mjs [--port 8788] [--dir public]
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/vnd.microsoft.icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
    '.map': 'application/json',
};

/** Fichiers de configuration Cloudflare : lus par la plateforme, jamais servis. */
const CONFIG_FILES = new Set(['/_headers', '/_redirects']);

// --- .assetsignore ---------------------------------------------------------

/**
 * Traduit un motif de type gitignore en expression régulière ancrée sur un
 * chemin relatif à la racine servie (sans `/` initial).
 * @param {string} pattern
 * @returns {RegExp}
 */
function ignorePatternToRegExp(pattern) {
    const isDirOnly = pattern.endsWith('/');
    let body = isDirOnly ? pattern.slice(0, -1) : pattern;
    body = body.replace(/^\//, '');

    // Un motif sans séparateur s'applique à n'importe quelle profondeur.
    const anchored = body.includes('/');

    let re = '';
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '*') {
            if (body[i + 1] === '*') {
                // `**/` traverse zéro ou plusieurs répertoires.
                if (body[i + 2] === '/') {
                    re += '(?:[^/]+/)*';
                    i += 2;
                } else {
                    re += '.*';
                    i += 1;
                }
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else {
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }

    const prefix = anchored ? '^' : '^(?:[^/]+/)*';
    // Un répertoire ignoré emporte tout son contenu.
    const suffix = isDirOnly ? '/.*$' : '(?:/.*)?$';
    return new RegExp(prefix + re + suffix);
}

/**
 * @param {string} text contenu brut d'un `.assetsignore`
 * @returns {RegExp[]}
 */
export function parseAssetsIgnore(text) {
    return text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map(ignorePatternToRegExp);
}

// --- _headers --------------------------------------------------------------

/**
 * @param {string} text contenu brut d'un `_headers`
 * @returns {{ pattern: RegExp, headers: [string, string][] }[]}
 */
export function parseHeadersFile(text) {
    /** @type {{ pattern: RegExp, headers: [string, string][] }[]} */
    const rules = [];
    for (const raw of text.split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('#')) continue;
        if (/^\s/.test(raw)) {
            const rule = rules[rules.length - 1];
            const sep = raw.indexOf(':');
            if (!rule || sep === -1) continue;
            rule.headers.push([raw.slice(0, sep).trim(), raw.slice(sep + 1).trim()]);
        } else {
            rules.push({ pattern: urlPatternToRegExp(raw.trim()), headers: [] });
        }
    }
    return rules;
}

/** Motif d'URL Cloudflare : `*` pour un segment libre, `:nom` pour un paramètre. */
function urlPatternToRegExp(pattern) {
    const re = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+');
    return new RegExp(`^${re}$`);
}

// --- résolution des chemins ------------------------------------------------

/**
 * URL canonique d'un fichier HTML, selon `html_handling: auto-trailing-slash`.
 * @param {string} filePath chemin d'URL du fichier, ex. `/foo/index.html`
 * @returns {string}
 */
function canonicalHtmlUrl(filePath) {
    if (filePath === '/index.html') return '/';
    if (filePath.endsWith('/index.html')) return filePath.slice(0, -'/index.html'.length);
    return filePath.slice(0, -'.html'.length);
}

/**
 * Sert le répertoire `dir` selon le contrat Cloudflare static assets.
 * @param {string} dir
 */
export function createStaticHandler(dir) {
    const root = resolvePath(dir);

    /**
     * Relit `_headers` et `.assetsignore` à chaque requête. Deux petits fichiers
     * par requête ne coûtent rien, et une configuration mise en cache pour la
     * durée du processus se serait tue quand elle change — le serveur étant
     * réutilisé d'une campagne locale à l'autre.
     */
    async function config() {
        const read = async (name) => {
            try {
                return await readFile(join(root, name), 'utf8');
            } catch {
                return '';
            }
        };
        const [ignore, headers] = await Promise.all([read('.assetsignore'), read('_headers')]);
        return {
            ignores: parseAssetsIgnore(ignore),
            headerRules: parseHeadersFile(headers),
        };
    }

    /** @param {string} urlPath */
    async function isFile(urlPath) {
        const abs = join(root, urlPath);
        // Seconde barrière : l'analyseur d'URL normalise déjà `..` et `%2e%2e`
        // avant d'arriver ici. La garde reste, pour que la racine servie soit
        // une propriété du module et non un effet de bord de `new URL`.
        if (abs !== root && !abs.startsWith(root + '/')) return false;
        try {
            return (await stat(abs)).isFile();
        } catch {
            return false;
        }
    }

    /**
     * @param {string} pathname
     * @returns {Promise<{ file: string } | { redirect: string } | null>}
     */
    async function resolveAsset(pathname) {
        if (await isFile(pathname)) {
            if (!pathname.endsWith('.html')) return { file: pathname };
            const canonical = canonicalHtmlUrl(pathname);
            return canonical === pathname ? { file: pathname } : { redirect: canonical };
        }
        const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
        for (const candidate of [`${base}.html`, `${base}/index.html`]) {
            if (!(await isFile(candidate))) continue;
            const canonical = canonicalHtmlUrl(candidate);
            return canonical === pathname ? { file: candidate } : { redirect: canonical };
        }
        return null;
    }

    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     */
    return async function handle(req, res) {
        const { ignores, headerRules } = await config();
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        } catch {
            pathname = '/';
        }
        pathname = pathname.replace(/\/{2,}/g, '/');

        /** Les en-têtes de `_headers` s'appliquent aussi aux 404. */
        const applyRuleHeaders = () => {
            for (const rule of headerRules) {
                if (!rule.pattern.test(pathname)) continue;
                for (const [name, value] of rule.headers) res.setHeader(name, value);
            }
        };

        const relative = pathname.replace(/^\//, '');
        const hidden = CONFIG_FILES.has(pathname) || ignores.some((re) => re.test(relative));
        const found = hidden ? null : await resolveAsset(pathname);

        applyRuleHeaders();

        if (!found) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }
        if ('redirect' in found) {
            res.writeHead(307, { location: found.redirect });
            res.end();
            return;
        }

        const body = await readFile(join(root, found.file));
        const etag = `"${createHash('md5').update(body).digest('hex')}"`;
        res.setHeader('etag', etag);
        res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
        res.setHeader(
            'content-type',
            CONTENT_TYPES[extname(found.file).toLowerCase()] ?? 'application/octet-stream'
        );
        if (req.headers['if-none-match'] === etag) {
            res.writeHead(304);
            res.end();
            return;
        }
        res.writeHead(200, { 'content-length': String(body.length) });
        res.end(req.method === 'HEAD' ? undefined : body);
    };
}

/**
 * Écoute sur les deux boucles locales. `localhost` résout tantôt vers `127.0.0.1`,
 * tantôt vers `::1` selon la machine et l'ordre DNS : n'en servir qu'une seule
 * produit un `ECONNREFUSED` intermittent, exactement le symptôme qui rendait la
 * campagne e2e instable. Une pile sans IPv6 est tolérée.
 * @param {{ dir: string, port?: number, hosts?: string[] }} options
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> }>}
 */
export async function startStaticServer({ dir, port = 0, hosts = ['127.0.0.1', '::1'] }) {
    const handle = createStaticHandler(dir);
    /** @type {import('node:http').Server[]} */
    const servers = [];

    /** @param {string} host @param {number} p */
    const listen = (host, p) => {
        const server = createServer((req, res) => {
            handle(req, res).catch((err) => {
                console.error(err);
                if (!res.headersSent) res.writeHead(500);
                res.end('Internal Server Error');
            });
        });
        return new Promise((ok, ko) => {
            server.once('error', ko);
            server.listen(p, host, () => {
                servers.push(server);
                ok(/** @type {import('node:net').AddressInfo} */ (server.address()).port);
            });
        });
    };

    const close = async () => {
        await Promise.all(
            servers.map(
                (s) =>
                    new Promise((ok) => {
                        s.closeAllConnections();
                        s.close(() => ok(undefined));
                    })
            )
        );
    };

    let bound;
    try {
        bound = /** @type {number} */ (await listen(hosts[0], port));
        for (const host of hosts.slice(1)) {
            // Un hôte indisponible (pas d'IPv6, adresse déjà prise) ne doit pas
            // empêcher de servir sur les autres.
            try {
                await listen(host, bound);
            } catch (e) {
                console.warn(`Écoute impossible sur ${host} : ${e.message}`);
            }
        }
    } catch (e) {
        await close();
        throw e;
    }

    return { port: bound, url: `http://localhost:${bound}`, close };
}

// --- CLI -------------------------------------------------------------------

const invokedDirectly =
    process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    const arg = (name, fallback) => {
        const i = process.argv.indexOf(`--${name}`);
        return i === -1 ? fallback : process.argv[i + 1];
    };
    const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
    const dir = resolvePath(repoRoot, arg('dir', 'public'));
    const port = Number(arg('port', '8788'));
    const { url } = await startStaticServer({ dir, port });
    console.log(`Assets statiques servis depuis ${dir} sur ${url}`);
}
