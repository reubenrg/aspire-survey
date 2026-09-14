import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

export default defineConfig(({ mode }) => {
  // The survey posts straight to Supabase from the browser, so these are baked into
  // the bundle at build time. Fail here rather than at the end of a 13-section survey.
  const env = loadEnv(mode, __dirname, 'VITE_');
  const missing = REQUIRED_ENV.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in apps/.env.local for local builds, or under Settings > ' +
        'Environment Variables in the Vercel project for deployments.',
    );
  }

  return {
    root: path.resolve(__dirname, './Aspire-Survey'),
    envDir: __dirname,
    plugins: [react()],
    build: {
      target: 'esnext',
      sourcemap: false,
      reportCompressedSize: false,
    },
    server: {
      host: '::',
      port: 8080,
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, './Aspire-Survey/src'),
      },
    },
  };
});
