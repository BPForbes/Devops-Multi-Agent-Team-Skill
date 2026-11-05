import { expect, test } from 'claude-code/testing'

const assert = {
  ok: (value: unknown) => expect(Boolean(value)).toBe(true),
  equal: (a: unknown, b: unknown) => expect(a).toBe(b),
  deepEqual: (a: unknown, b: unknown) => expect(a).toEqual(b),
}

const QA_DIR = '/work/.devops/thoughts/non-finalized'

function engine(on: any, note: string | undefined) {
  const state = new Map<string, unknown>()
  on('state.get', (_: unknown, e: { key: string }) => ({ value: { value: state.get(e.key), version: 1 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('command.register', () => ({ value: { command: 'devops' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify([{ id: 'rust', name: 'Rust', layers: ['systems'], evidence: ['Cargo.toml'] }]), stderr: '' } }))
  on('fs.list', (_: unknown, e: { path?: string }) => ({
    value: note !== undefined && e.path === QA_DIR ? [{ name: 'qa-qa-0e0e0e.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] : [],
  }))
  on('fs.read', () => ({ value: note ?? '' }))
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

test('with PASS recorded the person still has to authorize, and the grant is consumed', async ($, on) => {
  const state = engine(on, 'Publish gate: PASS\n')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const before = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(before.isError ?? before.deny).toBeTruthy()

  state.set('pushAuthorized', true)
  const allowed = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(allowed.isError).not.toBe(true)
  expect(state.get('pushAuthorized')).toBe(false)

  const again = await $.tool.call({ tool: 'Bash', command: 'git push' })
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
