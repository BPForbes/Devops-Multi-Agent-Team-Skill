import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KNOWN_SKILLS,
  PLUGIN_ID,
  normalizeSkillName,
  readSettings,
  setPluginEnabled,
  setSkillOverride,
  showSettings,
  validateSettings,
} from './devops-claude-settings.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'devops-claude-settings.mjs')
const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dmat-claude-')))
const settingsFile = dir => path.join(dir, '.claude', 'settings.json')
const readFile = dir => JSON.parse(fs.readFileSync(settingsFile(dir), 'utf8'))

test('skill names normalize to bare folder names', () => {
  assert.equal(normalizeSkillName('devops-cleanup'), 'devops-cleanup')
  assert.equal(normalizeSkillName('devops-multi-agent-team:cleanup'), 'devops-cleanup')
  assert.equal(normalizeSkillName('devops-multi-agent-team/cleanup'), 'devops-cleanup')
  assert.equal(normalizeSkillName('cleanup'), 'devops-cleanup')
  assert.throws(() => normalizeSkillName(''), /required/)
  assert.throws(() => normalizeSkillName('../x'), /invalid/)
})

test('validateSettings rejects bad shapes', () => {
  assert.deepEqual(validateSettings({}), [])
  assert.match(validateSettings([])[0], /object/)
  assert.match(validateSettings({ enabledPlugins: { [PLUGIN_ID]: 'no' } })[0], /true or false/)
  assert.match(validateSettings({ skillOverrides: { a: 'maybe' } })[0], /must be one of/)
})

test('disable and enable merge into existing settings without dropping keys', () => {
  const dir = project()
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  fs.writeFileSync(settingsFile(dir), JSON.stringify({
    permissions: { allow: ['Bash'] },
    enabledPlugins: { 'other@market': true },
  }, null, 2))

  const plan = setPluginEnabled(dir, { enabled: false })
  assert.equal(plan.written, false)
  assert.equal(plan.changed, true)
  assert.equal(readFile(dir).enabledPlugins[PLUGIN_ID], undefined)

  const off = setPluginEnabled(dir, { enabled: false, apply: true })
  assert.equal(off.written, true)
  const afterOff = readFile(dir)
  assert.equal(afterOff.enabledPlugins[PLUGIN_ID], false)
  assert.equal(afterOff.enabledPlugins['other@market'], true)
  assert.deepEqual(afterOff.permissions, { allow: ['Bash'] })

  const on = setPluginEnabled(dir, { enabled: true, apply: true })
  assert.equal(on.written, true)
  assert.equal(readFile(dir).enabledPlugins[PLUGIN_ID], true)
  assert.deepEqual(readFile(dir).permissions, { allow: ['Bash'] })
})

test('skill on|off writes bare skillOverrides keys', () => {
  const dir = project()
  const off = setSkillOverride(dir, {
    name: 'devops-multi-agent-team:cleanup',
    state: 'off',
    apply: true,
  })
  assert.equal(off.skill, 'devops-cleanup')
  assert.equal(readFile(dir).skillOverrides['devops-cleanup'], 'off')
  assert.equal(readFile(dir).skillOverrides['devops-multi-agent-team:cleanup'], undefined)

  const restored = setSkillOverride(dir, { name: 'devops-cleanup', state: 'on', apply: true })
  assert.equal(restored.written, true)
  assert.equal(readFile(dir).skillOverrides['devops-cleanup'], 'on')
})

test('show lists known skills and refuses invalid JSON', () => {
  const dir = project()
  const empty = showSettings(dir)
  assert.equal(empty.enabled, null)
  for (const name of KNOWN_SKILLS) assert.equal(empty.skills[name], 'on')

  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  fs.writeFileSync(settingsFile(dir), '{not-json')
  assert.throws(() => readSettings(dir), /not valid JSON/)
})

test('CLI enable, disable, skill and skills round-trip', () => {
  const dir = project()
  const run = args => execFileSync(process.execPath, [CLI, ...args, '--dest', dir], {
    encoding: 'utf8',
  })
  assert.match(run(['disable']), /disabled/)
  assert.equal(readFile(dir).enabledPlugins[PLUGIN_ID], false)
  assert.match(run(['enable']), /enabled/)
  assert.equal(readFile(dir).enabledPlugins[PLUGIN_ID], true)
  assert.match(run(['skill', 'off', 'project-mindmap']), /skillOverrides\.project-mindmap=off/)
  assert.equal(readFile(dir).skillOverrides['project-mindmap'], 'off')
  const listed = run(['skills'])
  assert.match(listed, /project-mindmap: off/)
  assert.match(listed, new RegExp(PLUGIN_ID))
})
