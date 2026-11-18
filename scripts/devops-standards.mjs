#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { RULE_IDS } from './devops-lint-rules.mjs'
import { PACKAGE_ROOT, loadLanguages } from './devops-setup.mjs'

const INT = 'int'
const RATIO = 'ratio'
const NUMBERS = 'numbers'
const BOOL = 'bool'
const DEFAULTS_SHAPE = {
  lineLength: { comment: INT, code: INT },
  function: { maxLines: INT, maxNesting: INT, maxParams: INT },
  duplicates: { minLines: INT, minChars: INT },
  magicLiterals: { maxRepeats: INT, allowed: NUMBERS, checkTests: BOOL },
  comments: {
    densityWarn: RATIO, densityBlock: RATIO, minCommentLines: INT, maxProseLines: INT,
  },
  scan: { maxFiles: INT, maxFileBytes: INT },
}
const INTERFACE_SHAPE = {
  comments: { densityWarn: RATIO, densityBlock: RATIO, maxProseLines: INT },
}
const LEAF_CHECKS = {
  [INT]: [v => Number.isInteger(v) && v >= 1, 'must be a whole number of at least 1'],
  [RATIO]: [
    v => typeof v === 'number' && v > 0 && v <= 1,
    'must be a number above 0 and at most 1',
  ],
  [NUMBERS]: [v => Array.isArray(v) && v.every(Number.isFinite), 'must be a list of numbers'],
  [BOOL]: [v => typeof v === 'boolean', 'must be true or false'],
}
const TOP_LEVEL = [
  'schemaVersion', 'about', 'defaults', 'interface', 'languages', 'linters', 'lint',
]
const LINTER_KEYS = ['tool', 'command', 'configFile', 'options']
const LINT_KEYS = ['rules', 'exclude', 'exemptPublic']
const LEVELS = ['error', 'off']

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isSimple = v => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
const isText = v => typeof v === 'string' && v !== ''

/** Recursive merge: plain objects merge key by key, everything else is replaced by the override. */
export function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? deepMerge(base[key], value) : value
  }
  return out
}

const unknownKeys = (value, known, where) => Object.keys(value)
  .filter(key => !known.includes(key))
  .map(key => `${where}.${key} is not a known setting`)

const missingKeys = (value, shape, where) => Object.keys(shape)
  .filter(key => !(key in value))
  .map(key => `${where}.${key} is missing`)

function checkKey(child, expected, at, mode) {
  if (expected === undefined) return [`${at} is not a known setting`]
  if (typeof expected !== 'string') return checkShape(child, expected, at, mode)
  const [ok, message] = LEAF_CHECKS[expected]
  return ok(child) ? [] : [`${at} ${message}`]
}

/** Problems with `value` against `shape`. `mode` 'complete' also requires every key of the shape. */
function checkShape(value, shape, where, mode = 'partial') {
  if (!isObject(value)) return [`${where} must be an object`]
  const problems = Object.entries(value)
    .flatMap(([key, child]) => checkKey(child, shape[key], `${where}.${key}`, mode))
  if (mode === 'complete') problems.push(...missingKeys(value, shape, where))
  return problems
}

function optionProblems(options, where) {
  if (options === undefined) return []
  if (!isObject(options)) return [`${where}.options must be an object`]
  return Object.entries(options)
    .filter(([, v]) => !isSimple(v))
    .map(([name]) => `${where}.options.${name} must be a number, string or boolean`)
}

/** Problems with one linter entry: a tool name, an optional command, config file and options. */
function linterProblems(linter, where) {
  if (!isObject(linter) || !isText(linter.tool)) return [`${where}.tool must be a name`]
  const problems = unknownKeys(linter, LINTER_KEYS, where)
  const badCommand = linter.command !== undefined && !isText(linter.command)
  if (badCommand) problems.push(`${where}.command must be a command line`)
  const badFile = linter.configFile !== undefined && typeof linter.configFile !== 'string'
  if (badFile) problems.push(`${where}.configFile must be a file name`)
  return [...problems, ...optionProblems(linter.options, where)]
}

function ruleProblems(rules) {
  if (rules === undefined) return []
  if (!isObject(rules)) return ['lint.rules must be an object']
  return Object.entries(rules).flatMap(([rule, level]) => [
    ...(RULE_IDS.includes(rule) ? [] : [`lint.rules.${rule} is not a known rule`]),
    ...(LEVELS.includes(level) ? [] : [`lint.rules.${rule} must be "error" or "off"`]),
  ])
}

/** Problems with the `lint` section: rule levels for known rule ids, and exclude globs. */
function lintProblems(lint) {
  if (lint === undefined) return []
  if (!isObject(lint)) return ['lint must be an object']
  const exclude = lint.exclude ?? []
  const validGlobs = Array.isArray(exclude) && exclude.every(isText)
  const validExempt = lint.exemptPublic === undefined || typeof lint.exemptPublic === 'boolean'
  return [
    ...unknownKeys(lint, LINT_KEYS, 'lint'),
    ...ruleProblems(lint.rules),
    ...(validGlobs ? [] : ['lint.exclude must be a list of path globs']),
    ...(validExempt ? [] : ['lint.exemptPublic must be true or false']),
  ]
}

const knownId = (id, languageIds) => languageIds.length === 0 || languageIds.includes(id)

/** Problems with the `linters` section: language ids (or `all`) and each entry, alone or in a list. */
function lintersProblems(linters, languageIds) {
  return Object.entries(linters ?? {}).flatMap(([id, entry]) => {
    const known = id === 'all' || knownId(id, languageIds)
    const unknown = known ? [] : [`linters.${id}: unknown language id`]
    if (!Array.isArray(entry)) return [...unknown, ...linterProblems(entry, `linters.${id}`)]
    const each = entry.flatMap((linter, i) => linterProblems(linter, `linters.${id}[${i}]`))
    return [...unknown, ...each]
  })
}

function languagesProblems(languages, languageIds) {
  return Object.entries(languages ?? {}).flatMap(([id, override]) => [
    ...(knownId(id, languageIds) ? [] : [`languages.${id}: unknown language id`]),
    ...checkShape(override, DEFAULTS_SHAPE, `languages.${id}`),
  ])
}

function topLevelProblems(standards) {
  const version = standards.schemaVersion === 1 ? [] : ['schemaVersion must be 1']
  const unknown = Object.keys(standards)
    .filter(key => !TOP_LEVEL.includes(key))
    .map(key => `${key} is not a known top-level key (use: ${TOP_LEVEL.join(', ')})`)
  return [...version, ...unknown]
}

/** A block limit below its warning limit, which would block before it warns. */
function densityOrder(comments, where) {
  const { densityWarn: warn, densityBlock: block } = comments ?? {}
  if (warn === undefined || block === undefined || block >= warn) return []
  return [`${where}.densityBlock must be at least densityWarn`]
}

/** Problems with a standards object. `partial` is true for the project file, which may set only some keys. */
export function validateStandards(standards, { languageIds = [], partial = false } = {}) {
  if (!isObject(standards)) return ['standards must be a JSON object']
  const mode = partial ? 'partial' : 'complete'
  const problems = [
    ...topLevelProblems(standards),
    ...checkShape(standards.defaults ?? {}, DEFAULTS_SHAPE, 'defaults', mode),
    ...checkShape(standards.interface ?? {}, INTERFACE_SHAPE, 'interface'),
    ...languagesProblems(standards.languages, languageIds),
    ...lintersProblems(standards.linters, languageIds),
    ...lintProblems(standards.lint),
  ]
  return partial ? problems : [...problems, ...orderProblems(standards)]
}

function orderProblems(standards) {
  return [
    ...densityOrder(standards.defaults?.comments, 'defaults.comments'),
    ...densityOrder(standards.interface?.comments, 'interface.comments'),
  ]
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function assertValid(problems, label) {
  if (problems.length > 0) throw new Error(`${label}: ${problems.join('; ')}`)
}

function readProjectFile(file) {
  try {
    return readJson(file)
  } catch (error) {
    throw new Error(`.devops/standards.json is not valid JSON: ${error.message}`)
  }
}

/**
 * The project's standards: the package's standards.json, with the project's .devops/standards.json merged
 * over it key by key. Throws with every problem listed, so a bad value stops the audit instead of loosening it.
 */
export function loadStandards(dest) {
  const base = readJson(path.join(PACKAGE_ROOT, 'standards.json'))
  const languageIds = loadLanguages(dest).languages.map(l => l.id)
  assertValid(validateStandards(base, { languageIds }), 'standards.json')
  const projectFile = path.join(dest, '.devops', 'standards.json')
  if (!fs.existsSync(projectFile)) return base
  const override = readProjectFile(projectFile)
  assertValid(validateStandards(override, { languageIds, partial: true }), '.devops/standards.json')
  const merged = deepMerge(base, override)
  assertValid(validateStandards(merged, { languageIds }), '.devops/standards.json')
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

/** The magic-number settings for one language: the numbers allowed in code, and whether tests are checked. */
export function magicLimits(standards, languageId) {
  const { allowed, checkTests } = standardsFor(standards, languageId).magicLiterals
  return { allowed, checkTests }
}
