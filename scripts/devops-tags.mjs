#!/usr/bin/env node
// Version tracking through git tags: read how the project changed between releases, plan the next
// tag, create it locally. It runs `git` only with fixed argument lists (no shell, hooks off, no
// network) and never pushes, moves or deletes a tag; publishing a tag is a gated push.
//
//   node scripts/devops-tags.mjs history [--dest DIR] [--limit N] [--save]
//   node scripts/devops-tags.mjs plan    [--dest DIR] [--bump major|minor|patch] [--version X.Y.Z] [--ref REF]
//   node scripts/devops-tags.mjs create  [--dest DIR] --version X.Y.Z [--message TEXT] [--ref REF] [--apply]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInside, loadLanguages, resolveDest } from './devops-setup.mjs'

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const CONTAINERS = new Set(['src', 'packages', 'crates', 'apps', 'services', 'lib', 'libs', 'internal', 'cmd', 'modules', 'projects'])

/** Run one fixed git command. Hooks, fsmonitor and external diff are off; the environment is bare (HOME only when a tag needs an identity). */
function git(dest, args, { identity = false } = {}) {
  const env = { PATH: process.env.PATH ?? '', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' }
  if (identity && process.env.HOME) env.HOME = process.env.HOME
  const ran = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '--no-pager', '-C', dest, ...args], { env, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024, shell: false })
  if (ran.error) throw new Error(`git could not run: ${ran.error.message}`)
  return { ok: ran.status === 0, out: ran.stdout ?? '', err: (ran.stderr ?? '').trim() }
}

const must = (dest, args, options) => {
  const result = git(dest, args, options)
  if (!result.ok) throw new Error(result.err || `git ${args[0]} failed`)
  return result.out
}

export function parseSemver(name) {
  const m = SEMVER.exec(name)
  return m ? { name, major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, prefix: name.startsWith('v') ? 'v' : '' } : null
}

function compareSemver(a, b) {
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key]
  if (a.pre === b.pre) return 0
  if (a.pre === null) return 1
  if (b.pre === null) return -1
  return a.pre < b.pre ? -1 : 1
}

const stepOf = (prev, next) => (next.major !== prev.major ? 'major' : next.minor !== prev.minor ? 'minor' : next.patch !== prev.patch ? 'patch' : 'pre-release')

function conventional(subjects) {
  const types = {}
  let breaking = 0
  for (const subject of subjects) {
    const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject)
    const type = m ? m[1].toLowerCase() : 'other'
    types[type] = (types[type] ?? 0) + 1
    if (m?.[3] === '!' || /BREAKING[ -]CHANGE/.test(subject)) breaking += 1
  }
  return { types, breaking }
}

function suggestedBump({ types, breaking }) {
  return breaking > 0 ? 'major' : (types.feat ?? 0) > 0 ? 'minor' : 'patch'
}

function extensionToLanguage(dest) {
  const table = []
  for (const lang of loadLanguages(dest).languages) for (const ext of lang.detect?.extensions ?? []) table.push([ext.toLowerCase(), lang.id])
  return file => table.filter(([ext]) => file.toLowerCase().endsWith(ext)).sort((a, b) => b[0].length - a[0].length)[0]?.[1]
}

function dirOf(file) {
  const parts = file.split('/')
  if (parts.length === 1) return '(root)'
  return CONTAINERS.has(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0]
}

function range(dest, from, to) {
  const spec = from ? `${from}..${to}` : to
  const commits = Number(must(dest, ['rev-list', '--count', spec]).trim())
  const subjects = must(dest, ['log', '--format=%s', '-n', '5000', spec]).split('\n').filter(Boolean)
  const stats = { commits, files: 0, insertions: 0, deletions: 0, topDirectories: [], languages: {}, ...conventional(subjects) }
  if (from) {
    const languageOf = extensionToLanguage(dest)
    const dirs = {}
    for (const line of must(dest, ['diff', '--numstat', '--no-renames', '--no-ext-diff', '--no-textconv', from, to]).split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
      if (!m) continue
      stats.files += 1
      const changed = (m[1] === '-' ? 0 : +m[1]) + (m[2] === '-' ? 0 : +m[2])
      stats.insertions += m[1] === '-' ? 0 : +m[1]
      stats.deletions += m[2] === '-' ? 0 : +m[2]
      dirs[dirOf(m[3])] = (dirs[dirOf(m[3])] ?? 0) + changed
      const language = languageOf(m[3])
      if (language) stats.languages[language] = (stats.languages[language] ?? 0) + 1
    }
    stats.topDirectories = Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([directory, lines]) => ({ directory, lines }))
  }
  return stats
}

function readTags(dest) {
  const format = ['%(refname:short)', '%(objecttype)', '%(creatordate:iso-strict)', '%(objectname)', '%(*objectname)', '%(contents:subject)'].join('%09')
  return must(dest, ['for-each-ref', '--sort=creatordate', `--format=${format}`, 'refs/tags']).split('\n').filter(Boolean).map(line => {
    const [name, type, date, object, target, subject] = line.split('\t')
    return { name, annotated: type === 'tag', date, commit: target || object, subject: subject ?? '' }
  })
}

/** How the project changed between consecutive semver tags, what is unreleased, and (with save) what changed since the last snapshot. */
export function tagHistory(destInput, { limit = 30, save = false, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  if (!git(dest, ['rev-parse', '--git-dir']).ok) throw new Error('not a git repository (or git refuses this folder: check ownership)')
  const all = readTags(dest)
  const versions = all.map(tag => ({ tag, v: parseSemver(tag.name) })).filter(x => x.v).sort((a, b) => compareSemver(a.v, b.v))
  const other = all.filter(tag => !parseSemver(tag.name)).map(tag => tag.name)
  const shown = versions.slice(-Math.max(1, Math.min(limit, 200)))
  const releases = shown.map((entry, i) => {
    const previous = i === 0 ? versions[versions.indexOf(entry) - 1] : shown[i - 1]
    const stats = range(dest, previous?.tag.name, entry.tag.name)
    const step = previous ? stepOf(previous.v, entry.v) : 'first'
    const warnings = []
    if (previous && entry.v.major >= 1) {
      if (stats.breaking > 0 && step !== 'major') warnings.push(`${stats.breaking} breaking commit(s) in a ${step} release`)
      if ((stats.types.feat ?? 0) > 0 && step === 'patch') warnings.push('new feature(s) in a patch release')
    }
    return { ...entry.tag, version: entry.v.name, step, ...stats, warnings }
  })
  const latest = versions[versions.length - 1]
  const head = must(dest, ['rev-parse', 'HEAD']).trim()
  const unreleased = latest ? { since: latest.tag.name, ...range(dest, latest.tag.name, 'HEAD') } : null
  if (unreleased) unreleased.suggestedBump = suggestedBump(unreleased)

  const result = { dest, head, latest: latest?.tag.name ?? null, releases, unreleased, nonSemverTags: other }
  if (save) {
    const file = path.join(dest, '.devops', 'tags', 'history.json')
    let previous
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* first snapshot */ }
    const before = new Map((previous?.tags ?? []).map(t => [t.name, t.commit]))
    const snapshot = { generatedAt: new Date().toISOString(), tags: all.map(t => ({ name: t.name, commit: t.commit, annotated: t.annotated })) }
    result.sinceLastSnapshot = {
      newTags: snapshot.tags.filter(t => !before.has(t.name)).map(t => t.name),
      movedTags: snapshot.tags.filter(t => before.has(t.name) && before.get(t.name) !== t.commit).map(t => t.name),
      removedTags: [...before.keys()].filter(name => !snapshot.tags.some(t => t.name === name)),
    }
    assertInside(dest, file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n')
    result.saved = file
  }
  return result
}

function resolveCommit(dest, ref) {
  if (!REF.test(ref)) throw new Error(`not a plain ref name: ${JSON.stringify(ref)}`)
  const out = git(dest, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  if (!out.ok) throw new Error(`no such commit: ${ref}`)
  return out.out.trim()
}

/** The next tag, from the latest release tag and either a bump or an explicit version. Changes nothing. */
export function tagPlan(destInput, { bump, version, ref = 'HEAD', roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const history = tagHistory(dest, { limit: 1, roots })
  const releaseTags = readTags(dest).map(t => parseSemver(t.name)).filter(v => v && v.pre === null).sort(compareSemver)
  const latest = releaseTags[releaseTags.length - 1]
  const prefix = latest?.prefix ?? 'v'
  let next
  if (version) {
    const parsed = parseSemver(version)
    if (!parsed) throw new Error(`not a semantic version: ${version}`)
    next = parsed
    next.name = (version.startsWith('v') ? '' : prefix) + version
  } else {
    const chosen = bump ?? history.unreleased?.suggestedBump ?? 'patch'
    if (!['major', 'minor', 'patch'].includes(chosen)) throw new Error('bump must be major, minor or patch')
    const base = latest ?? { major: 0, minor: 0, patch: 0 }
    const parts = chosen === 'major' ? [base.major + 1, 0, 0] : chosen === 'minor' ? [base.major, base.minor + 1, 0] : [base.major, base.minor, base.patch + 1]
    next = { name: `${prefix}${parts.join('.')}`, major: parts[0], minor: parts[1], patch: parts[2], pre: null }
  }
  if (git(dest, ['rev-parse', '--verify', '--quiet', `refs/tags/${next.name}`]).ok) throw new Error(`tag ${next.name} already exists; tags are never moved: publish the next version instead`)
  const commit = resolveCommit(dest, ref)
  const notes = []
  if (latest && compareSemver(next, latest) <= 0) notes.push(`${next.name} is not newer than the latest release tag ${latest.name}`)
  if (history.unreleased) notes.push(`${history.unreleased.commits} commit(s) since ${history.unreleased.since}; suggested bump from their messages: ${history.unreleased.suggestedBump}`)
  if (bump && history.unreleased && bump !== history.unreleased.suggestedBump) notes.push(`you asked for ${bump}; the commit messages suggest ${history.unreleased.suggestedBump}`)
  return {
    dest, latest: latest?.name ?? null, next: next.name, commit, notes,
    commands: [
      `git tag -a ${next.name} -m "Release ${next.name}" ${commit}`,
      `git push origin refs/tags/${next.name}   # publishing: QA PASS and the human's go first; one push`,
    ],
  }
}

/** Create one annotated local tag. Never moves, deletes or pushes. */
export function tagCreate(destInput, { version, message, ref = 'HEAD', apply = false, roots } = {}) {
  const dest = resolveDest(destInput, roots)
  const parsed = parseSemver(version ?? '')
  if (!parsed) throw new Error(`not a semantic version: ${version}`)
  const text = message ?? `Release ${version}`
  if (typeof text !== 'string' || text.length > 500 || text.includes('\0')) throw new Error('message must be text under 500 characters')
  if (git(dest, ['rev-parse', '--verify', '--quiet', `refs/tags/${version}`]).ok) throw new Error(`tag ${version} already exists; tags are never moved`)
  const commit = resolveCommit(dest, ref)
  if (!apply) return { dest, tag: version, commit, applied: false, note: 'plan only; pass apply=true to create the local tag' }
  must(dest, ['tag', '-a', version, '-m', text, commit], { identity: true })
  return { dest, tag: version, commit, applied: true, next: `git push origin refs/tags/${version}   # publishing: QA PASS and the human's go first` }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const command = argv.shift()
  const opt = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const dest = opt('--dest') ? path.resolve(opt('--dest')) : process.cwd()
  try {
    const result = command === 'history' ? tagHistory(dest, { limit: Number(opt('--limit') ?? 30), save: argv.includes('--save') })
      : command === 'plan' ? tagPlan(dest, { bump: opt('--bump'), version: opt('--version'), ref: opt('--ref') })
        : command === 'create' ? tagCreate(dest, { version: opt('--version'), message: opt('--message'), ref: opt('--ref'), apply: argv.includes('--apply') })
          : (() => { throw new Error('usage: devops-tags history|plan|create --dest DIR ...') })()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`devops-tags: ${error.message}`)
    process.exitCode = 1
  }
}
