/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { deployment } from './config/deployment.js'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  if (mode !== 'test') deployment(env.VITE_NIMIQ_NETWORK, env.VITE_APP_ENV)
  if (env.NIMPASS_LOCAL_API_PROXY && env.VITE_APP_ENV === 'production') throw new Error('Local API proxy is forbidden in production.')
  const localProxy: ProxyOptions = {
    target: env.NIMPASS_LOCAL_API_PROXY,
    changeOrigin: false,
    configure(server) {
      server.on('proxyReq', (request, incoming) => {
        // Only translate same-origin local browser requests. Never translate an
        // arbitrary foreign Origin into a trusted one. Production has no proxy.
        if (env.PUBLIC_ORIGIN && incoming.headers.origin === `http://${incoming.headers.host}`) {
          request.setHeader('Origin', env.PUBLIC_ORIGIN)
        }
      })
    },
  }
  const proxy = env.NIMPASS_LOCAL_API_PROXY ? { '/api': localProxy } : undefined
  return {
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
    proxy,
  },
  preview: { host: true, proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Keep provider detection from burning the real timeout in tests.
    env: { VITE_NIMIQ_NETWORK: 'TESTNET', VITE_APP_ENV: 'test', VITE_NIMIQ_INIT_TIMEOUT_MS: '25', VITE_DEV_FIXTURES: '0' },
  },
}})
