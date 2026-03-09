import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Polyfill process.env for browser — some npm deps (e.g. @google/genai)
        // reference process.env internally; without this, `process` is undefined
        // in the browser and can cause silent ReferenceErrors.
        'process.env': '{}',
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
