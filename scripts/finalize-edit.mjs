// Vite names its output after the entry file, so the admin build lands as
// commute-edit/edit.html. Hugo serves directories by index.html, so rename it.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../irenetrampoline.github.io/static/commute-edit')
const from = path.join(outDir, 'edit.html')
const to = path.join(outDir, 'index.html')

if (!fs.existsSync(from)) {
  console.error(`finalize-edit: expected ${from} to exist after the build.`)
  process.exit(1)
}

fs.renameSync(from, to)
console.log(`finalize-edit: ${path.relative(process.cwd(), to)}`)
