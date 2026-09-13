import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// Camera access requires a secure context. On localhost plain HTTP is fine, but a phone on
// the LAN must use HTTPS, so the dev server serves a self-signed certificate by default.
// VASOSCAN_HTTP=1 serves plain HTTP (localhost-only testing, e.g. in tools that reject the cert).
const plainHttp = process.env.VASOSCAN_HTTP === '1';

export default defineConfig({
  base: process.env.VASOSCAN_BASE ?? '/',
  plugins: plainHttp ? [] : [basicSsl()],
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
