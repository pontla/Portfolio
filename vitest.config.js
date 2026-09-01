import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['**/*.test.js'],
        exclude: ['e2e/**', 'node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary', 'lcov'],
            // Le moteur (public/js/core) et le worker sont mesures explicitement :
            // sans `include`, un fichier jamais importe n'apparait pas du tout.
            include: ['public/js/**/*.js', 'worker/proxy.js'],
            exclude: ['**/*.test.js'],
        },
    },
});
