import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

// Builds the main page straight into the Hugo site's static/ directory, which Hugo
// mirrors verbatim to irenechen.net/commute/. emptyOutDir is off so this never
// touches the sibling commute-edit/ directory.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: path.resolve(here, '../irenetrampoline.github.io/static/commute'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(here, 'index.html'),
    },
  },
})
