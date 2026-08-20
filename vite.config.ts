import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Same-origin path the dev proxy is mounted on, when one is configured. */
const PROXY_PATH = '/proxy-api'

export default defineConfig(({ mode }) => {
  // Vite runs from the project root, so '.' is the right place to look.
  const env = loadEnv(mode, '.', '')
  const target = env.VITE_API_PROXY?.trim()

  return {
    plugins: [react()],
    server: {
      // Bound to IPv4 on purpose. `localhost` resolves to ::1 first on Windows,
      // and an API listening only on 0.0.0.0/127.0.0.1 is then invisible to the
      // page — a connection failure that reads like CORS but is not.
      host: '127.0.0.1',
      port: 5173,
      open: true,
      /**
       * Optional same-origin route to any model API, enabled by setting
       * `VITE_API_PROXY` (see `.env.example`).
       *
       * It exists because some endpoints cannot be called from a browser at
       * all — no `Access-Control-Allow-Origin`, or a preflight answering
       * `Access-Control-Allow-Headers: *` without naming `Authorization`, which
       * the Fetch standard says does not count. No client-side code works
       * around either; removing the cross-origin part is the only fix, and it
       * belongs to no particular provider.
       *
       * The connect screen reads the same variable, so it offers the proxy only
       * when one really exists.
       */
      ...(target
        ? {
            proxy: {
              [PROXY_PATH]: {
                target,
                changeOrigin: true,
                rewrite: (path: string) => path.slice(PROXY_PATH.length),
              },
            },
          }
        : {}),
    },
    build: {
      // Keeps the render pipeline (markdown + math + highlighting) out of the
      // app chunk so it caches independently of application code.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            markdown: ['react-markdown', 'remark-gfm', 'remark-math', 'remark-breaks', 'rehype-katex'],
            highlight: ['highlight.js'],
          },
        },
      },
    },
  }
})
