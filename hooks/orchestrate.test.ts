import { expect, test } from 'claude-code/testing'

import { findSection, indexOf, MAX_SECTION_CHARS, roleBrief, sectionsOf } from './brief'
import { card, standardsSummary } from './orchestrate'

const DOCS: Record<string, string> = {
  'skills/devops-multi-agent-team/SKILL.md':
    '# Team\n\nIntro.\n\n## Roles\n\nCoders and reviewers.\n',
  'skills/devops-multi-agent-team/references/lint-rules.md':
    '# Lint gate\n\nThe gate.\n\n## Two parts\n\nBuilt-in rules and open-source linters.\n\n'
    + '## Configuration\n\nlint.rules and lint.exclude.\n',
  'agents/devops-reviewer.md': '---\nname: devops-reviewer\n---\n\nRun lint_check first.\n',
  'agents/devops-coder.md': '---\nname: devops-coder\n---\n\nWrite code.\n',
}

test('a file is cut at its headings, and the index names every section', () => {
  const text = DOCS['skills/devops-multi-agent-team/references/lint-rules.md'] ?? ''
  const doc = { file: 'references/lint-rules.md', text }
  expect(sectionsOf(doc).map(s => s.heading)).toEqual(['(intro)', 'Two parts', 'Configuration'])
  expect(indexOf([doc])).toContain('references/lint-rules.md (1 KB): Two parts · Configuration')
})

test('a topic returns the one best section and names the next ones', () => {
  const docs = Object.entries(DOCS).map(([file, text]) => ({ file, text }))
  const answer = findSection(docs, 'lint configuration')
  const where = 'From skills/devops-multi-agent-team/references/lint-rules.md › Configuration'
  expect(answer.startsWith(where)).toBe(true)
  expect(answer).toContain('lint.rules and lint.exclude')
  expect(answer).not.toContain('Coders and reviewers')
  expect(findSection(docs, 'zzz nothing')).toContain('Nothing in the skill matches')
  const long = [{ file: 'big.md', text: `## Huge\n\n${'word '.repeat(MAX_SECTION_CHARS)}` }]
  const first = findSection(long, 'huge')
  const count = Number(/\(part 1 of (\d+)\)/.exec(first)?.[1])
  expect(count).toBeGreaterThan(1)
  expect(first).toContain(`call devops_brief with topic "huge" and part 2 for the rest`)
  const last = findSection(long, 'huge', count)
  expect(last).toContain(`(part ${count} of ${count})`)
  expect(last).not.toContain('call devops_brief')
  expect(findSection(long, 'huge', 999)).toContain(`(part ${count} of ${count})`)
})

test('a role returns that seat\'s brief, and an unknown one lists the roles', () => {
  const docs = Object.entries(DOCS).map(([file, text]) => ({ file, text }))
  expect(roleBrief(docs, 'reviewer')).toContain('Run lint_check first.')
  expect(roleBrief(docs, 'pilot')).toBe('No role "pilot". Roles: reviewer, coder.')
})

test('the card is short and names the tool, the gate, the profile and the standards', () => {
  const standards = standardsSummary({
    lineLength: { comment: 80, code: 100 },
    function: { maxLines: 30, maxNesting: 3, maxParams: 4 },
    magicLiterals: { allowed: [0, 1, 2] },
  })
  const state = { languages: ['rust'], hasProfile: true, gates: true, lintMode: 'warn', standards }
  const text = card(state)
  for (const part of ['devops_brief', 'Languages: rust', '.devops/project.md', 'push-ok',
    'code ≤ 100 columns', 'functions ≤ 30 lines', 'Lint on git commit: warn']) {
    expect(text).toContain(part)
  }
  expect(text.length).toBeLessThan(1200)
  const fresh = card({ languages: [], hasProfile: false, gates: true, lintMode: 'warn' })
  expect(fresh).toContain('/devops setup claude')
})

function engine(on: any) {
  const state = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: { value: state.get(e.key), version: 1 },
  }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('command.register', () => ({ value: { command: 'devops' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__devops-multi-agent-team__devops_brief' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '[]', stderr: '' } }))
  on('fs.exists', () => ({ value: false }))
  const dirOf = (file: string) => file.slice(0, file.lastIndexOf('/'))
  on('fs.list', (_: unknown, e: { path: string }) => {
    const files = Object.keys(DOCS).filter(f => e.path.endsWith(`/${dirOf(f)}`))
    const entry = (f: string) => ({
      name: f.slice(dirOf(f).length + 1), kind: 'file', size: 1, mtimeMs: 1, isLink: false,
    })
    return { value: files.map(entry) }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    const file = Object.keys(DOCS).find(f => e.path.endsWith(`/${f}`))
    return { value: file ? DOCS[file] : '' }
  })
  on('prompt.compose', () => ({ sections: [] }))
  return state
}

test('the model gets one section through devops_brief, and the card is composed', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const tool = 'mcp__devops-multi-agent-team__devops_brief'
  const brief = await $.tool.call({ tool, topic: 'two parts' })
  expect(JSON.stringify(brief.result)).toContain('open-source linters')
  const composed = await $.prompt.compose({
    model: 'claude', promptModel: 'claude', surfaces: ['terminal'], tools: [], traits: [],
    outputStyle: { name: 'default', isKeepingCodingInstructions: true },
  })
  const section = composed.sections.find(s => s.id === 'devops-multi-agent-team:context')
  expect(section?.text).toContain('devops_brief')
})

test('/devops brief and gate commands run from any origin; chat aliases map to push-ok', async ($, on) => {
  const state = engine(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({
    command: 'devops', args, origin: { kind: 'peer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  const brief = await run('brief role reviewer')
  expect(brief.text).toContain('Run lint_check first.')
  const setup = await run('setup claude')
  expect(setup.text).not.toContain('only you can run it')
  const push = await run('push')
  expect(push.text).toContain('One push is allowed')
  expect(state.get('pushAuthorized')).toBe(true)
})
