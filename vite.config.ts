import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
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
})
