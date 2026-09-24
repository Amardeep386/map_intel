import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  // Only scan the app's entry for dependencies, not the reference prototype in docs/reference/
  optimizeDeps: {
    entries: ['index.html'],
  },
})
