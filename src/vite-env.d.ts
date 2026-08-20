/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Root of an API the browser cannot call directly. Setting it mounts a
   * same-origin proxy on the dev server; the connect screen reads it only to
   * know whether that route exists. See `.env.example`.
   */
  readonly VITE_API_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
