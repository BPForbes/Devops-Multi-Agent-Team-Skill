#!/usr/bin/env node
// The Done chain's typed words, run by the /devops hook for a seat (as
// DEVOPS_SEAT) or the person, through the server's board functions and lock.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { BOARD_FILE, emptyBoard, normalizeBoard } from './devops-board.mjs'
import { isAgentId } from './devops-ids.mjs'
import { isMain } from './devops-main.mjs'
import {
  clientSignOff, decideBug, goalDone, goalVerdict, raiseToAnalyst, recordMerged, recordPush,
  reportsFor,
} from './devops-scrum.mjs'
import { UNFENCED, projectPath, updateJson } from './devops-store.mjs'
import { TEAM_DIR, readMembers } from './devops-teams.mjs'

const USAGE = [
  'usage: devops-chain <command> [--dest DIR]',
  '  approve REPORT...                 the client approves the named merge reports',
  '  deny [REPORT...] --reason TEXT    the client denies them (all waiting when none named)',
  '  pushed --tree TREE REPORT...      record the push of approved reports',
  '  waiting                           list the merge reports waiting for the client',
  '  merged --base REF REPORT...       once the real PR is merged into REF, record it and',
  '                                    delete the temporary virtual-git branches',
  '  bug REPORT fine|fix [--proposal N | --alternative TEXT]',
  '                                    the client answers a bug report',
  '  merge-ok|merge-deny|done GOAL     a seat (DEVOPS_SEAT) on its own Done-chain step',
  '    [--reason TEXT] [--kind K] [--surface S] [--demoer AGENT] [--meets]',
  '    [--override TEXT]               the BA signs over a reported bug for a big matter',
  '  raise GOAL --reason TEXT          the lead raises a bug found in development to the BA',
].join('\n')

const SEAT_WORDS = new Set(['merge-ok', 'merge-deny', 'done', 'raise'])

/** The client's words on merge and bug reports. */
const PERSON_WORDS = Object.freeze({
  approve: (board, { ids, at }) => {
    const done = clientSignOff(board, { ids, at })
    return { board: done.board, text: `Merge report approved: ${done.approved.join(', ')}` }
  },
  deny: denyReports,
  bug: (board, { ids, words, extra = {}, at }) => {
    const [id] = ids
    const decision = words[0]
    const { proposal, alternative } = extra
    const next = decideBug(board, { id, decision, proposal, alternative, at })
    const how = next.reports[id].fix ?? 'the behavior is fine'
    return { board: next, text: `Bug report ${id}: ${decision === 'fix' ? `fix, ${how}` : how}` }
  },
})

/** The client denies the named merge reports, or all waiting when none is named. */
function denyReports(board, { ids, reason, at }) {
  const named = ids.length > 0 ? ids : reportsFor(board, { state: 'to_person' }).map(r => r.id)
  let next = board
  for (const id of named) {
    const row = next.reports[id]
    if (row?.state !== 'to_person') throw new Error(`report ${id} is not waiting for the client`)
    next = goalVerdict(next, { goal: row.goal, by: 'client', decision: 'deny', reason, at })
  }
  const text = named.length === 0 ? 'No merge report waits for you.'
    : `Merge report sent back to the Business Analyst: ${named.join(', ')}`
  return { board: next, text }
}

/**
 * Applies one decision to the board. `who` is the seat for a seat word,
 * the pusher for `pushed`. Returns { board, text }.
 */
export function decide(board, options) {
  const { command, ids, tree, who, at, onBase } = options
  if (Object.hasOwn(PERSON_WORDS, command)) return PERSON_WORDS[command](board, options)
  if (command === 'pushed') {
    const next = recordPush(board, { ids, by: who, tree, at })
    return { board: next, text: `Push recorded on ${ids.join(', ')} by ${who}` }
  }
  if (command === 'merged') return merged(board, { ids, who, at, onBase })
  if (!SEAT_WORDS.has(command)) throw new Error(USAGE)
  return seatWord(board, options)
}

/** A seat's own Done-chain step: merge-ok, merge-deny, done, or a lead's raise. */
function seatWord(board, { command, goal, reason, who, extra = {}, at }) {
  if (!isAgentId(who.seat)) {
    throw new Error('only a seat bound with DEVOPS_SEAT types merge-ok, merge-deny, done or raise')
  }
  if (command === 'raise') {
    const next = raiseToAnalyst(board, { goal, lead: who.seat, reason, at })
    return { board: next, text: `${goal}: raised to the Business Analyst` }
  }
  const acting = { goal, by: who.seat, team: who.team, members: who.members, at }
  const decision = command === 'merge-ok' ? 'ok' : 'deny'
  const next = command === 'done' ? goalDone(board, { ...acting, ...extra }).board
    : goalVerdict(board, { ...acting, decision, reason, override: extra.override })
  const fix = next.goals[goal]?.bug_fix
  const denied = fix?.at === at ? `not signed, ${fix.reason}; the coders are told` : command
  return { board: next, text: `${goal}: ${denied}` }
}

/**
 * Records the merge of the real PR for pushed reports, refused unless each
 * pushed tree is on the base (`onBase`). Returns the temporary virtual-git
 * branches to delete now (`side`).
 */
function merged(board, { ids, who, at, onBase }) {
  for (const id of ids) {
    const tree = board.reports[id]?.pushed_tree
    if (tree === undefined || !onBase(tree)) {
      throw new Error(`report ${id}'s pushed tree is not on the base: the real PR is not merged`)
    }
  }
  const done = recordMerged(board, { ids, by: who, at })
  return { board: done.board, side: done.side, text: `Merge recorded on ${ids.join(', ')}` }
}

const LOCAL_REF = /^local\/[a-z0-9][a-z0-9._-]*$/

/** The trees of the commits on `base`. */
function treesOn(root, base) {
  const args = ['log', '--format=%T', base, '--']
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  return new Set(out.split('\n').filter(Boolean))
}

/**
 * Deletes the temporary virtual-git branches of a merged PR: local refs
 * (`local/...`) and side worktrees git lists, never the main worktree.
 * Anything else is left alone and named. Returns one line per branch.
 */
function deleteSide(root, side) {
  if (side.length === 0) return []
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const worktrees = git(['worktree', 'list', '--porcelain']).split('\n')
    .filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length))
  return side.map(name => {
    if (LOCAL_REF.test(name)) {
      git(['branch', '-D', name])
      return `deleted ${name}`
    }
    if (path.isAbsolute(name) && worktrees.slice(1).includes(name)) {
      git(['worktree', 'remove', '--force', name])
      return `removed ${name}`
    }
    return `left ${name}: not a local/ ref or a side worktree`
  })
}

function parse(argv) {
  const values = name => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []))
  const valued = new Set(['--dest', '--reason', '--tree', '--kind', '--surface', '--demoer',
    '--base', '--override', '--proposal', '--alternative'])
  const positional = argv.slice(1)
    .filter((a, i) => !valued.has(a) && !valued.has(argv[i]) && a !== '--meets')
  const one = name => values(name)[0]
  return { command: argv[0], positional, one, flag: name => argv.includes(name) }
}

/** The merge reports waiting for the client, as one line. */
function waitingText(file) {
  const ids = reportsFor(normalizeBoard(JSON.parse(fs.readFileSync(file, 'utf8'))), {
    state: 'to_person',
  }).map(r => r.id)
  return ids.length === 0 ? 'No merge report waits for you.' : `waiting: ${ids.join(' ')}`
}

/** Who acts: the bound seat for a seat word, else the seat or Orchestration. */
function actor(root, command) {
  const team = process.env.DEVOPS_TEAM
  const seat = process.env.DEVOPS_SEAT
  if (!SEAT_WORDS.has(command)) return seat || 'orchestration'
  const members = team ? readMembers(projectPath(root, path.join(TEAM_DIR, `${team}.json`)))
    : undefined
  return { seat, team, members }
}

function main(argv) {
  const { command, positional, one, flag } = parse(argv)
  const known = [...Object.keys(PERSON_WORDS), 'pushed', 'waiting', 'merged', ...SEAT_WORDS]
  if (!known.includes(command)) return console.log(USAGE) ?? 2
  const root = path.resolve(one('--dest') ?? process.cwd())
  const file = projectPath(root, BOARD_FILE)
  if (!fs.existsSync(file)) return console.log('There is no board yet.') ?? 0
  if (command === 'waiting') return console.log(waitingText(file)) ?? 0
  const base = one('--base')
  const proposal = one('--proposal')
  const extra = {
    kind: one('--kind'), surface: one('--surface'), demoer: one('--demoer'), meets: flag('--meets'),
    override: one('--override'), alternative: one('--alternative'),
    proposal: proposal === undefined ? undefined : Number(proposal),
  }
  let done
  updateJson(file, emptyBoard(), current => {
    done = decide(normalizeBoard(current), {
      command, ids: positional, words: positional.slice(1), goal: positional[0],
      reason: one('--reason'), tree: one('--tree'),
      who: actor(root, command), extra, at: new Date().toISOString(),
      onBase: tree => base !== undefined && treesOn(root, base).has(tree),
    })
    return done.board
  }, UNFENCED)
  console.log([done.text, ...deleteSide(root, done.side ?? [])].join('\n'))
  return 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-chain: ${error.message}`)
    process.exitCode = 2
  }
}
