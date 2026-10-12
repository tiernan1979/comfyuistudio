import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // three.js is not a bundled dependency — the browser resolves the bare
      // `three` specifier via the import map in index.html, and the loader
      // modules are fetched from unpkg at runtime. Externalizing them keeps
      // Rollup from trying to resolve them from node_modules.
      external: [/^three$/, /^https:\/\/unpkg\.com\//],
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
