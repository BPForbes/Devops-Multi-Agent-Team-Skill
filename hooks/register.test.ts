import { expect, test } from 'claude-code/testing'

const QA_DIR = '/work/.devops/thoughts/non-finalized'

/** The engine beneath the mod, for one test: a project root, (optionally) a QA note, and state in a Map. */
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
