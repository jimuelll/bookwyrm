/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { deployHeaders } from './csp.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), deployHeaders()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
