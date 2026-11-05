#!/usr/bin/env node
// Validates languages.json against the rules in LANGUAGES.md.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'languages.json'), 'utf8'))
const guide = fs.readFileSync(path.join(root, 'LANGUAGES.md'), 'utf8')
const problems = []
const ids = new Set()
const need = (cond, msg) => { if (!cond) problems.push(msg) }

for (const lang of config.languages) {
  const at = `language ${lang.id ?? '(no id)'}`
  need(/^[a-z][a-z0-9-]*$/.test(lang.id ?? ''), `${at}: id must be lower-case kebab`)
  need(!ids.has(lang.id), `${at}: duplicate id`)
  ids.add(lang.id)
  need(typeof lang.name === 'string' && lang.name !== '', `${at}: name`)
  need(Array.isArray(lang.layers) && lang.layers.length > 0, `${at}: layers`)
  for (const layer of lang.layers ?? []) need(layer in config.layers, `${at}: unknown layer ${layer}`)
  const d = lang.detect ?? {}
  need((d.files?.length ?? 0) + (d.extensions?.length ?? 0) + (d.paths?.length ?? 0) > 0, `${at}: detect needs files, extensions or paths`)
  need(Array.isArray(lang.validate) && lang.validate.length > 0, `${at}: validate`)
  need(lang.toolchain?.verify, `${at}: toolchain.verify`)
  need(Array.isArray(lang.toolchain?.install) && lang.toolchain.install.length > 0, `${at}: toolchain.install`)
  const s = lang.security
  need(s && 'sast' in s && Array.isArray(s.sca) && Array.isArray(s.secrets), `${at}: security needs sast, sca, secrets`)
  if (s?.sast === null) need(s.unanalysed === true, `${at}: sast null requires unanalysed: true`)
  if (s?.sast?.tool === 'codeql') need(config.codeqlLanguages.includes(s.sast.language), `${at}: unknown CodeQL language ${s.sast.language}`)
  need(new RegExp(`^#### \`${lang.id}\` `, 'm').test(guide), `${at}: no "#### \`${lang.id}\`" heading in LANGUAGES.md`)
}
for (const lang of config.languages) {
  for (const edge of lang.interactsWith ?? []) need(ids.has(edge.with), `language ${lang.id}: interactsWith unknown ${edge.with}`)
}
for (const m of guide.matchAll(/^#### `([a-z0-9-]+)` /gm)) need(ids.has(m[1]), `LANGUAGES.md heading for unknown id ${m[1]}`)

if (problems.length > 0) {
  console.error(problems.map(p => `- ${p}`).join('\n'))
  process.exit(1)
}
console.log(`languages.json ok: ${config.languages.length} languages, ${Object.keys(config.layers).length} layers`)
