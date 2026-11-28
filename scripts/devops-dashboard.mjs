// The dashboard report (references/dashboard.md): renders the state, and
// writeDashboard puts it beside the board.
import fs from 'node:fs'
import path from 'node:path'

import { BOARD_FILE, emptyBoard, normalizeBoard } from './devops-board.mjs'
import { CATALOG_FILE, emptyLedger } from './devops-catalog.mjs'
import { LOOP_FILE } from './devops-loop.mjs'
import { projectPath, readJson, writeAtomic } from './devops-store.mjs'
import { openDeadlocks, stalledGoals } from './devops-vision.mjs'

/** The dashboard file, beside the board (relative to the project folder). */
export const DASHBOARD_FILE = path.join(path.dirname(BOARD_FILE), 'DASHBOARD.md')
const FILES_SHOWN = 20
const NOTES_SHOWN = 3

/** Escapes a value for a Markdown table cell. */
const cell = value => String(value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '-'

const HASH_SHOWN = 12
const short = hash => (typeof hash === 'string' ? hash.slice(0, HASH_SHOWN) : '-')

/** The files of a work item from the catalog ledger, with each file's hash. */
function filesOf(ledger, work) {
  return ledger?.works?.[work]?.files ?? []
}

function table(headers, rows) {
  if (rows.length === 0) return '_none_\n'
  const head = `| ${headers.join(' | ')} |`
  const rule = `| ${headers.map(() => '---').join(' | ')} |`
  return [head, rule, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n') + '\n'
}

function goalsSection(board) {
  const rows = Object.entries(board.goals).map(([id, goal]) => [
    id, goal.title, goal.state, goal.sprint || 'backlog', goal.owner ?? '-', goal.priority ?? '-',
  ])
  return `## Goals\n\n${table(['Goal', 'Title', 'State', 'Sprint', 'Owner', 'Priority'], rows)}`
}

function visionSection(board) {
  const blocks = Object.entries(board.goals).map(([id, goal]) => {
    const notes = (goal.vision ?? []).slice(-NOTES_SHOWN)
      .map(note => {
        const who = note.by ? `, ${note.by}` : ''
        return `  - [${note.source}${who}, ${note.at ?? '-'}] ${note.text}`
      })
    const lines = [
      `### ${id}: ${goal.title}`,
      `- Objective: ${goal.objective ?? '_not stated_'}`,
      `- Acceptance: ${(goal.acceptance ?? []).join('; ') || '_not stated_'}`,
      notes.length > 0 ? '- Vision notes:' : '- Vision notes: _none yet_',
      ...notes,
    ]
    return lines.join('\n')
  })
  return `## Client vision\n\n${blocks.length > 0 ? blocks.join('\n\n') : '_no goals_'}\n\n`
}

function workSection(board, ledger) {
  const blocks = Object.entries(board.assignments ?? {}).map(([id, row]) => {
    const files = filesOf(ledger, id)
    const shown = files.slice(0, FILES_SHOWN)
    const rows = shown.map(file => [file.path, short(file.hash)])
    const more = files.length > shown.length ? `\n_+${files.length - shown.length} more files_` : ''
    return [
      `### ${id}: ${row.job} for ${row.goal}`,
      `- Seat: ${row.agent} (team ${row.team}), state ${row.state}`,
      `- Description: ${row.description}`,
      table(['File', 'Hash'], rows) + more,
    ].join('\n')
  })
  return `## Work items and files\n\n${blocks.length > 0 ? blocks.join('\n\n') : '_no work_'}\n\n`
}

function deadlockSection(board) {
  const open = openDeadlocks(board)
  const rows = open.map(d => [d.id, d.goal, d.team ?? '-', d.state, d.reason])
  const forwarded = Object.values(board.deadlocks ?? {}).filter(d => d.state === 'forwarded')
    .map(d => [d.id, d.goal, d.team ?? '-', 'forwarded', (d.forwarded_to ?? []).join(', ')])
  const questions = open.filter(d => d.state === 'with_client')
    .map(d => `- ${d.id} (${d.goal}): ${d.question ?? ''}`)
  const stalled = stalledGoals(board).map(s => `- ${s.goal}: ${s.reasons.join('; ')}`)
  return [
    '## Deadlocks and questions\n',
    '### Open\n', table(['Deadlock', 'Goal', 'Team', 'State', 'Reason'], rows),
    '### Waiting for the client\n', questions.length > 0 ? `${questions.join('\n')}\n` : '_none_\n',
    '### Stalled, not yet raised\n', stalled.length > 0 ? `${stalled.join('\n')}\n` : '_none_\n',
    '### Forwarded to members\n',
    table(['Deadlock', 'Goal', 'Team', 'State', 'Members'], forwarded),
  ].join('\n')
}

function sprintSection(board, loop) {
  const rows = Object.entries(board.sprints ?? {}).map(([id, sprint]) => [
    id, sprint.name, sprint.status, sprint.weeks ?? '-', (sprint.goals ?? []).length,
  ])
  const next = loop?.pause ? `\nThe sprint loop is paused: ${loop.pause.reason}.\n` : ''
  return `## Sprints\n\n${table(['Sprint', 'Name', 'Status', 'Weeks', 'Goals'], rows)}${next}\n`
}

/**
 * The dashboard text for the board. `ledger` supplies each work item's files and
 * hashes; `loop` the sprint loop's pause; `project` the project's name.
 */
export function renderDashboard({ board, ledger, loop, project = 'project' }) {
  return [
    `# Dashboard: ${project}\n`,
    'Generated from the board on each change. Do not edit: the board and the client\'s',
    'notes are the source of truth.\n',
    deadlockSection(board),
    '',
    sprintSection(board, loop),
    goalsSection(board),
    '',
    visionSection(board),
    workSection(board, ledger),
  ].join('\n')
}

/**
 * Rewrites the dashboard of the project at `dest` from what is on disk: the
 * board, the catalog ledger and the sprint loop. Every writer calls it, so the
 * report is never behind the state.
 */
export function writeDashboard(dest) {
  const board = normalizeBoard(readJson(projectPath(dest, BOARD_FILE), emptyBoard()))
  const ledger = readJson(projectPath(dest, CATALOG_FILE), emptyLedger())
  const loop = readJson(projectPath(dest, LOOP_FILE), undefined)
  const text = renderDashboard({ board, ledger, loop, project: path.basename(dest) })
  const file = projectPath(dest, DASHBOARD_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeAtomic(file, text)
  return file
}
