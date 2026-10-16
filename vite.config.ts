import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { isAbsolute, relative, resolve } from 'node:path';

import { fetchDeepFilterNet } from './scripts/build/fetch-deepfilternet.mjs';
import { emojiDataPlugin } from './scripts/build/emoji-data-plugin.mjs';

const wasmOutput = process.env.SABLE_WASM_OUTPUT ?? 'src/generated/wasm';

export default defineConfig({
  define: {
    __SABLE_STABLE__: JSON.stringify(process.env.SABLE_BUILD_FLAVOR === 'stable'),
  },
  build: {
    sourcemap: 'hidden',
  },
  optimizeDeps: {
    exclude: ['phosphor-svelte'],
  },
  resolve: {
    alias: {
      '#src/generated/wasm': resolve(wasmOutput),
    },
  },
  worker: {
    rolldownOptions: {
      output: {
        entryFileNames: '_app/immutable/workers/[name]-[hash].js',
        chunkFileNames: '_app/immutable/workers/chunks/[hash].js',
        assetFileNames: '_app/immutable/workers/assets/[name]-[hash][extname]',
        hoistTransitiveImports: false,
      },
    },
  },
  server: {
    // Keep the frontend endpoint aligned with src-tauri/tauri.conf.json.
    port: 3000,
    strictPort: true,
    watch: {
      ignored: (path) => {
        const file = isAbsolute(path) ? relative(process.cwd(), path) : path;
        if (!file) return false;
        // A build rewrites these, and the reload it triggers cannot help anyway:
        // the SharedWorker holding the old wasm outlives it.
        if (file === 'src/generated/wasm' || file.startsWith('src/generated/wasm/')) return true;
        return file !== 'src' && !file.startsWith('src/') && file !== 'vite.config.ts';
      },
    },
  },
  plugins: [
    emojiDataPlugin(),
    {
      name: 'deepfilternet-assets',
      buildStart: async () => {
        if (!process.env.VITEST && !process.env.SABLE_SKIP_DEEPFILTERNET)
          await fetchDeepFilterNet();
      },
    },
    sentrySvelteKit({
      // The plugin detects the adapter from `svelte.config.js`, which this
      // project does not have, and does not know `adapter-static` either.
      adapter: 'other',
      autoUploadSourceMaps: false,
      release: { name: process.env.VITE_APP_VERSION },
    }),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
        experimental: { async: true },
      },

      // The web build is a client-side app served as Cloudflare Worker assets.
      // Dynamic app routes are resolved by the client after Cloudflare's SPA
      // fallback serves the root document
      paths: {
        // Cloudflare's SPA fallback may serve this document from a nested route.
        // Absolute asset URLs prevent the browser requesting `/<route>/_app/...`.
        relative: false,
      },
      prerender: {
        handleUnseenRoutes: 'ignore',
      },
      serviceWorker: {
        register: false,
      },
      adapter: adapter({
        assets: 'dist',
        pages: 'dist',
        fallback: '404.html',
      }),
      inspector: true,
    }),
  ],
});
