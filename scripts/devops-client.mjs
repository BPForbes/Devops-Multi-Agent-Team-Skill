#!/usr/bin/env node
// The client's answer to Orchestration's merge report, run by the push gate
// for the person's own /devops merge-ok, push-ok, done or merge-deny. It
// approves (clientSignOff) or denies (goalVerdict) every report waiting for
// the client, through the same board functions and lock as the server.
import fs from 'node:fs'
import path from 'node:path'
import { BOARD_FILE, emptyBoard, normalizeBoard } from './devops-board.mjs'
import { isMain } from './devops-main.mjs'
import { clientSignOff, goalVerdict, reportsFor } from './devops-scrum.mjs'
import { UNFENCED, projectPath, updateJson } from './devops-store.mjs'

const USAGE = 'usage: devops-client approve|deny [--reason TEXT] [--dest DIR]'

/**
 * Applies the client's decision to every report waiting for it. Returns the
 * report ids decided (empty when none waits) and leaves the board as it was
 * when the decision is refused.
 */
export function decide(board, { decision, reason, at }) {
  const waiting = reportsFor(board, { state: 'to_person' })
  if (decision === 'approve') return clientSignOff(board, { at })
  let next = board
  for (const report of waiting) {
    next = goalVerdict(next, { goal: report.goal, by: 'client', decision: 'deny', reason, at })
  }
  return { board: next, denied: waiting.map(r => r.id) }
}

function main(argv) {
  const decision = argv[0]
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  if (decision !== 'approve' && decision !== 'deny') return console.log(USAGE) ?? 2
  const file = projectPath(path.resolve(opt('--dest') ?? process.cwd()), BOARD_FILE)
  if (!fs.existsSync(file)) return console.log('No merge report waits for you.') ?? 0
  let ids = []
  updateJson(file, emptyBoard(), current => {
    const done = decide(normalizeBoard(current), {
      decision, reason: opt('--reason'), at: new Date().toISOString(),
    })
    ids = done.approved ?? done.denied
    return done.board
  }, UNFENCED)
  const verb = decision === 'approve' ? 'approved' : 'sent back to the Business Analyst'
  const none = 'No merge report waits for you.'
  console.log(ids.length === 0 ? none : `Merge report ${verb}: ${ids.join(', ')}`)
  return 0
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`devops-client: ${error.message}`)
    process.exitCode = 2
  }
}
