import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

// Builds the admin page. The entry is edit.html, so Vite emits edit.html into the
// output directory; scripts/finalize-edit.mjs then renames it to index.html so the
// page is served at irenechen.net/commute-edit/.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: path.resolve(here, '../irenetrampoline.github.io/static/commute-edit'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(here, 'edit.html'),
    },
  },
})
