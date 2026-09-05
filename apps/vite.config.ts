import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ziteId } from 'zitejs/vite-plugin';
import { insertHtml, h } from 'vite-plugin-insert-html';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const flowConfig = JSON.parse(readFileSync(path.resolve(__dirname, 'zite.config.json'), 'utf8'));
const pkgDeps = Object.keys(pkg.dependencies).filter((dependency) => dependency !== 'zitejs' && dependency !== '@tiptap/pm');
const deps = new Set([
  'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom',
  'react-dom/client', 'react-dom/server', ...pkgDeps,
]);

export default defineConfig({
  root: path.resolve(__dirname, './Aspire-Survey'),
  define: { 'import.meta.env.VITE_ZITE_FLOW_ID': JSON.stringify(flowConfig.id ?? '') },
  build: { target: 'esnext', sourcemap: false, reportCompressedSize: false },
  server: {
    host: '::',
    port: 8080,
    cors: true,
    hmr: { overlay: false },
    allowedHosts: ['.zite-sandbox.com', '.zite-dev-sandbox.com', '.zite-app.com', '.zite-dev-app.com'],
  },
  legacy: { skipWebSocketTokenCheck: true },
  optimizeDeps: {
    exclude: ['zitejs/db', 'zitejs/api', 'zitejs/auth', 'zitejs/backend', 'zitejs/integrations', 'zitejs/email'],
    include: [...deps],
    entries: ['index.html', 'src/**/*.{ts,tsx,js,jsx}'],
  },
  plugins: [
    react(),
    insertHtml({
      headPrepend: [h('script', { src: process.env.VITE_APP_RUNTIME_URL || 'https://zite.com/app-runtime.js' })],
    }),
    ziteId(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './Aspire-Survey/src'),
      'zitejs/auth/base': path.resolve(__dirname, './node_modules/zitejs/dist/esm/auth/index.js'),
      'zitejs/backend/base': path.resolve(__dirname, './node_modules/zitejs/dist/esm/backend/index.js'),
      'zitejs/db': path.resolve(__dirname, '../.Zite/db'),
      'zitejs/api': path.resolve(__dirname, './Aspire-Survey/src/zite-api.ts'),
      'zitejs/backend': path.resolve(__dirname, './Aspire-Survey/.zite/backend'),
      'zitejs/caller': path.resolve(__dirname, './node_modules/zitejs/dist/esm/caller/index.js'),
      'zitejs/integrations': path.resolve(__dirname, './Aspire-Survey/.zite/integrations/airtable.ts'),
      'zitejs/email': path.resolve(__dirname, './Aspire-Survey/.zite/integrations/email.ts'),
      '@project/components': path.resolve(__dirname, '../packages/components'),
      '@project/components/ui/sonner': path.resolve(__dirname, '../packages/sonner.tsx'),
      clsx: path.resolve(__dirname, './node_modules/clsx'),
      'tailwind-merge': path.resolve(__dirname, './node_modules/tailwind-merge'),
      'class-variance-authority': path.resolve(__dirname, './node_modules/class-variance-authority'),
      '@radix-ui/react-slot': path.resolve(__dirname, './node_modules/@radix-ui/react-slot'),
    },
  },
});