import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Vite runs from the project root, so '.' is the right place to look.
  const env = loadEnv(mode, '.', '')
  const target = env.API_PROXY?.trim()

  return {
    plugins: [react()],
    server: {
      // Bound to IPv4 on purpose. `localhost` resolves to ::1 first on Windows,
      // and a local model gateway listening only on 0.0.0.0/127.0.0.1 is then
      // invisible to the page — a connection failure that reads like CORS.
      host: '127.0.0.1',
      port: 5173,
      open: true,
      /**
       * Optional same-origin route to the model API, enabled by setting
       * `API_PROXY` (see `.env.example`). Browsers refuse a cross-origin
       * request whose preflight answers `Access-Control-Allow-Headers: *`
       * without naming `Authorization` — the wildcard deliberately does not
       * cover it — which no amount of client code can work around. Going
       * through the dev server removes the cross-origin part entirely.
       */
      ...(target
        ? {
            proxy: {
              '/proxy-api': {
                target,
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/proxy-api/, ''),
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
