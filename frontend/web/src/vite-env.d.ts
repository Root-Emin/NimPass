/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_NIMIQ_NETWORK?: string
  readonly VITE_NIMIQ_INIT_TIMEOUT_MS?: string
  readonly VITE_NIMIQ_PAY_OPENER_BASE?: string
  readonly VITE_DEV_FIXTURES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
