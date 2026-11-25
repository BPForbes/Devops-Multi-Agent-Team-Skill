import { shellWords, splitArgs } from './guard'

/** A /devops skill mode with an optional --mode and trailing input. */
export type SkillMode = {
  word: string
  mode: string
  rest: string
}

type ModeSpec = {
  word: string
  aliases: string[]
  modes: string[]
  defaultMode: string
  skill: string
  tools: string[]
  behavior: string[]
  command?: string
}

const STAGE_ROLES: Record<string, string> = {
  research: 'Planner, Researcher, Ticket Lead',
  implement: 'Coder (department Researcher joins)',
  review: '2–3 Reviewers (independent team hashes)',
  security: 'Security Engineer',
  qa: 'QA, CI Engineer, Verifier',
  docs: 'Documentation, Communicator',
  full: 'all pods until Security Clear + QA PASS, then notify human for push',
  loop: 'all pods until Security Clear + QA PASS, then notify human for push',
}

const SPECS: ModeSpec[] = [
  {
    word: 'help',
    aliases: ['?', 'modes'],
    modes: ['all', 'gates', 'skills', 'stage'],
    defaultMode: 'all',
    skill: 'devops command catalog',
    tools: [],
    behavior: [
      'Print the catalog for the chosen slice (all, gates, skills, or stage).',
      'Point the next action at a named mode; keep the development loop running.',
    ],
  },
  {
    word: 'question',
    aliases: ['ask', 'q'],
    modes: ['overview', 'tree', 'symbol', 'search', 'file', 'module', 'library'],
    defaultMode: 'search',
    skill: 'mindmap_* tools; project-mindmap (plain chat; no team)',
    tools: ['mindmap_overview', 'mindmap_query', 'mindmap_tree'],
    behavior: [
      'Answer from the mind map; do not spawn seats.',
      'Call the MCP tools (or scripts/devops-mindmap.mjs); keep the tree out of chat.',
      'Open files only at the line ranges the map returns.',
    ],
  },
  {
    word: 'mind-map',
    aliases: ['mindmap', 'map'],
    modes: ['overview', 'build', 'status', 'tree', 'query', 'note'],
    defaultMode: 'overview',
    skill: 'mindmap_* / devops-mindmap.mjs; Researcher owns the map in a team run',
    tools: [
      'mindmap_overview', 'mindmap_build', 'mindmap_status',
      'mindmap_tree', 'mindmap_query', 'mindmap_note',
    ],
    behavior: [
      'Use mindmap_* tools (or scripts/devops-mindmap.mjs) for every lookup.',
      'build saves only .devops/mindmap/; note plans first, apply after yes.',
      'In a /goal run, hand map facts to the Researcher brief; other seats read ranges only.',
    ],
  },
  {
    word: 'clean',
    aliases: ['cleanup', 'tidy'],
    modes: ['brief', 'scan', 'plan', 'run'],
    defaultMode: 'brief',
    skill: 'cleanup_brief / cleanup_scan + devops-cleanup skill (+ /cleanup)',
    tools: ['cleanup_brief', 'cleanup_scan', 'reuse_search'],
    behavior: [
      'Turn the statement into cleanup_brief; ask about unrecognized parts.',
      'Baseline validation green, then cleanup_scan (save); plan before edits.',
      'run: spawn cleaner seats one step at a time; Reviewers check structure only.',
      'Nobody pushes without the human go; QA PASS first unless the client orders otherwise.',
    ],
    command: 'commands/cleanup.md',
  },
  {
    word: 'goal',
    aliases: [],
    modes: ['loop', 'status', 'allocate'],
    defaultMode: 'loop',
    skill: 'devops-multi-agent-team (+ /goal)',
    tools: ['detect_project', 'status', 'mindmap_overview', 'reuse_search'],
    behavior: [
      'loop: run every stage (research→implement→review→security→qa→docs) until X.',
      'Stop the loop only when Security is Clear and QA records Publish gate: PASS.',
      'Then the Orchestrator notifies the human and waits. Do not push: ask the person to'
        + ' type /devops push-ok. A client order to push sooner wins; record what it skipped.',
      'allocate: mint team/agent hashes, write per-pod and per-agent goals, set current_job.',
      'On send-back or BLOCKED, re-enter the needed stage and continue the loop.',
    ],
    command: 'commands/goal.md',
  },
  {
    word: 'stage',
    aliases: ['ci', 'pipeline', 'cicd'],
    modes: [
      'research', 'implement', 'review', 'security', 'qa', 'docs', 'full', 'loop',
    ],
    defaultMode: 'full',
    skill: 'devops-multi-agent-team loop stage',
    tools: [
      'mindmap_overview', 'reuse_search', 'module_map', 'detect_project',
      'comment_audit', 'sandbox_plan',
    ],
    behavior: [
      'One mode: spawn only that CI/CD pod. full|loop: run all pods in order.',
      'Allocate goals first; mint team/agent hashes; set initial_job/current_job.',
      'full|loop: research→implement→review→security→qa→docs until Clear + PASS.',
      'When QA PASS and Security Clear: Orchestrator notifies the human for push;',
      'do not push yourself: ask for typed /devops push-ok. If the client orders a push or',
      'skip sooner, obey at once and record the skipped gate; never report it as passed.',
      'Seats use /devops question|mind-map|reuse|review|repro the same way humans do.',
    ],
    command: 'commands/stage.md',
  },
  {
    word: 'allocate',
    aliases: ['assign'],
    modes: ['research', 'pod', 'agent', 'job', 'board'],
    defaultMode: 'research',
    skill: 'Orchestrator researches the allocation, spins up the board, then assigns seats',
    tools: ['allocation_plan', 'board_spin_up', 'module_map', 'mindmap_query', 'reuse_search'],
    behavior: [
      'research: spawn one allocation researcher or more; split the task into streams with',
      '  files, modules, risks, unknowns and dependsOn (module_map, mindmap_query, reuse_search).',
      'research: allocation_plan shows teams and seats with reasons; then board_spin_up opens the',
      '  sprint and hands each team lead its Sprint Planning (allocation-research.md).',
      'pod: one goal file per team hash (goal-team-<hex>.md) from the parent goal.',
      'agent: one goal-agent-<hex>.md per seat with acceptance criteria for that job.',
      'job: use devops-ids free --initial JOB; set current_job; prefer initial_job match.',
      'board: update seat-registry.md and team-board.md with the allocation rows.',
      'Scripts: node scripts/devops-ids.mjs mint team|agent and free --registry …',
    ],
  },
  {
    word: 'meet',
    aliases: ['meeting', 'scrum'],
    modes: ['planning', 'daily', 'refinement', 'review', 'retro'],
    defaultMode: 'daily',
    skill: 'Scrum meetings; client (human) is supreme (client-and-agile.md, scrum-meetings.md)',
    tools: [
      'meeting_schedule', 'meeting_hold', 'goal_merge', 'goal_scan', 'goal_done',
      'goal_signoff', 'report_prepare', 'report_forward', 'report_new_approach',
    ],
    behavior: [
      'The human is the client: seat process never blocks a clear client order.',
      'Each team lead schedules (meeting_schedule) and holds (meeting_hold) its meetings.',
      'Done chain: each signer runs merge-ok then done (goal_merge, goal_done); merge-deny',
      '  with a reason reopens the goal. merge-ok pings the BA, who scans as needed',
      '  (goal_scan); a BA hold or deny blocks merge-ok on that step.',
      '  Peer → lead (another member if the lead wrote it)',
      '  → BA on the scheduled review\'s demo list → BA again while Orchestration prepares',
      '  (report_prepare) → merge report (report_forward) → client push-ok or merge-deny;',
      '  on a denial the BA files the new approach (report_new_approach).',
      'A seat types /devops merge-ok|merge-deny|done GOAL for its own step (no push);',
      '  the person types /devops push-ok REPORT... or merge-deny [REPORT...] REASON.',
      '  push-ok --risk REASON records a skipped check or dependency; it is not a pass.',
      '  A seat cannot pass --risk.',
      'Every signature item is a chain.signature envelope. The BA wraps Orchestration.',
      'A push-ok naming no report is refused while merge reports wait for the person.',
      'An unfixed reported bug is not signed: the BA\'s step is denied "bug fix needed",',
      '  the goal returns to the backlog and the coders are told (BA --override for a big',
      '  matter). Bugs found in development: raise at Daily, BA bug_report, the person',
      '  answers /devops bug, the lead makes the issue (bug_issue, filed as #<num> text).',
      'Work past a seat\'s limit (3) is held for the BA (work_decide); it may ask the',
      '  person (/devops load). Meetings read the schedule.',
      'Approval moves virtual history into real history, compressed; side branches',
      '  are deleted only after the real PR merges (devops-chain.mjs merged).',
      'Business Analyst attends planning, daily, refinement and the joint review.',
      'planning: sprint goal, backlog goals, tasks (2 h per sprint week).',
      'daily: done/today/blockers; stress and strain; lead reallocates',
      '  onto higher priority (15 m).',
      'refinement: size and order upcoming goals; BA notes objectives and cost.',
      'review: one joint Sprint Review; BA roster ahead; live demos of',
      '  features/improvements (bugs optional); new goals need objective,',
      '  acceptance, priority and owner. AI Q&A may use a short reproduction.',
      'retro: per team after the joint review; reproduce a bottleneck only when',
      '  proof is needed; last team retro closes the sprint.',
      'AI↔AI on a feature/bug: reproduce live (GUI/browser/terminal). Standup,',
      '  planning and refinement: no repro by default.',
    ],
  },
  {
    word: 'story',
    aliases: [],
    modes: ['research', 'create', 'check', 'graph'],
    defaultMode: 'research',
    skill: 'devops-multi-agent-team stories',
    tools: [
      'story_graph', 'story_new', 'story_link', 'story_check',
      'story_parse', 'story_guidance', 'module_map',
    ],
    behavior: [
      'Research organizes first; Coders write OLD then NEW; Reviewers then QA/Security.',
      'Use story_* MCP tools; keep catalog rows out of free prose.',
    ],
    command: 'commands/story.md',
  },
  {
    word: 'repro',
    aliases: ['reproduce'],
    modes: ['run'],
    defaultMode: 'run',
    skill: 'devops-multi-agent-team (+ /repro)',
    tools: ['sandbox_plan', 'check_toolchain'],
    behavior: [
      'Recreate with exact commands and exit codes; write repro-<topic>.md.',
      'Use a throwaway clone when possible; claim a cause only after the repro ran.',
    ],
    command: 'commands/repro.md',
  },
  {
    word: 'triage',
    aliases: [],
    modes: ['open'],
    defaultMode: 'open',
    skill: 'devops-multi-agent-team (+ /triage)',
    tools: ['comment_audit'],
    behavior: [
      'QA owns triage; copy triage-template.md to triage-<seat-id>.md.',
      'Handoff To: Coder; department Researcher joins the Coder who picks it up.',
    ],
    command: 'commands/triage.md',
  },
  {
    word: 'review',
    aliases: ['code-review'],
    modes: ['inspect'],
    defaultMode: 'inspect',
    skill: 'devops-multi-agent-team (+ /code-review)',
    tools: ['comment_audit', 'mindmap_query'],
    behavior: [
      'QA inspects only; confirm Push JSON; write review-<seat-id>.md.',
      'Leave product code unchanged; use the virtual PR and side-work rules.',
    ],
    command: 'commands/code-review.md',
  },
  {
    word: 'reuse',
    aliases: [],
    modes: ['search'],
    defaultMode: 'search',
    skill: 'research-and-reuse',
    tools: ['reuse_search', 'module_map', 'mindmap_query'],
    behavior: [
      'Search before writing; if a name exists, extend it and say so.',
      'Call reuse_search / mindmap_query; keep whole-tree greps out of chat.',
    ],
  },
  {
    word: 'tags',
    aliases: ['tag'],
    modes: ['history', 'plan', 'create'],
    defaultMode: 'history',
    skill: 'version-tags',
    tools: ['tag_history', 'tag_plan', 'tag_create'],
    behavior: [
      'Use tag_* tools for version history and bumps; plan before create.',
    ],
  },
]

const BY_ALIAS = new Map<string, ModeSpec>()
for (const spec of SPECS) {
  BY_ALIAS.set(spec.word, spec)
  for (const alias of spec.aliases) BY_ALIAS.set(alias, spec)
}

const MODE_FLAG = /(?:^|\s)--mode\s+(\S+)/i

/** Known gate subcommands (not skill modes). */
export const GATE_WORDS = [
  '', 'status', 'languages', 'setup', 'brief', 'push-ok', 'push-reset',
  'on', 'off', 'enable', 'disable', 'skill', 'skills',
  'allow-branch', 'comments', 'config', 'monitor', 'gates', 'merge-ok', 'merge-deny', 'done',
] as const

export function skillWords(): string[] {
  return SPECS.map(s => s.word)
}

export function isGateWord(word: string): boolean {
  return (GATE_WORDS as readonly string[]).includes(word)
}

export function isSkillWord(word: string): boolean {
  return BY_ALIAS.has(word.toLowerCase())
}

/** Pull --mode NAME from args; returns the remaining text. */
export function takeModeFlag(
  args: string,
  allowed: string[],
  fallback: string,
): { mode: string; rest: string } {
  const match = MODE_FLAG.exec(args)
  if (match === null) return { mode: fallback, rest: args.trim() }
  const wanted = match[1].toLowerCase()
  const mode = allowed.includes(wanted) ? wanted : fallback
  const rest = `${args.slice(0, match.index)} ${args.slice(match.index + match[0].length)}`
    .replace(/\s+/g, ' ')
    .trim()
  return { mode, rest }
}

/** Map a first word (or alias) onto a skill mode with optional --mode. */
export function parseSkillMode(word: string, rest: string): SkillMode | undefined {
  const spec = BY_ALIAS.get(word.toLowerCase())
  if (spec === undefined) return undefined
  const taken = takeModeFlag(rest, spec.modes, spec.defaultMode)
  return { word: spec.word, mode: taken.mode, rest: taken.rest }
}

/** Free-form phrases that mean a skill mode without the canonical word first. */
export function interpretSkillIntent(args: string): SkillMode | undefined {
  const trimmed = args.trim()
  if (trimmed === '') return undefined
  const lower = trimmed.toLowerCase()
  if (/^(how does|where is|what (is|does)|who (calls|uses)|explain)\b/.test(lower)) {
    return parseSkillMode('question', trimmed)
  }
  if (/^(map this|refresh (the )?map|build (the )?mind.?map)\b/.test(lower)) {
    return parseSkillMode('mind-map', `--mode build ${trimmed}`)
  }
  if (/^(clean\s*up|tidy|reduce comments|remove duplicates?|split (big|large) functions)\b/
    .test(lower)) {
    return parseSkillMode('clean', trimmed)
  }
  if (/^(do until|keep going until|set a goal)\b/.test(lower)) {
    return parseSkillMode('goal', trimmed)
  }
  if (/^(run|trigger|start)\s+(research|implement|review|security|qa|docs)\b/.test(lower)) {
    const stage = /research|implement|review|security|qa|docs/.exec(lower)?.[0] ?? 'full'
    return parseSkillMode('stage', `--mode ${stage} ${trimmed}`)
  }
  if (/^(run|start|do)\s+(the\s+)?(full\s+)?(loop|pipeline|ci\/?cd)\b/.test(lower)
    || /^(keep going|loop)\s+until\b/.test(lower)
    || /^full\s+(loop|pipeline)\b/.test(lower)) {
    return parseSkillMode('stage', `--mode loop ${trimmed}`)
  }
  if (/^(allocate|assign)\s+(pods?|agents?|jobs?)\b/.test(lower)) {
    const which = /pods?|agents?|jobs?/.exec(lower)?.[0] ?? 'pod'
    const mode = which.startsWith('agent') ? 'agent' : which.startsWith('job') ? 'job' : 'pod'
    return parseSkillMode('allocate', `--mode ${mode} ${trimmed}`)
  }
  const first = splitArgs(trimmed)
  return parseSkillMode(first.word, first.rest)
}

/** Command lines for /devops help --mode gates and the chat fallback (non-skill commands). */
const COMMAND_HELP: string[] = [
  '/devops              status: languages, gates, QA verdict',
  '/devops on|off | enable|disable  (you) turn the whole skill on or off; writes',
  '                     .claude/settings.json enabledPlugins and lifts session checks',
  '/devops skill on|off NAME  (you) skillOverrides for one skill (bare name)',
  '/devops skills       list each skill and its skillOverrides state',
  '/devops languages    what was detected and in which layer',
  '/devops setup        how to install the skill and profile in this project',
  '/devops setup claude [--dry-run] [--share-config] (you) set this project up for Claude Code:',
  '                     only .devops/ and the thought folders; the plugin supplies the rest',
  '/devops brief [TOPIC | role NAME]  one section of the skill, or a seat\'s brief',
  '/devops push-ok | push | go | publish   (you) allow ONE push on this tree; human word is',
  '                     final (overrides missing QA/Security; recorded). Chat "push" too',
  '/devops push-ok REPORT... --risk REASON [--goal GOAL]  (you) record a skipped',
  '                     Review/QA/Security check or dependency; not a pass. Seats cannot',
  '/devops push-reset | withdraw   (you) withdraw that permission',
  '/devops allow-branch NAME   (you) allow creating that git branch',
  '/devops gates on|off (you) turn the branch gate on or off; the push check stays on',
  '/devops monitor on|off (you) turn the failed-check monitor on or off',
  '/devops comments warn|strict|off (you) lint gate on git commit (comment and code rules): ' +
    'warn (default), refuse a commit with blocking findings, or off',
  '/devops config [show|get PATH] read the project standards (line length, limits, lint rules)',
  '/devops config set|unset|add|remove PATH [VALUE] | rule RULE error|off (you) change ' +
    '.devops/standards.json; checked before it is written',
]

/** Skill-mode lines for the help catalog. */
function skillHelpLines(): string[] {
  return SPECS.flatMap(s => {
    const alias = s.aliases.length > 0 ? ` (${s.aliases.join(', ')})` : ''
    const line = `/devops ${s.word}${alias} --mode ${s.modes.join('|')}  [text]`
    return [line, `                     ${s.skill}`]
  })
}

/** Catalog text for /devops help [--mode all|gates|skills|stage]; also the chat fallback (mode all). */
export function helpCatalog(mode: string): string {
  const stages = Object.entries(STAGE_ROLES).map(
    ([name, roles]) => `- ${name}: ${roles}`,
  )
  const parts: string[] = ['## /devops help', `mode: ${mode}`]
  if (mode === 'gates' || mode === 'all') {
    parts.push('### Gates and commands', ...COMMAND_HELP)
  }
  if (mode === 'skills' || mode === 'all') {
    parts.push('### Skill modes (text after the command is the input)', ...skillHelpLines())
  }
  if (mode === 'stage' || mode === 'all') {
    parts.push(
      '### CI/CD stages (`/devops stage|ci|pipeline --mode … [goal text]`)',
      ...stages,
      'Allocate pod and agent goals before spawning (`/devops allocate` or goal --mode allocate).',
    )
  }
  parts.push(
    'Free-form phrases map onto skill modes, or onto gate aliases the person typed',
    '(push → push-ok). Call the named tools; keep large file bodies out of chat.',
    'Keep development running. The person\'s push-ok (or chat "push") is one-shot and final:',
    'it authorizes even when QA/Security would otherwise block. Human orders beat skill',
    'contingencies. /devops off turns the skill off.',
  )
  return parts.join('\n')
}

/** Build the skill-mode card: mode, tools, behavior, and input. */
export function orchestrationCard(skill: SkillMode): string {
  if (skill.word === 'help') return helpCatalog(skill.mode)
  const spec = BY_ALIAS.get(skill.word)
  if (spec === undefined) return `Unknown skill mode: ${skill.word}`
  const input = skill.rest === '' ? '(none — ask if needed)' : skill.rest
  const stageNote = spec.word === 'stage' && STAGE_ROLES[skill.mode] !== undefined
    ? [`seats: ${STAGE_ROLES[skill.mode]}`]
    : []
  return [
    `## /devops ${spec.word}`,
    `mode: ${skill.mode} (allowed: ${spec.modes.join('|')})`,
    `skill: ${spec.skill}`,
    ...(spec.command !== undefined ? [`command: ${spec.command}`] : []),
    ...stageNote,
    `tools: ${spec.tools.join(', ') || '(none — follow behavior)'}`,
    'behavior:',
    ...spec.behavior.map(line => `- ${line}`),
    `input: ${input}`,
    'Keep development running. Call the tools above; keep large file bodies out of chat.',
  ].join('\n')
}

/** CLI argv for a skill mode that can shell out (mind-map / clean / question). */
export function scriptArgsFor(skill: SkillMode): string[] | undefined {
  if (skill.word === 'mind-map' || skill.word === 'question') return mindmapArgs(skill)
  if (skill.word === 'clean' && (skill.mode === 'brief' || skill.mode === 'scan')) {
    const statement = skill.rest || 'follow clean code principles'
    return [skill.mode, '--statement', statement]
  }
  return undefined
}

function mindmapArgs(skill: SkillMode): string[] | undefined {
  const mode = skill.word === 'question' ? questionAsMindmap(skill.mode) : skill.mode
  if (mode === 'overview') return ['overview']
  if (mode === 'status') return ['status']
  if (mode === 'build') return ['build', '--save']
  if (mode === 'tree') {
    const node = shellWords(skill.rest)[0]
    return node !== undefined ? ['tree', '--node', node] : ['tree']
  }
  if (mode === 'query' || mode === 'search' || mode === 'symbol'
    || mode === 'file' || mode === 'module' || mode === 'library') {
    return queryArgs(mode === 'query' ? 'search' : mode, skill.rest)
  }
  return undefined
}

function questionAsMindmap(mode: string): string {
  if (mode === 'overview') return 'overview'
  if (mode === 'tree') return 'tree'
  return mode === 'search' || mode === 'symbol' || mode === 'file'
    || mode === 'module' || mode === 'library'
    ? mode
    : 'search'
}

function queryArgs(kind: string, rest: string): string[] | undefined {
  const text = rest.trim()
  if (text === '') return undefined
  if (kind === 'symbol') return ['query', '--symbol', text]
  if (kind === 'file') return ['query', '--file', text]
  if (kind === 'module') return ['query', '--module', text]
  if (kind === 'library') return ['query', '--library', text]
  return ['query', '--search', text]
}

export function scriptNameFor(skill: SkillMode): string | undefined {
  if (skill.word === 'mind-map' || skill.word === 'question') return 'devops-mindmap.mjs'
  if (skill.word === 'clean') return 'devops-cleanup.mjs'
  return undefined
}
