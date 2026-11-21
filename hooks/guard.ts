type Action =
  | { kind: 'publish'; what: string }
  | { kind: 'branch'; name: string | undefined; what: string }

const GIT_OPTIONS_WITH_ARGUMENT = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** Quoted text is data: a commit message that says "git push" publishes nothing. */
const blankQuotes = (command: string): string =>
  command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")

const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)

/**
 * The command's simple commands: quotes blanked, split at the shell operators,
 * each trimmed, empties dropped.
 */
const commandSegments = (command: string): string[] =>
  blankQuotes(command)
    .split(/&&|\|\||;|\||\n|\(|\)|`|\$\(/)
    .map(part => part.trim())
    .filter(part => part !== '')

function gitSubcommand(words: string[]): { sub: string | undefined; rest: string[] } {
  let i = 1
  while (i < words.length && words[i].startsWith('-')) i += GIT_OPTIONS_WITH_ARGUMENT.has(words[i]) ? 2 : 1
  return { sub: words[i], rest: words.slice(i + 1) }
}

const valueAfter = (rest: string[], flags: string[]): string | undefined => {
  const at = rest.findIndex(word => flags.includes(word))
  return at === -1 ? undefined : rest[at + 1]
}

function classifySegment(segment: string): Action | undefined {
  const words = segment.trim().split(/\s+/).filter(Boolean)
  while (words.length > 0 && (isAssignment(words[0]) || ['sudo', 'command', 'exec', 'time'].includes(words[0]))) words.shift()
  if (words[0] === 'git') {
    const { sub, rest } = gitSubcommand(words)
    if (sub === 'push') return { kind: 'publish', what: 'git push' }
    if (sub === 'checkout' && rest.some(w => w === '-b' || w === '-B')) return { kind: 'branch', name: valueAfter(rest, ['-b', '-B']), what: 'git checkout -b' }
    if (sub === 'switch' && rest.some(w => ['-c', '-C', '--create', '--force-create'].includes(w))) return { kind: 'branch', name: valueAfter(rest, ['-c', '-C', '--create', '--force-create']), what: 'git switch -c' }
    if (sub === 'worktree' && rest[0] === 'add' && rest.some(w => w === '-b' || w === '-B')) return { kind: 'branch', name: valueAfter(rest, ['-b', '-B']), what: 'git worktree add -b' }
    if (sub === 'branch' && rest.length > 0 && !rest[0].startsWith('-')) return { kind: 'branch', name: rest[0], what: 'git branch <name>' }
  }
  if (words[0] === 'gh' && words[1] === 'pr' && ['create', 'merge', 'ready', 'edit', 'close', 'reopen'].includes(words[2] ?? '')) {
    return { kind: 'publish', what: `gh pr ${words[2]}` }
  }
  if (words[0] === 'gh' && words[1] === 'release' && words[2] === 'create') return { kind: 'publish', what: 'gh release create' }
  return undefined
}

export function classify(command: string): Action[] {
  return commandSegments(command)
    .map(classifySegment)
    .filter((action): action is Action => action !== undefined)
}

export function verdictOf(note: string): 'PASS' | 'BLOCKED' | undefined {
  const all = [...note.matchAll(/^Publish gate:\s*(PASS|BLOCKED)\b/gm)]
  return all.length === 0 ? undefined : (all[all.length - 1][1] as 'PASS' | 'BLOCKED')
}

export function splitArgs(args: string): { word: string; rest: string } {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  return space === -1 ? { word: trimmed, rest: '' } : { word: trimmed.slice(0, space), rest: trimmed.slice(space).trim() }
}

const BRANCH_INTENT = /^(allow-branch|branch|cut(?:\s+a)?\s+branch)\s+/i

/** Map free-form /devops wording (and chat aliases like "push") onto a known subcommand. */
export function interpretDevopsIntent(args: string): { word: string; rest: string } | undefined {
  const trimmed = args.trim()
  if (trimmed === '') return { word: 'status', rest: '' }
  const lower = trimmed.toLowerCase()
  if (/^(push-ok|push|go|publish|ship)(?:\s|$)/.test(lower)) {
    return { word: 'push-ok', rest: '' }
  }
  if (/^(push-reset|withdraw|revoke(?:\s+push)?)(?:\s|$)/.test(lower)) {
    return { word: 'push-reset', rest: '' }
  }
  if (/^(allow-branch|branch|cut(?:\s+a)?\s+branch)\b/.test(lower)) {
    const name = branchNameOf(trimmed.replace(BRANCH_INTENT, '').trim())
    return { word: 'allow-branch', rest: name ?? '' }
  }
  if (/^gates?\s+(on|off)\b/.test(lower)) {
    return { word: 'gates', rest: lower.includes('off') ? 'off' : 'on' }
  }
  if (/^monitor\s+(on|off)\b/.test(lower)) {
    return { word: 'monitor', rest: lower.includes('off') ? 'off' : 'on' }
  }
  if (/^comments?\s+(warn|strict|off)\b/.test(lower)) {
    const mode = /warn|strict|off/.exec(lower)?.[0] ?? ''
    return { word: 'comments', rest: mode }
  }
  return undefined
}

/** Words as a shell splits them: "a b" and 'a b' stay one word, quotes removed. */
export function shellWords(text: string): string[] {
  const words = [...text.matchAll(/"(?<double>(?:[^"\\]|\\.)*)"|'(?<single>[^']*)'|(?<bare>\S+)/g)]
  return words.map(({ groups = {} }) => (groups.double !== undefined
    ? groups.double.replace(/\\(.)/g, '$1')
    : groups.single ?? groups.bare ?? ''))
}

export function branchNameOf(text: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(text) && !text.includes('..') ? text : undefined
}

export function classifySegments(command: string): string[] {
  return commandSegments(command)
}

export function commitInfo(command: string): { isCommit: boolean; stagesAll: boolean } {
  for (const segment of classifySegments(command)) {
    const words = segment.split(/\s+/).filter(Boolean)
    while (words.length > 0 && (isAssignment(words[0]) || ['sudo', 'time', 'exec'].includes(words[0]))) words.shift()
    if (words[0] !== 'git') continue
    const { sub, rest } = gitSubcommand(words)
    if (sub === 'commit') return { isCommit: true, stagesAll: rest.some(w => w === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(w)) }
  }
  return { isCommit: false, stagesAll: false }
}
