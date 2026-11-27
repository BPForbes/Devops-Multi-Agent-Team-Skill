import { expect, test } from 'claude-code/testing'

const assert = {
  ok: (value: unknown, _message?: string) => expect(Boolean(value)).toBe(true),
  equal: (a: unknown, b: unknown) => expect(a).toBe(b),
  deepEqual: (a: unknown, b: unknown) => expect(a).toEqual(b),
}

const QA_DIR = '/work/devops-skill/thoughts/non-final'

const TREE = 'a'.repeat(40)
const PASS_NOTE = `Publish gate: PASS\ntree: ${TREE}\n`
const BLOCKED_NOTE = `Publish gate: BLOCKED\ntree: ${TREE}\n`

const CLEAR_NOTE = `Security: CLEAR\ntree: ${TREE}\n`
const SEC_FILE = '/work/devops-skill/thoughts/non-final/security-sec-0a0a0a.md'

/** The QA and security notes the fake folder holds, and what each one reads as. */
function noteFiles(on: any, note: string | undefined, security: string | undefined) {
  const entry = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })
  on('fs.list', (_: unknown, e: { path?: string }) => ({
    value: e.path === QA_DIR
      ? [
        ...(note !== undefined ? [entry('qa-qa-0e0e0e.md')] : []),
        ...(security !== undefined ? [entry('security-sec-0a0a0a.md')] : []),
      ]
      : [],
  }))
  on('fs.read', (_: unknown, e: { path?: string }) => ({
    value: e.path === SEC_FILE ? (security ?? '') : (note ?? ''),
  }))
}

/** What the fake git prints for each call; a test may replace any of them (undefined: git fails). */
const GIT_OUTPUT: Record<string, string | undefined> = {
  'rev-parse HEAD^{tree}': TREE,
  'rev-parse --show-toplevel': '/work',
  'remote get-url origin': 'https://github.com/o/r.git',
  'config --get-regexp': undefined,
}

function fakeGit(argv: string[], git: Record<string, string | undefined>) {
  const call = argv.join(' ')
  const key = Object.keys(git).find(k => call.includes(k))
    ?? Object.keys(GIT_OUTPUT).find(k => call.includes(k))
  if (key === undefined) return undefined
  const out = key in git ? git[key] : GIT_OUTPUT[key]
  if (out === undefined) return { exitCode: 1, stdout: '', stderr: '' }
  return { exitCode: 0, stdout: `${out}\n`, stderr: '' }
}

/** The fake session's notes and git output; a test sets only what it needs. */
interface Setup {
  security?: string; git?: Record<string, string | undefined>; cwd?: string | null
  runs?: string[][]
  chainRefuses?: string
  chainWaiting?: string
}

function engine(on: any, note: string | undefined, setup: Setup = {}) {
  const { security, git = {}, cwd = '/work', runs, chainRefuses, chainWaiting } = setup
  const state = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: state.get(e.key), version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => {
    if (cwd === null) throw new Error('no cwd')
    return { value: cwd }
  })
  on('command.register', () => ({ value: { command: 'devops' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__devops-multi-agent-team__devops_brief' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: { argv?: string[] }) => {
    const argv = e.argv ?? []
    runs?.push(argv)
    if (argv[0] === 'git') return { value: fakeGit(argv, git) }
    if (argv.some(a => a.endsWith('devops-chain.mjs'))) {
      const refused = chainRefuses !== undefined
      if (argv[2] === 'waiting' && chainWaiting !== undefined) {
        return { value: { exitCode: 0, stdout: `${chainWaiting}\n`, stderr: '' } }
      }
      return {
        value: {
          exitCode: refused ? 2 : 0, stdout: refused ? '' : `board: ${argv[2]}\n`,
          stderr: refused ? `devops-chain: ${chainRefuses}\n` : '',
        },
      }
    }
    if (argv.some(a => a.includes('devops-claude-settings.mjs'))) {
      const action = argv.find(a => ['enable', 'disable', 'skills', 'skill', 'show'].includes(a))
        ?? 'show'
      return {
        value: {
          exitCode: 0,
          stdout: action === 'disable' || action === 'enable'
            ? `plugin devops-multi-agent-team@devops-multi-agent-team `
              + `${action === 'enable' ? 'enabled' : 'disabled'}, written to `
              + `.claude/settings.json\n`
            : action === 'skill'
              ? 'skillOverrides.devops-cleanup=off, written to .claude/settings.json\n'
              : 'plugin devops-multi-agent-team@devops-multi-agent-team: (not set)\n'
                + 'skills (skillOverrides; absent = on):\n'
                + '  devops-multi-agent-team: on\n'
                + '  devops-cleanup: on\n'
                + '  project-mindmap: on\n',
          stderr: '',
        },
      }
    }
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify([{
          id: 'rust', name: 'Rust', layers: ['systems'], evidence: ['Cargo.toml'],
        }]),
        stderr: '',
      },
    }
  })
  noteFiles(on, note, security)
  on('fs.exists', () => ({ value: false }))
  on('tool.call', () => ({ result: {} }))
  return state
}

test('a push is refused when no QA note exists', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(state.get('languages')).toEqual(['rust'])

  const noQa = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(noQa.isError ?? noQa.deny).toBeTruthy()
})

test('a PASS on this tree and push-ok allow one push; the grant is consumed', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const before = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(before.isError ?? before.deny).toBeTruthy()

  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)

  const again = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(again.isError ?? again.deny).toBeTruthy()
})

test('branch creation is refused until the person allows that name, and reads pass', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).isError).not.toBe(true)
  const refused = await $.tool.call({ tool: 'Bash', command: 'git checkout -b topic' })
  expect(refused.isError ?? refused.deny).toBeTruthy()

  state.set('allowedBranches', ['topic'])
  expect((await $.tool.call({ tool: 'Bash', command: 'git checkout -b topic' })).isError).not.toBe(true)
})

function engineWithChecks(on: any, results: { isError: boolean }[]) {
  const state = new Map<string, unknown>()
  const written: string[] = []
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: state.get(e.key), version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (e.path.endsWith('languages.json')) return { value: JSON.stringify({ languages: [{ validate: ['cargo test --locked', 'npm run lint', 'pytest -q'] }] }) }
    if (e.path.endsWith('project.md')) return { value: 'x\n- **Default branch / integration base:** `main`; **check retry cap** for auto-correction: `2`\n' }
    if (e.path.endsWith('check-ledger.md')) return { value: written.join('') }
    throw new Error('missing')
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    written.length = 0
    written.push(e.text)
    return { value: undefined }
  })
  let call = 0
  on('tool.call', () => ({ result: {}, isError: results[Math.min(call++, results.length - 1)].isError }))
  return { state, written }
}

test('a failing check is recorded, nudges a fix, stops at the cap, and a pass clears it', async ($, on) => {
  const { state, written } = engineWithChecks(on, [{ isError: true }, { isError: true }, { isError: false }])
  const first = await $.tool.call({ tool: 'Bash', command: 'cd app && cargo test --locked' })
  assert.ok(String(first.context).includes('attempt 1 of 2'))
  assert.deepEqual(state.get('checkFailures'), { 'cargo test': 1 })

  const second = await $.tool.call({ tool: 'Bash', command: 'cargo test' })
  assert.ok(String(second.context).includes('Stop trying variations'))
  assert.ok(written[0].includes('escalated'))

  const passed = await $.tool.call({ tool: 'Bash', command: 'cargo test' })
  assert.equal(passed.context, undefined)
  assert.deepEqual(state.get('checkFailures'), {})
  assert.ok(written[0].includes('verified'))
})

test('commands that are not known checks are left alone, and the monitor can be turned off', async ($, on) => {
  const { state } = engineWithChecks(on, [{ isError: true }])
  assert.equal((await $.tool.call({ tool: 'Bash', command: 'ls -la' })).context, undefined)
  assert.equal((await $.tool.call({ tool: 'Bash', command: 'echo cargo test' })).context, undefined)
  state.set('monitor', false)
  assert.equal((await $.tool.call({ tool: 'Bash', command: 'cargo test' })).context, undefined)
  assert.equal(state.get('checkFailures'), undefined)
})

function engineWithAudit(on: any, audit: { blocking: number; nonBlocking: number; findings: { file: string; line: number; remark: string }[] }) {
  const state = new Map<string, unknown>()
  const calls: string[][] = []
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: state.get(e.key), version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => { throw new Error('missing') })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    calls.push(e.argv)
    return { value: { exitCode: audit.blocking > 0 ? 1 : 0, stdout: JSON.stringify(audit), stderr: '' } }
  })
  on('tool.call', () => ({ result: {} }))
  return { state, calls }
}

const ONE_BLOCKING = { blocking: 1, nonBlocking: 0, findings: [{ file: 'a.ts', line: 3, remark: 'issue (blocking): this restates what the code does.' }] }

test('a commit is audited: the finding is added to the result, and the staged diff is used unless -a', async ($, on) => {
  const { calls } = engineWithAudit(on, ONE_BLOCKING)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
  assert.ok(String(ran.context).includes('lint: 1 blocking'))
  assert.ok(String(ran.context).includes('a.ts:3'))
  const audits = () => calls.filter(argv => argv[0] !== 'git')
  assert.ok(audits()[0].includes('--staged'))
  await $.tool.call({ tool: 'Bash', command: 'git commit -am "x"' })
  assert.ok(!audits()[1].includes('--staged'))
})

test('strict mode refuses a commit with blocking findings; off and clean commits pass', async ($, on) => {
  const { state } = engineWithAudit(on, ONE_BLOCKING)
  state.set('commentAudit', 'strict')
  const denied = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
  assert.ok(denied.isError ?? denied.deny)
  state.set('commentAudit', 'off')
  assert.equal((await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })).context, undefined)
})

test('a clean audit adds nothing', async ($, on) => {
  engineWithAudit(on, { blocking: 0, nonBlocking: 0, findings: [] })
  assert.equal((await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })).context, undefined)
})

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }

const PACKAGE_TEXT = JSON.stringify({ text: { chatPrompt: 'DEFAULT PROMPT: use mindmap_tree.', chatNoMap: 'DEFAULT NO MAP' } })

function engineWithMindmap(on: any, overview: string | undefined, projectText?: string) {
  on('state.get', () => ({ value: { value: undefined, version: 1 } }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (overview !== undefined && e.path === '/work/.devops/mindmap/OVERVIEW.md') return { value: overview }
    if (projectText !== undefined && e.path === '/work/.devops/mindmap/text.json') return { value: projectText }
    if (e.path.endsWith('/mindmap-text.json')) return { value: PACKAGE_TEXT }
    throw new Error('missing')
  })
  on('prompt.compose', () => ({ sections: [] }))
}

test('a saved mind map overview reaches plain chat even with no DevOps profile', async ($, on) => {
  engineWithMindmap(on, '# demo: at a glance\nA demo.\n')
  const composed = await $.prompt.compose(COMPOSE)
  const section = composed.sections.find(s => s.id === 'devops-multi-agent-team:mindmap')
  assert.ok(section !== undefined)
  assert.ok(String(section?.text).includes('# demo: at a glance'))
  assert.ok(String(section?.text).includes('DEFAULT PROMPT: use mindmap_tree.'), 'the wording comes from mindmap-text.json')
  assert.ok(!String(section?.text).includes('/devops'), 'no command is needed for the mind map')
  assert.equal(composed.sections.some(s => s.id === 'devops-multi-agent-team:context'), false)
})

test('no saved mind map and no profile adds nothing to the prompt', async ($, on) => {
  engineWithMindmap(on, undefined)
  assert.equal((await $.prompt.compose(COMPOSE)).sections.length, 0)
})

test('a project\'s own wording replaces the default sentence', async ($, on) => {
  engineWithMindmap(on, '# demo\n', JSON.stringify({ text: { chatPrompt: 'Carte du projet : répondez à partir de ceci.' } }))
  const section = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'devops-multi-agent-team:mindmap')
  assert.ok(String(section?.text).startsWith('Carte du projet : répondez à partir de ceci.'))
  assert.ok(!String(section?.text).includes('DEFAULT PROMPT'))
})

test('a BLOCKED QA note yields to push-ok and records the override', async ($, on) => {
  const state = engine(on, BLOCKED_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)
  const overrides = state.get('overrides') as { rule: string; verdict: string }[]
  expect(overrides.some(row => row.rule === 'qa-pass' && row.verdict === 'BLOCKED')).toBe(true)
})

test('a GitHub write tool needs push-ok and the QA check; the grant is consumed', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const call = { tool: 'mcp__github__create_pull_request', owner: 'o', repo: 'r' }
  const first = await $.tool.call(call)
  expect(first.isError ?? first.deny).toBeTruthy()
  state.set('pushAuthorized', TREE)
  expect((await $.tool.call(call)).deny).toBeUndefined()
  expect(state.get('pushAuthorized')).toBe(false)
})

test('push-ok given for another tree does not allow this push', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', 'b'.repeat(40))
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.isError ?? refused.deny).toBeTruthy()
})

test('push-ok without a security note still pushes and records override', async ($, on) => {
  const state = engine(on, PASS_NOTE)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)
  const overrides = state.get('overrides') as { rule: string }[]
  expect(overrides.some(row => row.rule === 'security-clear')).toBe(true)
})

test('a BLOCKED security note yields to push-ok and records the override', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: `Security: BLOCKED\ntree: ${TREE}\n` })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.isError).not.toBe(true)
  const overrides = state.get('overrides') as { rule: string; verdict: string }[]
  const blocked = (row: { rule: string; verdict: string }) =>
    row.rule === 'security-clear' && row.verdict === 'BLOCKED'
  expect(overrides.some(blocked)).toBe(true)
})

test('push-ok with QA PASS for another tree still pushes and records override', async ($, on) => {
  const otherTree = `Publish gate: PASS\ntree: ${'b'.repeat(40)}\n`
  const state = engine(on, otherTree, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)
  const overrides = state.get('overrides') as { rule: string }[]
  expect(overrides.some(row => row.rule === 'qa-pass')).toBe(true)
})

test('push-ok with no QA note authorizes the push and records the override', async ($, on) => {
  const state = engine(on, undefined, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)
  const overrides = state.get('overrides') as { rule: string; verdict: string }[]
  expect(overrides.some(row => row.rule === 'qa-pass' && row.verdict === 'none')).toBe(true)
})

test('a GitHub write tool with push-ok but no QA PASS is allowed and recorded', async ($, on) => {
  const state = engine(on, undefined, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const call = { tool: 'mcp__github__create_pull_request', owner: 'o', repo: 'r' }
  expect((await $.tool.call(call)).deny).toBeUndefined()
  expect(state.get('pushAuthorized')).toBe(false)
})

test('a push chained after a step that can move HEAD is refused', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const command of [
    'git commit -am x && git push origin HEAD',
    'git reset --hard other; git push origin HEAD',
    'cd ../other && git push origin HEAD',
    'bash -c "git push origin HEAD"',
  ]) {
    state.set('pushAuthorized', TREE)
    const refused = await $.tool.call({ tool: 'Bash', command })
    expect(refused.isError ?? refused.deny).toBeTruthy()
    expect(state.get('pushAuthorized')).toBe(TREE)
  }
})

test('a push from another repository or work tree is refused', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const command of [
    'git -C ../other push origin HEAD',
    'git --git-dir=../other/.git push origin HEAD',
    'git --work-tree ../other push origin HEAD',
    'GIT_DIR=../other/.git git push origin HEAD',
  ]) {
    state.set('pushAuthorized', TREE)
    const refused = await $.tool.call({ tool: 'Bash', command })
    expect(refused.isError ?? refused.deny).toBeTruthy()
  }
})

test('a push is refused when the shell is in another checkout', async ($, on) => {
  const git = { '-C /elsewhere rev-parse --show-toplevel': '/elsewhere' }
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, git, cwd: '/elsewhere' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.deny).toContain('session\'s checkout')
  expect(state.get('pushAuthorized')).toBe(TREE)
})

test('a push is refused when a git setting would send more than HEAD', async ($, on) => {
  const git: Record<string, string | undefined> = {}
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, git })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const settings = [
    'push.followtags true', 'remote.origin.mirror true', 'push.recursesubmodules on-demand',
  ]
  for (const setting of settings) {
    git['push\\.followtags'] = setting
    const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
    expect(refused.deny).toContain('would send more than HEAD')
  }
})

test('a git alias that pushes or runs a shell is refused, whatever the command', async ($, on) => {
  const git = { '^alias': 'alias.p push --all\nalias.s !sh -c x' }
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, git })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  for (const command of ['git p origin', 'git s']) {
    const refused = await $.tool.call({ tool: 'Bash', command })
    expect(refused.deny).toContain('git alias')
  }
  expect(state.get('pushAuthorized')).toBe(TREE)
})

test('GitHub tools that write files, or name another repo, are refused even so', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  for (const tool of ['push_files', 'create_or_update_file', 'delete_file', 'merge_pull_request']) {
    const refused = await $.tool.call({ tool: `mcp__github__${tool}`, owner: 'o', repo: 'r' })
    expect(refused.deny).toContain('not the checked HEAD')
  }
  const otherRepo = { tool: 'mcp__github__create_pull_request', owner: 'x', repo: 'y' }
  const other = await $.tool.call(otherRepo)
  expect(other.deny).toContain('not this checkout\'s origin')
  expect(state.get('pushAuthorized')).toBe(TREE)
})

test('a GitHub server under another name is gated the same way', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const call = { tool: 'mcp__my-github__add_issue_comment', owner: 'o', repo: 'r' }
  expect((await $.tool.call(call)).deny).toBeTruthy()
  state.set('pushAuthorized', TREE)
  expect((await $.tool.call(call)).deny).toBeUndefined()
  expect(state.get('pushAuthorized')).toBe(false)
})

test('gates off lifts branch gate; push-ok alone still authorizes a push', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('gates', false)
  const without = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(without.deny).toBeTruthy()
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.deny).toBeUndefined()
  const branch = await $.tool.call({ tool: 'Bash', command: 'git checkout -b topic' })
  expect(branch.deny).toBeUndefined()
})

test('/devops off lifts every publish and branch check', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.deny).toBeTruthy()
  const turned = await $.command.run({
    command: 'devops', args: 'off', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(turned.text).toContain('DevOps skill off')
  expect(turned.text).toContain('disabled')
  expect(state.get('active')).toBe(false)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.deny).toBeUndefined()
  const branch = await $.tool.call({ tool: 'Bash', command: 'git checkout -b topic' })
  expect(branch.deny).toBeUndefined()
})

test('/devops disable and enable persist via settings and restore gates', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const off = await $.command.run({
    command: 'devops', args: 'disable', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(off.text).toContain('disabled')
  expect(state.get('active')).toBe(false)
  const onAgain = await $.command.run({
    command: 'devops', args: 'enable', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(onAgain.text).toContain('enabled')
  expect(state.get('active')).toBe(true)
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.deny).toBeTruthy()
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.deny).toBeUndefined()
})

test('/devops skill off and skills are person-only', async ($, on) => {
  engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const listed = await $.command.run({
    command: 'devops', args: 'skills', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(listed.text).toContain('devops-cleanup')
  const turned = await $.command.run({
    command: 'devops', args: 'skill off devops-cleanup', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(turned.text).toContain('skillOverrides')
  const refused = await $.command.run({
    command: 'devops', args: 'skill off devops-cleanup', origin: { kind: 'peer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(refused.text).toContain('only the person can run it')
})

test('/devops on restores the publish check', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('active', false)
  await $.command.run({
    command: 'devops', args: 'on', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(state.get('active')).toBe(true)
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.deny).toBeTruthy()
  state.set('pushAuthorized', TREE)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(allowed.deny).toBeUndefined()
})

test('an agent cannot turn the skill off', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const refused = await $.command.run({
    command: 'devops', args: 'off', origin: { kind: 'peer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(refused.text).toContain('only the person can run it')
  expect(state.get('active')).toBeUndefined()
})

test('status while off says the skill is OFF', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('active', false)
  const status = await $.command.run({
    command: 'devops', args: 'status', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(status.text).toContain('skill: OFF')
})

test('the status line says when the grant is for another tree', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', 'b'.repeat(40))
  const status = await $.command.run({
    command: 'devops', args: '', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(status.text).toContain('no (the grant is for another tree)')
})

test('a GitHub read passes untouched, and keeps the grant', async ($, on) => {
  const state = engine(on, undefined)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const read = await $.tool.call({ tool: 'mcp__github__pull_request_read', owner: 'x', repo: 'y' })
  expect(read.deny).toBeUndefined()
  expect(state.get('pushAuthorized')).toBe(TREE)
})

test('a gh write naming another repository is refused, and keeps the grant', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const refused = await $.tool.call({ tool: 'Bash', command: 'gh -R x/y pr create --title t' })
  expect(refused.deny).toContain('not this checkout\'s origin')
  expect(state.get('pushAuthorized')).toBe(TREE)
})

test('git aliases are matched without case and through other aliases', async ($, on) => {
  const git = { '^alias': 'alias.p push\nalias.aa bb\nalias.bb p' }
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, git })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  for (const command of ['git P origin', 'git aa origin']) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny).toContain('git alias')
  }
})

test('a push is refused when the shell\'s directory cannot be read', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, cwd: null })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.deny).toBeTruthy()
  expect(state.get('pushAuthorized')).toBe(TREE)
})

/** The devops-chain.mjs runs among the fake session's process calls, without --dest. */
const chainRuns = (runs: string[][]) => runs
  .filter(argv => argv.some(a => a.endsWith('devops-chain.mjs')))
  .map(argv => argv.slice(2, -2))

const PERSON = { command: 'devops', origin: { kind: 'composer' } }
const REPORT = 'report-abcabc'

test('the person\'s push-ok, merge-ok or done naming reports approves them', async ($, on) => {
  const runs: string[][] = []
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const word of ['push-ok', 'merge-ok', 'done']) {
    state.set('pushAuthorized', false)
    const ran = await $.command.run({ ...PERSON, args: `${word} ${REPORT}` })
    expect(ran.text).toContain('One push is allowed')
    expect(state.get('pushAuthorized')).toBe(TREE)
    expect(state.get('pushReports')).toEqual([REPORT])
  }
  const bare = await $.command.run({ ...PERSON, args: 'push-ok' })
  expect(bare.text).toContain('No merge report waits for you')
  expect(state.get('pushReports')).toEqual([])
  expect(chainRuns(runs)).toEqual([
    ['approve', REPORT], ['approve', REPORT], ['approve', REPORT], ['waiting'],
  ])
})

test('a bare push-ok is refused while merge reports wait for the person', async ($, on) => {
  const waiting = `waiting: ${REPORT} report-defdef`
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, chainWaiting: waiting })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const args of ['push-ok', 'push']) {
    const ran = await $.command.run({ ...PERSON, args })
    expect(ran.text).toContain(`No push granted: merge reports wait for you (${REPORT}`)
    expect(ran.text).toContain(`/devops push-ok ${REPORT}`)
  }
  expect(state.get('pushAuthorized')).toBe(undefined)
})

test('push-ok --risk is sent to the chain; a goal-only risk grants no push', async ($, on) => {
  const runs: string[][] = []
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const reason = 'ship the demo'
  const named = await $.command.run({
    ...PERSON, args: `push-ok ${REPORT} --risk "${reason}" --goal goal-111111`,
  })
  expect(named.text).toContain('One push is allowed')
  expect(state.get('pushAuthorized')).toBe(TREE)
  const goalOnly = await $.command.run({
    ...PERSON, args: 'push-ok --risk "missing security" --goal goal-111111',
  })
  expect(goalOnly.text).toContain('No push is granted')
  expect(chainRuns(runs)).toEqual([
    ['approve', REPORT, '--goal', 'goal-111111', '--risk', reason],
    ['approve', '--goal', 'goal-111111', '--risk', 'missing security'],
  ])
  state.set('pushAuthorized', false)
  const bare = await $.command.run({ ...PERSON, args: 'push-ok --risk' })
  expect(bare.text).toContain('a risk override needs a reason')
  expect(state.get('pushAuthorized')).toBe(false)
})

test('a seat cannot type the risk override; it is the same gate as push-ok', async ($, on) => {
  const runs: string[][] = []
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const seat = { command: 'devops', origin: { kind: 'agent' } }
  const push = await $.command.run({ ...seat, args: 'push-ok --risk "ship it"' })
  expect(push.text).toContain('only the person can run it')
  const done = await $.command.run({ ...seat, args: 'done goal-111111 --risk "ship it"' })
  expect(done.text).toContain('no push is granted')
  expect(state.get('pushAuthorized')).toBe(undefined)
  expect(chainRuns(runs)).toEqual([
    ['done', 'goal-111111', '--risk', 'ship it'],
  ])
})

test('a refused approval (a dependency not signed off) grants no push', async ($, on) => {
  const refusal = `report ${REPORT} waits on goal-222222, which is not signed off yet`
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, chainRefuses: refusal })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...PERSON, args: `push-ok ${REPORT}` })
  expect(ran.text).toContain('No push granted')
  expect(ran.text).toContain('waits on goal-222222')
  expect(state.get('pushAuthorized')).toBe(undefined)
})

test('the pushed reports are recorded with the tree when the grant is consumed', async ($, on) => {
  const runs: string[][] = []
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  state.set('pushReports', [REPORT])
  const pushed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(pushed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)
  expect(chainRuns(runs)).toEqual([['pushed', '--tree', TREE, REPORT]])
})

test('the person\'s merge-deny needs a reason, withdraws the push', async ($, on) => {
  const runs: string[][] = []
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  state.set('pushAuthorized', TREE)
  const bare = await $.command.run({ ...PERSON, args: `merge-deny ${REPORT}` })
  expect(bare.text).toContain('Usage: /devops merge-deny')
  expect(state.get('pushAuthorized')).toBe(TREE)
  const denied = await $.command.run({ ...PERSON, args: `merge-deny ${REPORT} warn instead` })
  expect(denied.text).toContain('goes back to the Business Analyst')
  expect(state.get('pushAuthorized')).toBe(false)
  expect(chainRuns(runs)).toEqual([['deny', REPORT, '--reason', 'warn instead']])
})

test('a seat typing a chain word runs its own step and grants nothing', async ($, on) => {
  const runs: string[][] = []
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const seat = { command: 'devops', origin: { kind: 'agent' } }
  const typed = [
    'merge-ok goal-111111', 'merge-deny goal-111111 no test', 'done goal-111111',
    'raise goal-111111 found in development',
  ]
  for (const args of typed) {
    const ran = await $.command.run({ ...seat, args })
    expect(ran.text).toContain('no push is granted')
  }
  expect(state.get('pushAuthorized')).toBe(undefined)
  expect(chainRuns(runs)).toEqual([
    ['merge-ok', 'goal-111111'], ['merge-deny', 'goal-111111', '--reason', 'no test'],
    ['done', 'goal-111111'], ['raise', 'goal-111111', '--reason', 'found in development'],
  ])
})

test('the person answers a bug report; a seat may not', async ($, on) => {
  const runs: string[][] = []
  engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const seatAsks = { command: 'devops', origin: { kind: 'agent' }, args: `bug ${REPORT} fine` }
  const seat = await $.command.run(seatAsks)
  expect(seat.text).toContain('only the person can run it')
  const bare = await $.command.run({ ...PERSON, args: `bug ${REPORT} fix` })
  expect(bare.text).toContain('Usage: /devops bug')
  const answers = [`bug ${REPORT} fine`, `bug ${REPORT} fix 2`, `bug ${REPORT} fix warn instead`]
  for (const args of answers) {
    await $.command.run({ ...PERSON, args })
  }
  expect(chainRuns(runs)).toEqual([
    ['bug', REPORT, 'fine'], ['bug', REPORT, 'fix', '--proposal', '2'],
    ['bug', REPORT, 'fix', '--alternative', 'warn instead'],
  ])
})

test('the person decides held work on a load report; a seat may not', async ($, on) => {
  const runs: string[][] = []
  engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const seatAsks = { command: 'devops', origin: { kind: 'agent' }, args: `load ${REPORT} approve` }
  expect((await $.command.run(seatAsks)).text).toContain('only the person can run it')
  const bare = await $.command.run({ ...PERSON, args: `load ${REPORT} maybe` })
  expect(bare.text).toContain('Usage: /devops load')
  await $.command.run({ ...PERSON, args: `load ${REPORT} approve` })
  await $.command.run({ ...PERSON, args: `load ${REPORT} decline parser first` })
  expect(chainRuns(runs)).toEqual([
    ['load', REPORT, 'approve'], ['load', REPORT, 'decline', '--reason', 'parser first'],
  ])
})

/** Git output for a session opened above its repository: /work is not one, /work/repo is. */
const ABOVE_REPO = {
  '-C /work rev-parse --show-toplevel': undefined,
  '-C /work/repo rev-parse --show-toplevel': '/work/repo',
}

test('a session above its repo grants and pushes from the shell\'s checkout', async ($, on) => {
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, git: ABOVE_REPO, cwd: '/work/repo' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const granted = await $.command.run({ ...PERSON, args: 'push-ok' })
  expect(granted.text).not.toContain('cannot be read')
  expect(state.get('pushAuthorized')).toBe(TREE)
  const pushed = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(pushed.deny).toBeUndefined()
  expect(state.get('pushAuthorized')).toBe(false)
})

test('with no checkout under the root, the refusal says to cd into it', async ($, on) => {
  const git = { ...ABOVE_REPO, '-C /elsewhere rev-parse --show-toplevel': '/elsewhere' }
  const state = engine(on, PASS_NOTE, { security: CLEAR_NOTE, git, cwd: '/elsewhere' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const granted = await $.command.run({ ...PERSON, args: 'push-ok' })
  expect(granted.text).toContain('cd into the repository')
  state.set('pushAuthorized', TREE)
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(refused.deny).toContain('cd into the repository')
})

test('a $ expansion near git is refused for the expansion, not as a push', async ($, on) => {
  engine(on, PASS_NOTE, { security: CLEAR_NOTE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const refused = await $.tool.call({ tool: 'Bash', command: 'git status; echo "exit=$?"' })
  expect(refused.deny).toContain('expansion')
  expect(refused.deny).not.toContain('run the push as a command of its own')
})

/** The devops-loop.mjs runs among the fake session's process calls, without --dest. */
const loopRuns = (runs: string[][]) => runs
  .filter(argv => argv.some(a => a.endsWith('devops-loop.mjs')))
  .map(argv => argv.slice(2, -2))

test('the person signs off the sprint loop; a seat may not', async ($, on) => {
  const runs: string[][] = []
  engine(on, PASS_NOTE, { security: CLEAR_NOTE, runs })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const seatTyped = { command: 'devops', origin: { kind: 'agent' }, args: 'satisfied' }
  const seat = await $.command.run(seatTyped)
  expect(seat.text).toContain('only the person can run it')
  await $.command.run({ ...PERSON, args: 'satisfied looks right' })
  await $.command.run({ ...PERSON, args: 'continue keep the old API --more 3' })
  expect(loopRuns(runs)).toEqual([
    ['decide', 'satisfied', '--note', 'looks right'],
    ['decide', 'continue', '--note', 'keep the old API', '--more', '3'],
  ])
})
