/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The version the About section shows.
 *
 * Read from the manifest rather than duplicated in the UI, so "which build is
 * this?" cannot be answered wrongly by a string someone forgot to bump.
 */
const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
  },
  build: {
    // Worktree-local build output, per the standard repo layout.
    outDir: '.local/dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // `.tsx` as well as `.ts`: the popover's structure — which buttons, in
    // which order — is a behaviour contract, and the only honest way to assert
    // it is to render the component.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
