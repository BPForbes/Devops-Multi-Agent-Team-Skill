import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const RELATIVE_IMPORT = /\bfrom\s+'(\.{1,2}\/[^']+)'|\bimport\(\s*'(\.{1,2}\/[^']+)'\s*\)/g

/** Every file reachable from `start` through relative imports, as paths from the package root. */
function reachable(start) {
  const seen = new Set()
  const queue = [start]
  while (queue.length > 0) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    for (const m of text.matchAll(RELATIVE_IMPORT)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] ?? m[2]))
      if (target.endsWith('.mjs') || target.endsWith('.js')) queue.push(target)
    }
  }
  return seen
}

const published = rel => PKG.files.some(entry => rel === entry || rel.startsWith(`${entry}/`))

test('every module a published command imports is in package.json files', () => {
  const entries = Object.values(PKG.bin)
  const missing = [...new Set(entries.flatMap(entry => [...reachable(entry)]))]
    .filter(rel => !published(rel))
    .sort()
  assert.deepEqual(missing, [], `add these to package.json files: ${missing.join(', ')}`)
})
