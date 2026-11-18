#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT, loadLanguages } from './devops-setup.mjs'

const INT = 'int'
const RATIO = 'ratio'
const DEFAULTS_SHAPE = {
  lineLength: { comment: INT, code: INT },
  function: { maxLines: INT, maxNesting: INT, maxParams: INT },
  duplicates: { minLines: INT, minChars: INT },
  magicLiterals: { maxRepeats: INT },
  comments: { densityWarn: RATIO, densityBlock: RATIO, minCommentLines: INT, maxProseLines: INT },
  scan: { maxFiles: INT, maxFileBytes: INT },
}
const INTERFACE_SHAPE = { comments: { densityWarn: RATIO, densityBlock: RATIO, maxProseLines: INT } }

const TOP_LEVEL = ['schemaVersion', 'about', 'defaults', 'interface', 'languages', 'linters']

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Recursive merge: plain objects merge key by key, everything else is replaced by the override. */
export function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) out[key] = key in base ? deepMerge(base[key], value) : value
  return out
}

/** Problems with `value` against `shape`; `partial` allows any subset of the shape's keys. */
function checkShape(value, shape, where, partial, problems) {
  if (!isObject(value)) return problems.push(`${where} must be an object`)
  for (const [key, child] of Object.entries(value)) {
    const at = `${where}.${key}`
    if (!(key in shape)) { problems.push(`${at} is not a known setting`); continue }
    if (typeof shape[key] === 'string') {
      const v = child
      if (shape[key] === INT && !(Number.isInteger(v) && v >= 1)) problems.push(`${at} must be a whole number of at least 1`)
      if (shape[key] === RATIO && !(typeof v === 'number' && v > 0 && v <= 1)) problems.push(`${at} must be a number above 0 and at most 1`)
    } else checkShape(child, shape[key], at, partial, problems)
  }
  if (!partial) for (const key of Object.keys(shape)) if (!(key in value)) problems.push(`${where}.${key} is missing`)
  return problems
}

/** Problems with a standards object. `partial` is true for the project file, which may set only some keys. */
export function validateStandards(standards, { languageIds = [], partial = false } = {}) {
  const problems = []
  if (!isObject(standards)) return ['standards must be a JSON object']
  if (standards.schemaVersion !== 1) problems.push('schemaVersion must be 1')
  for (const key of Object.keys(standards)) if (!TOP_LEVEL.includes(key)) problems.push(`${key} is not a known top-level key (use: ${TOP_LEVEL.join(', ')})`)
  const defaultsProblems = checkShape(standards.defaults ?? {}, DEFAULTS_SHAPE, 'defaults', partial, [])
  problems.push(...defaultsProblems)
  problems.push(...checkShape(standards.interface ?? {}, INTERFACE_SHAPE, 'interface', true, []))
  for (const [id, override] of Object.entries(standards.languages ?? {})) {
    if (languageIds.length && !languageIds.includes(id)) problems.push(`languages.${id}: unknown language id`)
    problems.push(...checkShape(override, DEFAULTS_SHAPE, `languages.${id}`, true, []))
  }
  for (const [id, linter] of Object.entries(standards.linters ?? {})) {
    if (languageIds.length && !languageIds.includes(id)) problems.push(`linters.${id}: unknown language id`)
    if (!isObject(linter) || typeof linter.tool !== 'string' || linter.tool === '') { problems.push(`linters.${id}.tool must be a name`); continue }
    if (linter.configFile !== undefined && typeof linter.configFile !== 'string') problems.push(`linters.${id}.configFile must be a file name`)
    if (!isObject(linter.options)) { problems.push(`linters.${id}.options must be an object`); continue }
    for (const [name, v] of Object.entries(linter.options)) {
      if (!(typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) problems.push(`linters.${id}.options.${name} must be a number, string or boolean`)
    }
  }
  if (!partial) {
    const merged = standards.defaults
    if (merged && merged.comments && merged.comments.densityBlock < merged.comments.densityWarn) problems.push('defaults.comments.densityBlock must be at least densityWarn')
    if (standards.interface?.comments && standards.interface.comments.densityBlock !== undefined && standards.interface.comments.densityWarn !== undefined && standards.interface.comments.densityBlock < standards.interface.comments.densityWarn) problems.push('interface.comments.densityBlock must be at least densityWarn')
  }
  return problems
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

/**
 * The project's standards: the package's standards.json, with the project's .devops/standards.json merged over it
 * key by key. Throws with every problem listed, so a bad value stops the audit instead of loosening it.
 */
export function loadStandards(dest) {
  const packageFile = path.join(PACKAGE_ROOT, 'standards.json')
  const base = readJson(packageFile)
  const projectFile = path.join(dest, '.devops', 'standards.json')
  const languageIds = loadLanguages(dest).languages.map(l => l.id)
  const baseProblems = validateStandards(base, { languageIds })
  if (baseProblems.length) throw new Error(`standards.json: ${baseProblems.join('; ')}`)
  if (!fs.existsSync(projectFile)) return base
  let override
  try { override = readJson(projectFile) } catch (error) { throw new Error(`.devops/standards.json is not valid JSON: ${error.message}`) }
  const overrideProblems = validateStandards(override, { languageIds, partial: true })
  if (overrideProblems.length) throw new Error(`.devops/standards.json: ${overrideProblems.join('; ')}`)
  const merged = deepMerge(base, override)
  const mergedProblems = validateStandards(merged, { languageIds })
  if (mergedProblems.length) throw new Error(`.devops/standards.json: ${mergedProblems.join('; ')}`)
  return merged
}

/** The settings that apply to one language: the defaults with that language's overrides on top. */
export function standardsFor(standards, languageId) {
  return deepMerge(standards.defaults, standards.languages?.[languageId] ?? {})
}

/** The limits the cleanup scan uses, under the names it has always used. `thresholds` (from a brief or a call) win. */
export function cleanupLimits(standards, languageId, thresholds = {}) {
  const s = standardsFor(standards, languageId)
  return {
    minDuplicateLines: s.duplicates.minLines,
    minDuplicateChars: s.duplicates.minChars,
    maxFunctionLines: s.function.maxLines,
    maxNesting: s.function.maxNesting,
    maxParams: s.function.maxParams,
    maxMagicLiteralRepeats: s.magicLiterals.maxRepeats,
    maxFiles: s.scan.maxFiles,
    maxFileBytes: s.scan.maxFileBytes,
    ...thresholds,
  }
}

/** The limits the comment audit uses for one language. An interface file takes the relaxed `interface` comment limits. */
export function commentLimits(standards, languageId, { isInterface = false } = {}) {
  const s = standardsFor(standards, languageId)
  const c = isInterface ? { ...s.comments, ...standards.interface.comments } : s.comments
  return {
    maxLineColumns: s.lineLength.comment,
    codeLineColumns: s.lineLength.code,
    densityWarn: c.densityWarn,
    densityBlock: c.densityBlock,
    densityMinComments: c.minCommentLines,
    longBlockLines: c.maxProseLines,
  }
}
