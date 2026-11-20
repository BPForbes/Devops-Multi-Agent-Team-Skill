#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './devops-main.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REFERENCES = 'skills/devops-multi-agent-team/references'
/** Each installed rule file and the reference whose summary block it is generated from. */
export const RULE_SOURCES = [
  {
    rule: 'clean-code', title: 'Clean code', reference: 'clean-code.md', also: 'oop-principles.md',
  },
  { rule: 'comments', title: 'Comments and documentation', reference: 'comment-standards.md' },
]

function summaryOf(text, rule) {
  const begin = `<!-- rules:begin ${rule} -->`
  const start = text.indexOf(begin)
  const end = text.indexOf('<!-- rules:end -->', start)
  if (start === -1 || end === -1) throw new Error(`no ${begin} block`)
  return text.slice(start + begin.length, end).trim()
}

/** The rule file as generated from its reference. */
export function renderRule({ rule, title, reference, also }, root = ROOT) {
  const text = fs.readFileSync(path.join(root, REFERENCES, reference), 'utf8')
  const files = [reference, also].filter(Boolean).map(f => `\`references/${f}\``).join(' and ')
  const pointer = `Full standard: ${files} in the devops-multi-agent-team skill.`
  return `# ${title}\n\n${summaryOf(text, rule)}\n\n${pointer}\n`
}

/** Rule files that differ from what their reference generates; writes them when `write`. */
export function syncRules({ write = false, root = ROOT } = {}) {
  return RULE_SOURCES.filter(source => {
    const file = path.join(root, 'rules', `${source.rule}.md`)
    const wanted = renderRule(source, root)
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if (current === wanted) return false
    if (write) fs.writeFileSync(file, wanted)
    return true
  }).map(source => `rules/${source.rule}.md`)
}

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check')
  const changed = syncRules({ write: !check })
  if (check && changed.length > 0) {
    console.error(`out of date (run npm run rules): ${changed.join(', ')}`)
    process.exitCode = 1
  } else console.log(changed.length > 0 ? `wrote ${changed.join(', ')}` : 'rules are in sync')
}
