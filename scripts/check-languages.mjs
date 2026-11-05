#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateLanguage, validateService } from './devops-setup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const languages = JSON.parse(read('languages.json'))
const services = JSON.parse(read('services.json'))
const problems = []
const need = (cond, msg) => { if (!cond) problems.push(msg) }

const languageIds = new Set(languages.languages.map(l => l.id))
const serviceIds = new Set(services.services.map(s => s.id))
need(languageIds.size === languages.languages.length, 'duplicate language id')
need(serviceIds.size === services.services.length, 'duplicate service id')
for (const id of languageIds) need(!serviceIds.has(id), `id ${id} is both a language and a service`)

const langCtx = { layers: languages.layers, codeqlLanguages: languages.codeqlLanguages }
for (const lang of languages.languages) {
  problems.push(...validateLanguage(lang, langCtx))
  for (const edge of lang.interactsWith ?? []) need(languageIds.has(edge.with), `language ${lang.id}: interactsWith unknown ${edge.with}`)
}
const svcCtx = { categories: services.categories, serviceIds, languageIds }
for (const svc of services.services) problems.push(...validateService(svc, svcCtx))

const headings = (file, ids, label) => {
  const text = read(file)
  for (const id of ids) need(new RegExp(`^#### \`${id}\` `, 'm').test(text), `${label} ${id}: no "#### \`${id}\`" heading in ${file}`)
  for (const m of text.matchAll(/^#### `([a-z0-9-]+)` /gm)) need(ids.has(m[1]), `${file} heading for unknown id ${m[1]}`)
}
headings('LANGUAGES.md', languageIds, 'language')
headings('SERVICES.md', serviceIds, 'service')

if (problems.length > 0) {
  console.error(problems.map(p => `- ${p}`).join('\n'))
  process.exit(1)
}
console.log(`ok: ${languages.languages.length} languages, ${Object.keys(languages.layers).length} layers, ${services.services.length} services`)
