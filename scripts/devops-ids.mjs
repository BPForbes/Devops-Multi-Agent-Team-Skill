#!/usr/bin/env node
import crypto from 'node:crypto'
import { isMain } from './devops-main.mjs'

export const JOBS = Object.freeze([
  'researcher', 'coder', 'reviewer', 'security', 'qa', 'ci', 'verifier',
  'integrator', 'communicator', 'cleaner', 'ticket-lead', 'idle',
])

/** Three random bytes → six hex chars (matches the skill mint width). */
const HEX_BYTES = 3

const TEAM_RE = /^team-[0-9a-f]{6}$/
const AGENT_RE = /^agent-[0-9a-f]{6}$/
const ITEM_RE = /^item-[0-9a-f]{6}$/
const GOAL_RE = /^goal-[0-9a-f]{6}$/

function mintHex() {
  return crypto.randomBytes(HEX_BYTES).toString('hex')
}

/** A minter for `<prefix>-<six hex>` ids. */
function mintFor(prefix) {
  return () => `${prefix}-${mintHex()}`
}

/** A checker for ids matching `re`; non-strings are never ids. */
function idCheck(re) {
  return value => typeof value === 'string' && re.test(value)
}

export const mintTeamId = mintFor('team')
export const mintAgentId = mintFor('agent')
export const mintItemId = mintFor('item')
export const mintGoalId = mintFor('goal')

export const isTeamId = idCheck(TEAM_RE)
export const isAgentId = idCheck(AGENT_RE)
export const isItemId = idCheck(ITEM_RE)
export const isGoalId = idCheck(GOAL_RE)

export function isJob(value) {
  return typeof value === 'string' && JOBS.includes(value)
}

/** All team hashes on a record: current `team` plus `teams` history. */
export function teamsOf(record) {
  if (!record || typeof record !== 'object') return []
  const listed = [
    ...(record.team ? [record.team] : []),
    ...(Array.isArray(record.teams) ? record.teams : []),
  ]
  return [...new Set(listed.filter(isTeamId))]
}

/** Refuse a judge that authored the work or shares any authoring pod. */
function authorProblem(judge, judgeTeams, author) {
  if (!isAgentId(author.agent)) {
    return `incomplete: author agent id: ${author.agent ?? '?'}`
  }
  if (author.agent === judge.agent) return `own work: ${judge.agent}`
  if (judge.handle && author.handle && author.handle === judge.handle) {
    return `own handle: ${judge.handle}`
  }
  const authorTeams = teamsOf(author)
  if (authorTeams.length === 0) {
    return `incomplete: author teams for ${author.agent ?? '?'}`
  }
  const shared = judgeTeams.find(team => authorTeams.includes(team))
  return shared === undefined ? undefined : `own pod: ${shared}`
}

export function independenceOk(judge, authors) {
  if (!judge || !isAgentId(judge.agent)) {
    return { ok: false, reason: 'judge needs an agent id' }
  }
  const judgeTeams = teamsOf(judge)
  if (judgeTeams.length === 0) {
    return { ok: false, reason: 'incomplete: judge teams required' }
  }
  const list = authors ?? []
  if (list.length === 0) {
    return { ok: false, reason: 'incomplete: authors required' }
  }
  for (const author of list) {
    const problem = authorProblem(judge, judgeTeams, author)
    if (problem !== undefined) return { ok: false, reason: problem }
  }
  return { ok: true }
}

/** Idle agents, optionally filtered by initial_job. */
export function freeAgents(registry, { want, initial, freeOnly = true } = {}) {
  const rows = Array.isArray(registry) ? registry : []
  return rows.filter(row => matchesFree(row, { want, initial, freeOnly }))
}

function matchesFree(row, { want, initial, freeOnly }) {
  if (!isAgentId(row.agent)) return false
  if (initial && row.initial_job !== initial) return false
  if (freeOnly) return row.current_job === 'idle'
  if (!want) return true
  return row.current_job === 'idle' || row.current_job === want
}

/** Agents already on a job (for need-more-X comparisons). */
export function agentsOnJob(registry, job) {
  if (!isJob(job)) return []
  return (Array.isArray(registry) ? registry : []).filter(
    row => isAgentId(row.agent) && row.current_job === job,
  )
}

/** Shared item record; notes is required prose. */
export function itemRecord({ item, kind, notes, authors = [], team, path }) {
  if (!isItemId(item)) throw new Error(`bad item id: ${item}`)
  if (typeof kind !== 'string' || kind.trim() === '') throw new Error('kind required')
  if (typeof notes !== 'string' || notes.trim() === '') throw new Error('notes required')
  return {
    item,
    kind: kind.trim(),
    notes: notes.trim(),
    authors: [...authors],
    ...(team !== undefined ? { team } : {}),
    ...(path !== undefined ? { path } : {}),
  }
}

function usage() {
  return [
    'Usage:',
    '  devops-ids mint team',
    '  devops-ids mint agent',
    '  devops-ids mint item',
    '  devops-ids mint goal',
    '  devops-ids check team|agent|item|goal|job VALUE',
    '  devops-ids independence --judge AGENT --team TEAM [--teams T1,T2] \\',
    '      [--handle H] --author AGENT:TEAM[+TEAM...][:HANDLE] ...',
    '  devops-ids free --registry JSON [--want JOB] [--initial JOB]',
  ].join('\n')
}

function parseAuthor(spec) {
  const [agent, teamPart, handle] = String(spec).split(':')
  const teamList = (teamPart ?? '').split('+').map(t => t.trim()).filter(Boolean)
  return {
    agent,
    ...(teamList[0] ? { team: teamList[0] } : {}),
    ...(teamList.length > 1 ? { teams: teamList.slice(1) } : {}),
    ...(handle ? { handle } : {}),
  }
}

const MINTERS = new Map([
  ['team', mintTeamId],
  ['agent', mintAgentId],
  ['item', mintItemId],
  ['goal', mintGoalId],
])

const CHECKS = new Map([
  ['team', isTeamId],
  ['agent', isAgentId],
  ['item', isItemId],
  ['goal', isGoalId],
  ['job', isJob],
])

function runMint(kind) {
  const mint = MINTERS.get(kind)
  if (mint === undefined) {
    console.error(usage())
    return 1
  }
  console.log(mint())
  return 0
}

function checkValue(kind, value) {
  const check = CHECKS.get(kind)
  return check === undefined ? false : check(value)
}

function runCheck(rest) {
  const [kind, value] = rest
  const ok = checkValue(kind, value)
  console.log(ok ? 'ok' : 'bad')
  return ok ? 0 : 1
}

function takeFlag(rest, i, judge, authors) {
  const arg = rest[i]
  if (arg === '--judge') {
    return { i: i + 1, judge: { ...judge, agent: rest[i + 1] }, authors }
  }
  if (arg === '--team') {
    return { i: i + 1, judge: { ...judge, team: rest[i + 1] }, authors }
  }
  if (arg === '--teams') {
    const teams = String(rest[i + 1] ?? '').split(',').map(t => t.trim()).filter(Boolean)
    return { i: i + 1, judge: { ...judge, teams }, authors }
  }
  if (arg === '--handle') {
    return { i: i + 1, judge: { ...judge, handle: rest[i + 1] }, authors }
  }
  if (arg === '--author') {
    return { i: i + 1, judge, authors: [...authors, parseAuthor(rest[i + 1])] }
  }
  return { i, judge, authors }
}

function runIndependence(rest) {
  let judge = { agent: undefined, team: undefined, handle: undefined }
  let authors = []
  for (let i = 0; i < rest.length; i += 1) {
    ;({ i, judge, authors } = takeFlag(rest, i, judge, authors))
  }
  const result = independenceOk(judge, authors)
  console.log(JSON.stringify(result))
  return result.ok ? 0 : 1
}

function runFree(rest) {
  let registry = []
  let want
  let initial
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--registry') {
      registry = JSON.parse(rest[++i])
    } else if (arg === '--want') {
      want = rest[++i]
    } else if (arg === '--initial') {
      initial = rest[++i]
    }
  }
  console.log(JSON.stringify(freeAgents(registry, { want, initial, freeOnly: want === undefined })))
  return 0
}

function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'mint') return runMint(rest[0])
  if (cmd === 'check') return runCheck(rest)
  if (cmd === 'independence') return runIndependence(rest)
  if (cmd === 'free') return runFree(rest)
  console.error(usage())
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
