import type { EngineInterface, Register } from 'claude-code'

import type { Found } from '../types'
import { branchNameOf, classify, splitArgs, verdictOf } from './guard'

const PLUGIN = 'devops-multi-agent-team'
const THOUGHT_DIRS = ['.devops/thoughts/non-finalized', '.devops/thoughts/finalized']


const HELP = [
  '/devops              status: languages, gates, QA verdict',
  '/devops languages    what was detected and in which layer',
  '/devops setup        how to install the skill and profile in this project',
  '/devops push-ok      (you) allow ONE push once QA has recorded PASS',
  '/devops push-reset   (you) withdraw that permission',
  '/devops allow-branch NAME   (you) allow creating that git branch',
  '/devops gates on|off (you) turn the push and branch gates on or off',
].join('\n')

async function detect($: EngineInterface): Promise<Found[]> {
  const root = await $.session.root()
  const ran = await $.process
    .run(['node', `${$.plugin.root}/scripts/devops-setup.mjs`, 'detect', '--json', '--dest', root], { timeoutMs: 20000 })
    .catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) return []
  try {
    return JSON.parse(ran.stdout) as Found[]
  } catch {
    return []
  }
}

async function latestQaVerdict($: EngineInterface): Promise<{ verdict: 'PASS' | 'BLOCKED' | undefined; file?: string }> {
  const root = await $.session.root()
  const notes: { path: string; mtimeMs: number }[] = []
  for (const dir of THOUGHT_DIRS) {
    const entries = await $.fs.list(`${root}/${dir}`).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.startsWith('qa-') && entry.name.endsWith('.md')) {
        notes.push({ path: `${root}/${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })
      }
    }
  }
  const newest = notes.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (newest === undefined) return { verdict: undefined }
  const text = await $.fs.read(newest.path).catch(() => '')
  return { verdict: verdictOf(text), file: newest.path }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devops',
      description: 'DevOps multi-agent team: languages, gates, QA verdict',
      argumentHint: '[languages|setup|push-ok|push-reset|allow-branch NAME|gates on|off]',
    })
    const found = await detect($)
    await $.state.set({ plugin: 'devops-multi-agent-team', key: 'languages' } as const, found.map(f => f.id))
    $.ui.status(found.length === 0 ? undefined : `devops: ${found.slice(0, 4).map(f => f.id).join('+')}`)

    return next(e)
  })

  on('command.run', { command: 'devops' }, async ($, e) => {
    const { word, rest } = splitArgs(e.args)
    const isPerson = e.origin.kind === 'composer'
    const personOnly = (): { text: string } | undefined =>
      isPerson ? undefined : { text: `/devops ${word} changes a gate, so only you can run it by typing it; an agent cannot.` }

    if (word === '' || word === 'status') {
      const gates = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'gates' } as const)).value ?? true
      const authorized = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const)).value ?? false
      const branches = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
      const languages = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'languages' } as const)).value ?? []
      const qa = await latestQaVerdict($)
      return {
        text: [
          `languages: ${languages.length === 0 ? '(none detected)' : languages.join(', ')}`,
          `gates: ${gates ? 'on' : 'OFF'}`,
          `latest QA note: ${qa.verdict ?? 'none'}${qa.file ? ` (${qa.file.split('/').pop()})` : ''}`,
          `push authorized by you: ${authorized ? 'yes (one push)' : 'no'}`,
          `branches you allowed: ${branches.length === 0 ? 'none' : branches.join(', ')}`,
        ].join('\n'),
      }
    }
    if (word === 'languages') {
      const found = await detect($)
      return {
        text: found.length === 0
          ? 'No known language found. See LANGUAGES.md to add one.'
          : found.map(f => `${f.id.padEnd(14)} ${f.layers.join(',').padEnd(18)} ${f.evidence.join('; ')}`).join('\n'),
      }
    }
    if (word === 'setup') {
      return {
        text: [
          'Easiest: ask me "set up the DevOps team in this project" (MCP server devops-multi-agent-team; I plan first and write only after you agree).',
          'Or from a shell:',
          `  node ${$.plugin.root}/scripts/devops-setup.mjs install --dest . --target claude`,
          'Add --target cursor or both for Cursor; --dry-run to preview; --lang rust,typescript to choose.',
          'Then fill in the "Fill in by hand" section of .devops/project.md and commit it.',
        ].join('\n'),
      }
    }
    if (word === 'push-ok') {
      const refused = personOnly()
      if (refused) return refused
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, true)
      return { text: 'One push is allowed once the latest QA note says "Publish gate: PASS". It is consumed by that push.' }
    }
    if (word === 'push-reset') {
      const refused = personOnly()
      if (refused) return refused
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, false)
      return { text: 'Push permission withdrawn.' }
    }
    if (word === 'allow-branch') {
      const refused = personOnly()
      if (refused) return refused
      const name = branchNameOf(rest)
      if (name === undefined) return { text: 'Usage: /devops allow-branch NAME (letters, digits, . _ / -).' }
      const current = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const, [...new Set([...current, name])])
      return { text: `Creating the git branch "${name}" is allowed.` }
    }
    if (word === 'gates') {
      const refused = personOnly()
      if (refused) return refused
      if (rest !== 'on' && rest !== 'off') return { text: 'Usage: /devops gates on|off' }
      await $.state.set({ plugin: 'devops-multi-agent-team', key: 'gates' } as const, rest === 'on')
      return { text: `Gates ${rest}.` }
    }
    return { text: HELP }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (((await $.state.get({ plugin: 'devops-multi-agent-team', key: 'gates' } as const)).value ?? true) === false) return next(e)
    const actions = classify(e.command)
    if (actions.length === 0) return next(e)

    for (const action of actions) {
      if (action.kind === 'branch') {
        const allowed = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'allowedBranches' } as const)).value ?? []
        if (action.name !== undefined && allowed.includes(action.name)) continue
        return {
          deny: `${PLUGIN}: ${action.what}${action.name ? ` ${action.name}` : ''} is refused. Stay on the current branch and use a detached worktree (git worktree add --detach) for side work; the person can allow a branch with /devops allow-branch NAME.`,
        }
      }
    }
    if (!actions.some(action => action.kind === 'publish')) return next(e)

    const authorized = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const)).value ?? false
    const qa = await latestQaVerdict($)
    if (qa.verdict !== 'PASS') {
      return { deny: `${PLUGIN}: ${actions.find(a => a.kind === 'publish')?.what} is refused. Only QA may give the OK to push: no qa-*.md note under .devops/thoughts says "Publish gate: PASS" (latest: ${qa.verdict ?? 'none'}).` }
    }
    if (!authorized) {
      return { deny: `${PLUGIN}: QA recorded PASS, but the person has not authorized a push. Ask them to type /devops push-ok.` }
    }
    const ran = await next(e)
    if (ran.deny === undefined) await $.state.set({ plugin: 'devops-multi-agent-team', key: 'pushAuthorized' } as const, false)
    return ran
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: its gate failed to evaluate, so ${e.command.slice(0, 60)} is refused.` },
  )

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const languages = (await $.state.get({ plugin: 'devops-multi-agent-team', key: 'languages' } as const)).value ?? []
    const hasProfile = await $.fs.exists(`${await $.session.root()}/.devops/project.md`).catch(() => false)
    if (languages.length === 0 && !hasProfile) return composed

    const text = [
      'The devops-multi-agent-team skill is available in this project.',
      languages.length > 0 ? `Detected languages: ${languages.join(', ')}.` : undefined,
      hasProfile
        ? 'Read .devops/project.md before planning: it lists the validation and security commands per language.'
        : 'No .devops/project.md yet: /devops setup shows how to create it.',
      'Only QA may give the OK to push; git push, gh pr create|merge and creating a git branch are refused until QA records "Publish gate: PASS" and the person runs /devops push-ok.',
    ].filter(Boolean).join(' ')

    return { sections: [...composed.sections, { id: `${PLUGIN}:context`, text, scope: 'session' as const }] }
  })
}
