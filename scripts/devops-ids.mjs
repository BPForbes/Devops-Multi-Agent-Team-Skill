#!/usr/bin/env node
import crypto from 'node:crypto'
import { isMain } from './devops-main.mjs'

export const JOBS = Object.freeze([
  'researcher', 'coder', 'reviewer', 'security', 'qa', 'ci', 'verifier',
  'integrator', 'communicator', 'cleaner', 'ticket-lead', 'idle',
])

/** Three random bytes → six hex chars (matches the skill mint width). */
const HEX_BYTES = 3

const HEX6 = /^[0-9a-f]{6}$/
const TEAM_RE = /^team-[0-9a-f]{6}$/
const AGENT_RE = /^agent-[0-9a-f]{6}$/
const ITEM_RE = /^item-[0-9a-f]{6}$/

export function mintHex() {
  return crypto.randomBytes(HEX_BYTES).toString('hex')
}

export function mintTeamId() {
  return `team-${mintHex()}`
}

export function mintAgentId() {
  return `agent-${mintHex()}`
}

export function mintItemId() {
  return `item-${mintHex()}`
}

export function isTeamId(value) {
  return typeof value === 'string' && TEAM_RE.test(value)
}

export function isAgentId(value) {
  return typeof value === 'string' && AGENT_RE.test(value)
}

export function isItemId(value) {
  return typeof value === 'string' && ITEM_RE.test(value)
}

export function isJob(value) {
  return typeof value === 'string' && JOBS.includes(value)
}

/** True when the hex body alone is well-formed (no prefix). */
export function isHex6(value) {
  return typeof value === 'string' && HEX6.test(value)
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
    if (author.agent && author.agent === judge.agent) {
      return { ok: false, reason: `own work: ${judge.agent}` }
    }
    if (judge.handle && author.handle && author.handle === judge.handle) {
      return { ok: false, reason: `own handle: ${judge.handle}` }
    }
    const authorTeams = teamsOf(author)
    if (authorTeams.length === 0) {
      return { ok: false, reason: `incomplete: author teams for ${author.agent ?? '?'}` }
    }
    const shared = judgeTeams.find(team => authorTeams.includes(team))
    if (shared !== undefined) {
      return { ok: false, reason: `own pod: ${shared}` }
    }
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
    '  devops-ids check team|agent|item|job VALUE',
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

function runMint(kind) {
  if (kind === 'team') {
    console.log(mintTeamId())
    return 0
  }
  if (kind === 'agent') {
    console.log(mintAgentId())
    return 0
  }
  if (kind === 'item') {
    console.log(mintItemId())
    return 0
  }
  console.error(usage())
  return 1
}

function checkValue(kind, value) {
  if (kind === 'team') return isTeamId(value)
  if (kind === 'agent') return isAgentId(value)
  if (kind === 'item') return isItemId(value)
  if (kind === 'job') return isJob(value)
  return false
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
  console.log(JSON.stringify(freeAgents(registry, { want, initial })))
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
