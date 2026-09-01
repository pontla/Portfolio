/**
 * Verifie que les hash `sha256-` du Content-Security-Policy (public/_headers)
 * correspondent bien aux scripts inline de public/index.html.
 *
 * Pourquoi : la CSP n'autorise l'inline que par hash. Toute retouche du script
 * de theme — un reformatage suffit — invalide le hash, et le navigateur bloque
 * alors le script en production sans qu'aucun test ne le voie. D'ou ce garde-fou
 * en CI, et l'exclusion de index.html dans .prettierignore.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync('public/index.html', 'utf8');
const headers = readFileSync('public/_headers', 'utf8');

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1]
);
const expected = inlineScripts.map(
    (body) => `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`
);
const declared = [...headers.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);

const missing = expected.filter((h) => !declared.includes(h));
const orphans = declared.filter((h) => !expected.includes(h));

if (missing.length || orphans.length) {
    console.error('CSP : les hash de scripts inline ne correspondent plus.\n');
    for (const [i, hash] of expected.entries()) {
        const status = declared.includes(hash) ? 'ok' : 'ABSENT de public/_headers';
        console.error(`  script inline #${i + 1} : ${hash}  [${status}]`);
    }
    for (const hash of orphans) {
        console.error(`  hash declare sans script correspondant : ${hash}`);
    }
    console.error('\nMettre a jour le script-src de public/_headers avec les hash ci-dessus.');
    process.exit(1);
}

console.log(`CSP : ${expected.length} script(s) inline, hash conformes.`);
