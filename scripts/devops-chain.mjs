#!/usr/bin/env node
// The Done chain's typed words, run by the /devops hook for a seat (as
// DEVOPS_SEAT) or the person, through the server's board functions and lock.
import path from 'node:path'
import fs from 'node:fs'
import { BOARD_FILE, emptyBoard, normalizeBoard } from './devops-board.mjs'
import { isAgentId } from './devops-ids.mjs'
import { isMain } from './devops-main.mjs'
import {
  clientSignOff, goalDone, goalVerdict, recordPush, reportsFor,
} from './devops-scrum.mjs'
import { UNFENCED, projectPath, updateJson } from './devops-store.mjs'
import { TEAM_DIR, readMembers } from './devops-teams.mjs'

const USAGE = [
  'usage: devops-chain <command> [--dest DIR]',
  '  approve REPORT...                 the client approves the named merge reports',
  '  deny [REPORT...] --reason TEXT    the client denies them (all waiting when none named)',
  '  pushed --tree TREE REPORT...      record the push of approved reports',
  '  merge-ok|merge-deny|done GOAL     a seat (DEVOPS_SEAT) on its own Done-chain step',
  '    [--reason TEXT] [--kind K] [--surface S] [--demoer AGENT] [--meets TEXT]...',
].join('\n')

const SEAT_WORDS = new Set(['merge-ok', 'merge-deny', 'done'])

/**
 * Applies one decision to the board. `who` is the seat for a seat word,
 * the pusher for `pushed`. Returns { board, text }.
 */
export function decide(board, { command, ids, goal, reason, tree, who, extra, at }) {
  if (command === 'approve') {
    const done = clientSignOff(board, { ids, at })
    return { board: done.board, text: `Merge report approved: ${done.approved.join(', ')}` }
  }
  if (command === 'deny') {
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
  if (command === 'pushed') {
    const next = recordPush(board, { ids, by: who, tree, at })
    return { board: next, text: `Push recorded on ${ids.join(', ')} by ${who}` }
  }
  if (!SEAT_WORDS.has(command)) throw new Error(USAGE)
  if (!isAgentId(who.seat)) {
    throw new Error('only a seat bound with DEVOPS_SEAT types merge-ok, merge-deny or done')
  }
  const acting = { goal, by: who.seat, team: who.team, members: who.members, at }
  if (command === 'done') {
    return { board: goalDone(board, { ...acting, ...extra }).board, text: `${goal}: done` }
  }
  const decision = command === 'merge-ok' ? 'ok' : 'deny'
  return { board: goalVerdict(board, { ...acting, decision, reason }), text: `${goal}: ${command}` }
}

function parse(argv) {
  const values = name => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []))
  const valued = new Set(['--dest', '--reason', '--tree', '--kind', '--surface', '--demoer',
    '--meets'])
  const positional = argv.slice(1).filter((a, i) => !valued.has(a) && !valued.has(argv[i]))
  return { command: argv[0], positional, one: name => values(name)[0], values }
}

function main(argv) {
  const { command, positional, one, values } = parse(argv)
  const known = ['approve', 'deny', 'pushed', ...SEAT_WORDS]
  if (!known.includes(command)) return console.log(USAGE) ?? 2
  const root = path.resolve(one('--dest') ?? process.cwd())
  const file = projectPath(root, BOARD_FILE)
  if (!fs.existsSync(file)) return console.log('There is no board yet.') ?? 0
  const team = process.env.DEVOPS_TEAM
  const seat = process.env.DEVOPS_SEAT
  const members = team ? readMembers(projectPath(root, path.join(TEAM_DIR, `${team}.json`)))
    : undefined
  const pusher = seat ?? 'orchestration'
  const extra = {
    kind: one('--kind'), surface: one('--surface'), demoer: one('--demoer'),
    meets: values('--meets'),
  }
  let text = ''
  updateJson(file, emptyBoard(), current => {
    const done = decide(normalizeBoard(current), {
      command, ids: positional, goal: positional[0], reason: one('--reason'), tree: one('--tree'),
      who: SEAT_WORDS.has(command) ? { seat, team, members } : pusher, extra,
      at: new Date().toISOString(),
    })
    text = done.text
    return done.board
  }, UNFENCED)
  console.log(text)
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
