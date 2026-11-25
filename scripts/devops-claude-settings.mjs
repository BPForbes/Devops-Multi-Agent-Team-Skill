#!/usr/bin/env node
/** Read/merge/write `.claude/settings.json` for enabledPlugins and skillOverrides. */
import fs from 'node:fs'
import path from 'node:path'
import { assertInside, resolveDest } from './devops-setup.mjs'
import { isMain } from './devops-main.mjs'

export const PLUGIN_ID = 'devops-multi-agent-team@devops-multi-agent-team'
export const SETTINGS_REL = path.join('.claude', 'settings.json')
export const KNOWN_SKILLS = [
  'devops-multi-agent-team',
  'devops-cleanup',
  'project-mindmap',
]
/** Alias → skill folder name (cleanup → devops-cleanup). */
export const SKILL_ALIASES = {
  cleanup: 'devops-cleanup',
  mindmap: 'project-mindmap',
  team: 'devops-multi-agent-team',
}
export const SKILL_STATES = new Set(['on', 'name-only', 'user-invocable-only', 'off'])

const USAGE = [
  'usage: devops-claude-settings <command> [--dest DIR] [--dry-run] [--json]',
  '  show                         enabledPlugins + skillOverrides for this plugin',
  '  enable | disable             set enabledPlugins for the plugin to true|false',
  '  skill on|off NAME            set skillOverrides for one skill (bare name)',
  '  skills                       list known skills and their override (default on)',
].join('\n')

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Map `cleanup`, `devops-cleanup`, or `plugin:cleanup` to the skill folder name. */
export function normalizeSkillName(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('a skill name is required (for example devops-cleanup)')
  }
  const name = raw.trim()
  const stripped = name.replace(/^devops-multi-agent-team[/:]/, '')
  if (!/^[a-z][a-z0-9-]*$/i.test(stripped)) {
    throw new Error(`invalid skill name: ${raw}`)
  }
  if (KNOWN_SKILLS.includes(stripped)) return stripped
  if (Object.hasOwn(SKILL_ALIASES, stripped)) return SKILL_ALIASES[stripped]
  return stripped
}

function settingsPath(dest) {
  return path.join(dest, SETTINGS_REL)
}

/** Parse `.claude/settings.json`, or `{}` when the file is missing. */
export function readSettings(dest) {
  const file = settingsPath(dest)
  if (!fs.existsSync(file)) return {}
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${SETTINGS_REL} is not valid JSON: ${error.message}`)
  }
  if (!isPlainObject(parsed)) throw new Error(`${SETTINGS_REL} must be a JSON object`)
  return parsed
}

function enabledPluginProblems(map) {
  if (!isPlainObject(map)) {
    return ['enabledPlugins must be an object of plugin-id → boolean']
  }
  return Object.entries(map)
    .filter(([, value]) => typeof value !== 'boolean')
    .map(([id]) => `enabledPlugins.${id} must be true or false`)
}

function skillOverrideProblems(map) {
  if (!isPlainObject(map)) {
    return ['skillOverrides must be an object of skill-name → state']
  }
  const allowed = [...SKILL_STATES].join(', ')
  return Object.entries(map)
    .filter(([, value]) => !SKILL_STATES.has(value))
    .map(([name]) => `skillOverrides.${name} must be one of: ${allowed}`)
}

/** Structural checks for enabledPlugins and skillOverrides. */
export function validateSettings(settings) {
  if (!isPlainObject(settings)) return ['settings must be a JSON object']
  const problems = []
  if (settings.enabledPlugins !== undefined) {
    problems.push(...enabledPluginProblems(settings.enabledPlugins))
  }
  if (settings.skillOverrides !== undefined) {
    problems.push(...skillOverrideProblems(settings.skillOverrides))
  }
  return problems
}

function writeSettings(dest, settings) {
  const file = settingsPath(dest)
  assertInside(dest, file)
  const problems = validateSettings(settings)
  if (problems.length > 0) {
    throw new Error(`refused, nothing written: ${problems.join('; ')}`)
  }
  // Round-trip check before touching disk.
  JSON.parse(JSON.stringify(settings))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  return file
}

/** Snapshot of this plugin's enable flag and skill overrides. */
export function showSettings(destInput, { roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const settings = readSettings(dest)
  const enabled = settings.enabledPlugins?.[PLUGIN_ID]
  const overrides = settings.skillOverrides ?? {}
  const skills = Object.fromEntries(
    KNOWN_SKILLS.map(name => [name, overrides[name] ?? 'on']),
  )
  for (const [name, state] of Object.entries(overrides)) {
    if (!(name in skills)) skills[name] = state
  }
  return {
    dest,
    file: SETTINGS_REL,
    pluginId: PLUGIN_ID,
    enabled: enabled === undefined ? null : enabled,
    skills,
    settings,
  }
}

/**
 * Set `enabledPlugins[PLUGIN_ID]` to true (enable) or false (disable).
 * Keeps every other key in the file. Plans unless `apply`.
 */
export function setPluginEnabled(destInput, { enabled, apply = false, roots } = {}) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false')
  const dest = resolveDest(destInput, roots)
  const before = readSettings(dest)
  const after = structuredClone(before)
  after.enabledPlugins = { ...(after.enabledPlugins ?? {}), [PLUGIN_ID]: enabled }
  const problems = validateSettings(after)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  const written = apply && changed && problems.length === 0
  if (written) writeSettings(dest, after)
  return {
    dest,
    file: SETTINGS_REL,
    pluginId: PLUGIN_ID,
    enabled,
    changed,
    problems,
    written,
    settings: after,
  }
}

/**
 * Set `skillOverrides[NAME]` to on|off (or another allowed state).
 * Keys are bare skill names. Plans unless `apply`.
 */
export function setSkillOverride(destInput, {
  name: rawName, state, apply = false, roots,
} = {}) {
  const name = normalizeSkillName(rawName)
  if (!SKILL_STATES.has(state)) {
    throw new Error(`state must be one of: ${[...SKILL_STATES].join(', ')}`)
  }
  const dest = resolveDest(destInput, roots)
  const before = readSettings(dest)
  const after = structuredClone(before)
  after.skillOverrides = { ...(after.skillOverrides ?? {}), [name]: state }
  const problems = validateSettings(after)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  const written = apply && changed && problems.length === 0
  if (written) writeSettings(dest, after)
  return {
    dest,
    file: SETTINGS_REL,
    skill: name,
    state,
    changed,
    problems,
    written,
    settings: after,
  }
}

function describePlugin(result) {
  if (result.problems.length > 0) {
    return `refused, nothing written: ${result.problems.join('; ')}`
  }
  const verb = result.written
    ? 'written to'
    : result.changed
      ? 'would be written to (dry run)'
      : 'already set in'
  const flag = result.enabled ? 'enabled' : 'disabled'
  return `plugin ${result.pluginId} ${flag}, ${verb} ${result.file}`
    + (result.written || result.changed
      ? '. Reload plugins or start a new session for Claude Code to apply it.'
        + (result.enabled
          ? ''
          : ' To re-enable after unload: edit that file'
            + ` ("${PLUGIN_ID}": true), or run`
            + ` \`claude plugin enable ${PLUGIN_ID}\`.`)
      : '')
}

function describeSkill(result) {
  if (result.problems.length > 0) {
    return `refused, nothing written: ${result.problems.join('; ')}`
  }
  const verb = result.written
    ? 'written to'
    : result.changed
      ? 'would be written to (dry run)'
      : 'already set in'
  return `skillOverrides.${result.skill}=${result.state}, ${verb} ${result.file}`
    + '. Bare skill names are the documented key format.'
    + ' Claude Code ignores skillOverrides for skills loaded from a plugin;'
    + ' it applies them to project copies under .claude/skills/.'
    + ' Use /devops disable to turn the whole plugin off.'
}

function describeShow(result) {
  const flag = result.enabled === null
    ? '(not set in project settings)'
    : result.enabled
      ? 'true'
      : 'false'
  const lines = [
    `plugin ${result.pluginId}: ${flag}`,
    'skills (skillOverrides; absent = on):',
    ...Object.entries(result.skills).map(([name, state]) => `  ${name}: ${state}`),
  ]
  return lines.join('\n')
}

function runCommand(command, positional, { dest, dryRun }) {
  if (command === 'show' || command === 'skills') {
    return { kind: 'show', result: showSettings(dest) }
  }
  if (command === 'enable' || command === 'disable') {
    return {
      kind: 'plugin',
      result: setPluginEnabled(dest, {
        enabled: command === 'enable',
        apply: !dryRun,
      }),
    }
  }
  if (command === 'skill') {
    const [state, name] = positional
    if ((state !== 'on' && state !== 'off') || !name) {
      throw new Error('usage: devops-claude-settings skill on|off NAME')
    }
    return {
      kind: 'skill',
      result: setSkillOverride(dest, { name, state, apply: !dryRun }),
    }
  }
  throw new Error(USAGE)
}

function main(argv) {
  const command = argv.shift()
  const flags = new Set(['--json', '--dry-run'])
  const opt = name => {
    const i = argv.indexOf(name)
    return i === -1 ? undefined : argv[i + 1]
  }
  const valued = new Set(['--dest'].flatMap(name => [name, opt(name)]))
  const positional = argv.filter(a => !flags.has(a) && !valued.has(a))
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  const options = { dest, dryRun: argv.includes('--dry-run') }
  if (!command || command === 'help') {
    console.log(USAGE)
    return 0
  }
  const { kind, result } = runCommand(command, positional, options)
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else if (kind === 'show') {
    console.log(describeShow(result))
  } else if (kind === 'plugin') {
    console.log(describePlugin(result))
  } else {
    console.log(describeSkill(result))
  }
  return result.problems?.length > 0 ? 1 : 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-claude-settings: ${error.message}`)
    process.exitCode = 2
  }
}
