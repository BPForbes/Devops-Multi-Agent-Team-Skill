#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInside, loadLanguages, resolveDest } from './devops-setup.mjs'
import {
  deepMerge, loadStandards, packageStandards, standardsFor, validateStandards,
} from './devops-standards.mjs'

const PROJECT_FILE = path.join('.devops', 'standards.json')
const PROJECT_SOURCE = '.devops/standards.json'
const DEFAULT_SOURCE = 'standards.json (default)'
const WRITE_OPS = ['set', 'unset', 'add', 'remove']
const FIXED_KEYS = ['schemaVersion', 'about']
const USAGE = [
  'usage: devops-config <command> [--dest DIR] [--json]',
  '  show [--language ID]          every setting in effect',
  '  get PATH [--language ID]      one setting, and whether the project or the default sets it',
  '  set PATH VALUE [--dry-run]    change a setting in .devops/standards.json',
  '  unset PATH [--dry-run]        go back to the default',
  '  add PATH VALUE [--dry-run]    add to a list (lint.exclude, magicLiterals.allowed)',
  '  remove PATH VALUE [--dry-run] remove from a list',
  '  rule RULE error|off           turn a lint rule on or off',
  'PATH is dotted (defaults.lineLength.code); write \\. for a dot inside a key.',
  'VALUE is JSON when it parses (120, true, [0,1,2]), else text.',
].join('\n')

/** A dotted setting path as keys; `\.` is a dot inside a key, as in `mccabe.max-complexity`. */
export function parsePath(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('a setting path is required, for example defaults.lineLength.code')
  }
  return text.split(/(?<!\\)\./).map(part => part.replace(/\\\./g, '.'))
}

/** A command-line value: JSON when it parses (numbers, booleans, lists, objects), else the text. */
export function parseValue(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const valueAt = (object, keys) => keys
  .reduce((node, key) => (node == null ? undefined : node[key]), object)
const isGroup = node => node !== null && typeof node === 'object'

function readProject(dest) {
  const file = path.join(dest, PROJECT_FILE)
  if (!fs.existsSync(file)) return { schemaVersion: 1 }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${PROJECT_SOURCE} is not valid JSON: ${error.message}`)
  }
}

/** Where a value comes from: the project file (also per language), or the package default. */
function sourceOf(project, keys, language) {
  if (valueAt(project, keys) !== undefined) return PROJECT_SOURCE
  if (!language || keys[0] !== 'defaults') return DEFAULT_SOURCE
  const perLanguage = ['languages', language, ...keys.slice(1)]
  const setPerLanguage = valueAt(project, perLanguage) !== undefined
  return setPerLanguage ? `${PROJECT_SOURCE} (languages.${language})` : DEFAULT_SOURCE
}

/** The settings in effect, or one of them; with `language`, `defaults` shows that language's values. */
export function getSetting(destInput, { path: dotted, language, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const standards = loadStandards(dest)
  const view = language ? { ...standards, defaults: standardsFor(standards, language) } : standards
  const keys = dotted ? parsePath(dotted) : []
  const value = valueAt(view, keys)
  if (value === undefined) throw new Error(`no setting at ${dotted}`)
  const source = keys.length > 0 ? sourceOf(readProject(dest), keys, language) : 'merged'
  return { dest, path: dotted ?? '', language: language ?? null, value, source }
}

/**
 * The group that holds the last key, created in the project file as needed. Lists are replaced
 * whole when files merge, so a path into a list copies the list in effect before changing it.
 */
function holderFor(project, effective, keys) {
  let node = project
  keys.slice(0, -1).forEach((key, i) => {
    if (node[key] === undefined) {
      const current = valueAt(effective, keys.slice(0, i + 1))
      node[key] = Array.isArray(current) ? structuredClone(current) : {}
    }
    node = node[key]
    const where = keys.slice(0, i + 1).join('.')
    if (!isGroup(node)) throw new Error(`${where} is a value, not a group of settings`)
  })
  return node
}

function listAt(holder, key, effective, keys) {
  const list = holder[key] ?? structuredClone(valueAt(effective, keys) ?? [])
  if (!Array.isArray(list)) throw new Error(`${keys.join('.')} is not a list`)
  return list
}

const OPS = {
  set: ({ holder, key, value }) => { holder[key] = value },
  unset: ({ holder, key }) => { delete holder[key] },
  add: ({ holder, key, value, effective, keys }) => {
    const list = listAt(holder, key, effective, keys)
    const present = list.some(item => JSON.stringify(item) === JSON.stringify(value))
    holder[key] = present ? list : [...list, value]
  },
  remove: ({ holder, key, value, effective, keys }) => {
    const list = listAt(holder, key, effective, keys)
    holder[key] = list.filter(item => JSON.stringify(item) !== JSON.stringify(value))
  },
}

/** Drop groups an unset left empty, so the file keeps only what the project changed. */
function prune(project, keys) {
  for (let depth = keys.length - 1; depth > 0; depth--) {
    const parent = valueAt(project, keys.slice(0, depth - 1))
    const child = parent?.[keys[depth - 1]]
    const empty = isGroup(child) && !Array.isArray(child) && Object.keys(child).length === 0
    if (empty) delete parent[keys[depth - 1]]
  }
}

function problemsWith(project, dest) {
  const languageIds = loadLanguages(dest).languages.map(l => l.id)
  const own = validateStandards(project, { languageIds, partial: true })
  if (own.length > 0) return own
  return validateStandards(deepMerge(packageStandards(), project), { languageIds })
}

function writeProject(dest, project) {
  const file = path.join(dest, PROJECT_FILE)
  assertInside(dest, file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(project, null, 2) + '\n')
  return file
}

/**
 * Change one setting in the project's .devops/standards.json: `set`, `unset` (back to the default),
 * `add` or `remove` (a list item). Plans unless `apply`; never writes a file the validator rejects.
 */
export function changeSetting(destInput, { op, path: dotted, value, apply = false, roots } = {}) {
  if (!WRITE_OPS.includes(op)) throw new Error(`op must be one of: ${WRITE_OPS.join(', ')}`)
  const dest = resolveDest(destInput, roots)
  const keys = parsePath(dotted)
  if (FIXED_KEYS.includes(keys[0])) throw new Error(`${keys[0]} cannot be changed`)
  const effective = loadStandards(dest)
  const before = readProject(dest)
  const after = structuredClone(before)
  const holder = holderFor(after, effective, keys)
  OPS[op]({ holder, key: keys.at(-1), value: parseValue(value), effective, keys })
  if (op === 'unset') prune(after, keys)
  const problems = problemsWith(after, dest)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  const written = apply && changed && problems.length === 0
  if (written) writeProject(dest, after)
  const now = valueAt(deepMerge(packageStandards(), after), keys)
  const was = valueAt(effective, keys)
  return { dest, file: PROJECT_SOURCE, op, path: dotted, was, now, changed, problems, written }
}

function describeChange(result) {
  if (result.problems.length > 0) return `refused, nothing written: ${result.problems.join('; ')}`
  if (!result.changed) return `${result.path} is unchanged; nothing to write`
  const verb = result.written ? 'written to' : 'would be written to (dry run)'
  const show = value => (value === undefined ? '(not set)' : JSON.stringify(value))
  return `${result.path}: ${show(result.was)} -> ${show(result.now)}, ${verb} ${result.file}`
}

function runCommand(command, positional, { dest, language, dryRun }) {
  if (command === 'show' || command === 'get') {
    return getSetting(dest, { path: command === 'get' ? positional[0] : undefined, language })
  }
  if (command === 'rule') {
    const [rule, level] = positional
    const change = { op: 'set', path: `lint.rules.${rule}`, value: level, apply: !dryRun }
    return changeSetting(dest, change)
  }
  if (!WRITE_OPS.includes(command)) throw new Error(USAGE)
  const [dotted, value] = positional
  return changeSetting(dest, { op: command, path: dotted, value, apply: !dryRun })
}

function main(argv) {
  const command = argv.shift()
  const flags = new Set(['--json', '--dry-run'])
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const valued = new Set(['--dest', '--language'].flatMap(name => [name, opt(name)]))
  const positional = argv.filter(a => !flags.has(a) && !valued.has(a))
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  const options = { dest, language: opt('--language'), dryRun: argv.includes('--dry-run') }
  if (!command || command === 'help') return console.log(USAGE) ?? 0
  const result = runCommand(command, positional, options)
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else if ('value' in result) {
    console.log(`${JSON.stringify(result.value, null, 2)}\n(${result.source})`)
  }
  else console.log(describeChange(result))
  return result.problems?.length > 0 ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-config: ${error.message}`)
    process.exitCode = 2
  }
}
