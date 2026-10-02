import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Tailwind is driven through PostCSS (postcss.config.js) on v3, not the v4
// @tailwindcss/vite plugin — the AirLytics design system is authored against v3
// (`rgb(var(--token) / <alpha-value>)` colours, tailwindcss-animate, @apply on
// custom colour utilities), so it is pinned there rather than machine-translated.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: 'es',
  },
})
