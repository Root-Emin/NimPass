/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Nimiq Pay on a phone loads the dev server over the LAN.
    // See docs/04-NIMIQ-MINI-APPS.md section 45.
    host: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Keep provider detection from burning the real timeout in tests.
    env: { VITE_NIMIQ_INIT_TIMEOUT_MS: '25' },
  },
})
