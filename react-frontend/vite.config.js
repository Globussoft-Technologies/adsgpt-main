import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ESM replacement for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  }
  // server: {
  //   // Temporary — ngrok tunnel for dev demos. Remove when no longer needed.
  //   allowedHosts: ['rvb23mw0-5173.inc1.devtunnels.ms'],
  // },
});
