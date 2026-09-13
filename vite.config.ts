import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// Camera access requires a secure context. On localhost plain HTTP is fine, but a phone on
// the LAN must use HTTPS, so the dev server serves a self-signed certificate.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        debug: resolve(import.meta.dirname, 'debug.html'),
      },
    },
  },
});
