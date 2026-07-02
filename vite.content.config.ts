import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content.tsx'),
      output: {
        entryFileNames: 'content.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'LingyiContent',
      },
    },
  },
})
