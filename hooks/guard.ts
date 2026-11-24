export type Action =
  | { kind: 'publish'; what: string; problem?: string; repo?: string }
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

/** The text with quote marks and backslashes removed, so `git "pu"sh` and `p\ush` read as push. */
const unquoted = (command: string): string => command.replace(/[\\'"]/g, '')

/** `push` or `send-pack` as a word, also as `git-push` or `http-push`: what names a push to git. */
const PUSH_WORD = /(?:^|[^\w.])(?:push|send-pack)(?![\w.-])/

/** True when the text names a push (an alias body, a command), however it is quoted. */
export const namesPush = (text: string): boolean => PUSH_WORD.test(unquoted(text))

/**
 * The one push the gate lets through, typed exactly: `git push <remote> HEAD`
 * or `HEAD:<branch>`, with only flags that cannot widen what is sent (a lease
 * such as `--force-with-lease=<branch>:<sha>` only refuses a moved branch).
 */
const ALLOWED_PUSH = new RegExp('^git push(?: +(?:-u|--set-upstream|-q|--quiet|-v|--verbose'
  + '|--force-with-lease(?:=[\\w./-]+(?::[0-9a-f]{7,40})?)?))*'
  + ' +(?!HEAD )\\w[\\w.-]* +\\+?HEAD(?::(?:refs/heads/)?[\\w./-]+)?$')

const PUSH_FORM = 'type it exactly as git push <remote> HEAD[:<branch>], as a command of its own, '
  + 'with no wrapper, prefix, quoting, alias, -c option or flag that widens it'

/** Git commands that take a message, whose literal text is data when nothing else runs. */
const MESSAGE_COMMAND = /^git (?:commit|tag|notes|stash|merge|revert|cherry-pick)\s/

/**
 * Literal text the shell does not expand: here-documents quoted as <<'X'
 * (also inside the `"$(cat <<'X' … X)"` message form; `<<-` is never
 * literal, since a tab before X also ends it), single quotes, and double
 * quotes with no `$` or backtick.
 */
const LITERAL_TEXT = [
  /"\$\(cat <<'(\w+)'\n[\s\S]*?\n\1\n\)"/g,
  /<<'(\w+)'\n[\s\S]*?\n\1(?:\n|$)/g,
  /'[^']*'|"[^"\\$`]*"/g,
]

/** Shell syntax that could run a second command or change what runs. */
const SHELL_SYNTAX = /[;&|`$()<>{}!\n\\'"]/

const withoutLiteralText = (command: string): string =>
  LITERAL_TEXT.reduce((text, pattern) => text.replace(pattern, ' TEXT '), command.trim())

/**
 * True when the text is one plain command: no chain, pipe, subshell, here-doc
 * that expands, or redirection outside literal text. A push must be its own
 * command, since the check reads HEAD before the command runs.
 */
export function isSingleCommand(command: string): boolean {
  return !SHELL_SYNTAX.test(withoutLiteralText(command))
}

/**
 * Commands that only read or print and run nothing else: a push word in
 * their arguments is data. (`git grep -O`, `rg --pre`, and the diff drivers
 * of `git show` and `git diff` can run a program, so those are not here.)
 */
const READ_COMMAND = /^(?:git (?:log|status)|gh (?:api|search)|grep|echo|printf|cat)\s/

const GIT_WORD = /(?:^|[^\w.-])git(?![\w.])/

/**
 * What lets a git command read settings the check cannot see: aliases or
 * config given on the command line, a variable that points git at other
 * config, or an expansion that could spell any word.
 */
const HIDDEN_CONFIG = /(?:^|\s)(?:-c\s*alias\.|--config-env|(?:GIT_\w*|HOME|XDG_CONFIG_HOME)=)/i

const isReadOnly = (command: string): boolean =>
  READ_COMMAND.test(command.trim()) && isSingleCommand(command)

/** The reason a git command could hide a push from the check, or undefined. */
function hiddenPushProblem(command: string): string | undefined {
  const text = unquoted(command)
  if (!GIT_WORD.test(text)) return undefined
  if (HIDDEN_CONFIG.test(text)) {
    return 'a git alias or setting given on the command line can hide a push'
  }
  if (/[$`]/.test(withoutLiteralText(command))) {
    return 'a $(…), ${…}, $\'…\' or backtick expansion in a git command can spell a push'
  }
  return undefined
}

/** The push this command makes, if any: the allowed form, or a push with the reason it is refused. */
function pushAction(command: string): Action | undefined {
  const hidden = hiddenPushProblem(command)
  if (hidden !== undefined) return { kind: 'publish', what: 'git push', problem: hidden }
  if (!PUSH_WORD.test(unquoted(command)) || isReadOnly(command)) return undefined
  const trimmed = command.trim()
  const asData = MESSAGE_COMMAND.test(trimmed) && isSingleCommand(command)
  const body = withoutLiteralText(trimmed).replace(/^git stash push\b/, 'git stash')
  if (asData && !PUSH_WORD.test(unquoted(body))) return undefined
  const problem = ALLOWED_PUSH.test(trimmed) ? undefined : PUSH_FORM
  return { kind: 'publish', what: 'git push', problem }
}

/** gh's own command groups; any other first word is an alias or an extension. */
const GH_GROUPS = new Set([
  'alias', 'api', 'attestation', 'auth', 'browse', 'cache', 'codespace', 'completion', 'config',
  'extension', 'gist', 'gpg-key', 'help', 'issue', 'label', 'org', 'pr', 'project', 'release',
  'repo', 'ruleset', 'run', 'search', 'secret', 'ssh-key', 'status', 'variable', 'workflow',
])
const GH_READ_GROUPS = new Set(['browse', 'completion', 'help', 'search', 'status'])
const GH_READ_VERBS = new Set([
  'checks', 'diff', 'download', 'get', 'list', 'status', 'view', 'watch',
])

/** `gh api` flags that take a value, long and short. */
const GH_API_VALUE_FLAGS = new Set([
  '--method', '--field', '--raw-field', '--header', '--input', '--jq', '--template',
  '--preview', '--hostname', '--cache',
])
const GH_API_SHORT_VALUES = 'XFfHpqt'

/** gh api's options as [name, value] pairs, short ones by letter, and its first positional word. */
function ghApiOptions(args: string[]): { options: [string, string][]; path: string } {
  const options: [string, string][] = []
  let path = ''
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i]
    if (word.startsWith('--')) {
      const [name, attached] = word.split(/=(.*)/s)
      if (!GH_API_VALUE_FLAGS.has(name)) continue
      if (attached === undefined) i += 1
      options.push([name, attached ?? args[i] ?? ''])
    } else if (word.startsWith('-') && word.length > 1) {
      const at = [...word.slice(1)].findIndex(ch => GH_API_SHORT_VALUES.includes(ch))
      if (at === -1) continue
      const attached = word.slice(at + 2)
      if (attached === '') i += 1
      options.push([word[at + 1], attached === '' ? args[i] ?? '' : attached])
    } else if (path === '') path = word
  }
  return { options, path }
}

interface GhApiCall { methods: string[]; fields: boolean; path: string; host: boolean }

/** A `gh api` call's methods, whether it sends fields, its path, and whether it names a host. */
function parseGhApi(args: string[]): GhApiCall {
  const { options, path } = ghApiOptions(args)
  const names = options.map(([name]) => name)
  return {
    methods: options.filter(([name]) => name === 'X' || name === '--method')
      .map(([, value]) => value.toUpperCase()),
    fields: names.some(name => ['f', 'F', '--field', '--raw-field', '--input'].includes(name)),
    path,
    host: names.includes('--hostname'),
  }
}

/** A `gh api` call writes unless every method it names is GET; with none, sending fields makes it a POST. */
function isGhApiWrite(api: GhApiCall): boolean {
  return api.methods.length > 0 ? api.methods.some(m => m !== 'GET') : api.fields
}

/** gh api paths that merge or update a pull request's branch, which only the person does. */
const GH_API_MERGE = /\/pulls\/\d+\/(?:merge|update-branch)\/?$|\/merges\/?$/i

/** The reasons a gh command is refused outright, by case. */
const GH_PROBLEMS = {
  alias: 'gh aliases and extensions can run anything',
  api: 'a gh api write must name repos/<owner>/<repo>',
  merge: 'merges are the person\'s to make on GitHub',
  host: 'a gh api write goes to this checkout\'s GitHub host only',
  path: 'a gh api path may not climb with .. or encode dots or slashes',
  wrapped: 'run gh as the command itself, not through a wrapper',
}

/** gh's global flags from `words[from]`: where the command starts, and the -R/--repo it names. */
function ghFlags(words: string[], from: number): { at: number; repo: string | undefined } {
  let at = from
  let repo: string | undefined
  while (words[at]?.startsWith('-')) {
    const flag = words[at]
    const spaced = flag === '-R' || flag === '--repo'
    if (spaced) repo = words[at + 1]
    else if (/^(?:-R|--repo=)./.test(flag)) repo = flag.replace(/^(?:-R|--repo=)/, '')
    at += spaced ? 2 : 1
  }
  return { at, repo }
}

/** A `gh api` call's write, with the repository its path names, or undefined for a read. */
function ghApiAction(args: string[]): Action | undefined {
  const api = parseGhApi(args)
  if (!isGhApiWrite(api)) return undefined
  const refused = (problem: string): Action => ({ kind: 'publish', what: 'gh api', problem })
  if (api.host) return refused(GH_PROBLEMS.host)
  if (/(?:^|\/)\.\.(?:\/|$)|%2[ef]/i.test(api.path)) return refused(GH_PROBLEMS.path)
  const path = api.path.split(/[?#]/)[0].replace(/\/\.(?=\/|$)/g, '').replace(/\/{2,}/g, '/')
  if (GH_API_MERGE.test(path)) return refused(GH_PROBLEMS.merge)
  const repo = /^\/?repos\/([^/]+\/[^/]+)/.exec(path)?.[1]
  return repo === undefined ? refused(GH_PROBLEMS.api) : { kind: 'publish', what: 'gh api', repo }
}

/** The gh write at `words[at]` (the word `gh`), or undefined when it only reads. */
function ghAction(words: string[], at: number): Action | undefined {
  const { at: i, repo } = ghFlags(words, at + 1)
  const [group = '', verb = ''] = [words[i], words[i + 1]]
  if (group === '') return undefined
  const extension = group === 'alias' || group === 'extension'
  if (!GH_GROUPS.has(group) || (extension && verb !== 'list')) {
    return { kind: 'publish', what: `gh ${group}`, problem: GH_PROBLEMS.alias }
  }
  if (group === 'api') return ghApiAction(words.slice(i + 1))
  if (GH_READ_GROUPS.has(group) || GH_READ_VERBS.has(verb)) return undefined
  const what = `gh ${group} ${verb}`
  if (group === 'pr' && verb === 'merge') {
    return { kind: 'publish', what, problem: GH_PROBLEMS.merge }
  }
  return repo === undefined ? { kind: 'publish', what } : { kind: 'publish', what, repo }
}

/** gh writes, found wherever `gh` appears (after wrappers, past -R/--repo), quotes removed. */
function ghActions(command: string): Action[] {
  if (isReadOnly(command) && !command.trim().startsWith('gh ')) return []
  const words = unquoted(command).split(/[\s;&|()`{}<>]+/).filter(Boolean)
  const wrapped = !/^gh\s/.test(command.trim())
  return words.flatMap((word, at) => {
    if (word.split('/').pop() !== 'gh') return []
    const action = ghAction(words, at)
    if (action === undefined) return []
    if (!wrapped || action.kind !== 'publish') return [action]
    return [{ ...action, problem: action.problem ?? GH_PROBLEMS.wrapped }]
  })
}

const WRAPPERS = ['sudo', 'command', 'exec', 'time', 'env', 'nohup', 'nice', 'xargs', 'timeout']

/** Shell wrappers whose quoted argument is itself a command: their inner text is classified too. */
const INNER = /\b(?:(?:ba|z|da|k)?sh\s+-c|eval)\s+(["'])((?:(?!\1).)*)\1/g

/** Words that may precede the real command: wrappers, assignments and wrapper flags. */
function isPrefix(word: string): boolean {
  return isAssignment(word) || WRAPPERS.includes(word) || (word !== 'git' && word.startsWith('-'))
}

/** Git subcommands that create a branch with a flag: the flags, and how the refusal names it. */
const BRANCH_FLAGS: [string, string[], string][] = [
  ['checkout', ['-b', '-B'], 'git checkout -b'],
  ['switch', ['-c', '-C', '--create', '--force-create'], 'git switch -c'],
  ['worktree', ['-b', '-B'], 'git worktree add -b'],
]

/** A git command that creates a branch, with the name it creates. */
function branchAction(segment: string): Action | undefined {
  const words = segment.trim().split(/\s+/).filter(Boolean)
  while (words.length > 0 && isPrefix(words[0])) words.shift()
  if (words[0] !== 'git') return undefined
  const { sub, rest } = gitSubcommand(words)
  if (sub === 'branch' && rest.length > 0 && !rest[0].startsWith('-')) {
    return { kind: 'branch', name: rest[0], what: 'git branch <name>' }
  }
  for (const [name, flags, what] of BRANCH_FLAGS) {
    if (sub !== name || (name === 'worktree' && rest[0] !== 'add')) continue
    if (!rest.some(w => flags.includes(w))) continue
    return { kind: 'branch', name: valueAfter(rest, flags), what }
  }
  return undefined
}

/** What splits a shell line into separate commands. */
const SEPARATORS = /&&|\|\||;|\||&|\n|\(|\)|`|\$\(/

function branchActions(command: string): Action[] {
  const inner = [...command.matchAll(INNER)].flatMap(match => branchActions(match[2]))
  return [...inner, ...blankQuotes(command)
    .split(SEPARATORS)
    .map(branchAction)
    .filter((action): action is Action => action !== undefined)]
}

/** Every push, gh write and branch creation the command makes. */
export function classify(command: string): Action[] {
  const push = pushAction(command)
  return [...(push === undefined ? [] : [push]), ...ghActions(command), ...branchActions(command)]
}

export function verdictOf(note: string): 'PASS' | 'BLOCKED' | undefined {
  const all = [...note.matchAll(/^Publish gate:\s*(PASS|BLOCKED)\b/gm)]
  return all.length === 0 ? undefined : (all[all.length - 1][1] as 'PASS' | 'BLOCKED')
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
