export type Action =
  | { kind: 'publish'; what: string }
  | { kind: 'branch'; name: string | undefined; what: string }

const GIT_OPTIONS_WITH_ARGUMENT = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** Quoted text is data: a commit message that says "git push" publishes nothing. */
const blankQuotes = (command: string): string =>
  command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")

const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)

function gitSubcommand(words: string[]): { sub: string | undefined; rest: string[] } {
  let i = 1
  while (i < words.length && words[i].startsWith('-')) i += GIT_OPTIONS_WITH_ARGUMENT.has(words[i]) ? 2 : 1
  return { sub: words[i], rest: words.slice(i + 1) }
}

const valueAfter = (rest: string[], flags: string[]): string | undefined => {
  const at = rest.findIndex(word => flags.includes(word))
  return at === -1 ? undefined : rest[at + 1]
}

const WRAPPERS = ['sudo', 'command', 'exec', 'time', 'env', 'nohup', 'nice', 'xargs', 'timeout']

/** Shell wrappers whose quoted argument is itself a command: their inner text is classified too. */
const INNER = /\b(?:(?:ba|z|da|k)?sh\s+-c|eval)\s+(["'])((?:(?!\1).)*)\1/g

/** Words that may precede the real command: wrappers, assignments and wrapper flags. */
function isPrefix(word: string): boolean {
  return isAssignment(word) || WRAPPERS.includes(word) || (word !== 'git' && word.startsWith('-'))
}

function aliasConfigured(words: string[]): boolean {
  return words.some((w, i) => w === '-c' && (words[i + 1] ?? '').startsWith('alias.'))
}

function classifySegment(segment: string): Action | undefined {
  const words = segment.trim().split(/\s+/).filter(Boolean)
  while (words.length > 0 && isPrefix(words[0])) words.shift()
  if (words[0] === 'git') {
    if (aliasConfigured(words)) return { kind: 'publish', what: 'git alias' }
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
  const inner = [...command.matchAll(INNER)].flatMap(match => classify(match[2]))
  return [...inner, ...blankQuotes(command)
    .split(/&&|\|\||;|\||\n|\(|\)|`|\$\(/)
    .map(classifySegment)
    .filter((action): action is Action => action !== undefined)]
}

export function verdictOf(note: string): 'PASS' | 'BLOCKED' | undefined {
  const all = [...note.matchAll(/^Publish gate:\s*(PASS|BLOCKED)\b/gm)]
  return all.length === 0 ? undefined : (all[all.length - 1][1] as 'PASS' | 'BLOCKED')
}

/** Words the person can type in chat to authorize one push on the current tree. */
const CHAT_PUSH_WORDS = new Set(['push', 'push it', 'push now'])

/**
 * True when the person's own chat message is a push approval. Only the person's
 * composer counts; messages from any other origin never authorize a push.
 */
export function chatAuthorizesPush(text: string, origin: string | undefined): boolean {
  return origin === 'composer' && CHAT_PUSH_WORDS.has(text.trim().toLowerCase())
}

/** The latest "Security: CLEAR" or "Security: BLOCKED" line in a security note. */
export function securityVerdictOf(note: string): 'CLEAR' | 'BLOCKED' | undefined {
  const all = [...note.matchAll(/^Security:\s*(CLEAR|BLOCKED)\b/gm)]
  return all.length === 0 ? undefined : (all[all.length - 1][1] as 'CLEAR' | 'BLOCKED')
}

export function splitArgs(args: string): { word: string; rest: string } {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  return space === -1 ? { word: trimmed, rest: '' } : { word: trimmed.slice(0, space), rest: trimmed.slice(space).trim() }
}


/** Map free-form /devops wording (and chat aliases like "push") onto a known subcommand. */
/**
 * Free-form chat never changes a gate or authorizes a push (rule 3). Only the
 * exact typed command does, so the only intent recognised here is an empty one.
 */
export function interpretDevopsIntent(args: string): { word: string; rest: string } | undefined {
  return args.trim() === '' ? { word: 'status', rest: '' } : undefined
}

/** The tree hash a QA note approved: the 40-hex value on a line that names the tree. */
export function treeOf(text: string): string | undefined {
  return /\btree\b[^\n0-9a-f]*([0-9a-f]{40})\b/i.exec(text)?.[1]?.toLowerCase()
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
  return blankQuotes(command).split(/&&|\|\||;|\||\n|\(|\)|`|\$\(/).map(part => part.trim()).filter(part => part !== '')
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
