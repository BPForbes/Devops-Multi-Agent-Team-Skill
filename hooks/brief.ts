/**
 * Serves the skill in pieces: an index, one section, or one role's brief, so the model reads the part
 * it needs instead of SKILL.md and every reference whole.
 */

export type Doc = { file: string; text: string }
export type Section = { file: string; heading: string; body: string }

const SECTION_HEADING = /^#{2,3} (.+)$/
const STOP = new Set([
  'the', 'and', 'for', 'with', 'how', 'what', 'when', 'who', 'does', 'into', 'from',
])
const HEADING_WEIGHT = 3
const FILE_WEIGHT = 4
/** Role files repeat what the references say; `role` serves them, so a topic prefers the references. */
const ROLE_FILE_SHARE = 0.5
const BODY_CAP = 5
const SEE_ALSO = 5
const BYTES_PER_KB = 1024
/** Longer sections are cut here; the reader is told how to get the rest. */
export const MAX_SECTION_CHARS = 6000

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/)
  .filter(w => w.length > 2 && !STOP.has(w))

/** A Markdown file cut at its `##` and `###` headings; text before the first one is the intro. */
export function sectionsOf(doc: Doc): Section[] {
  const out: Section[] = []
  let current: Section = { file: doc.file, heading: '(intro)', body: '' }
  for (const line of doc.text.split('\n')) {
    const heading = SECTION_HEADING.exec(line)
    if (heading) {
      if (current.body.trim() !== '') out.push(current)
      current = { file: doc.file, heading: (heading[1] ?? '').trim(), body: '' }
    }
    current.body += `${line}\n`
  }
  if (current.body.trim() !== '') out.push(current)
  return out
}

const kb = (chars: number): number => Math.max(1, Math.round(chars / BYTES_PER_KB))

/** One line per file: its size and its section headings. */
export function indexOf(docs: Doc[]): string {
  const total = docs.reduce((sum, d) => sum + d.text.length, 0)
  const lines = docs.map(doc => {
    const headings = sectionsOf(doc).map(s => s.heading).filter(h => h !== '(intro)')
    return `${doc.file} (${kb(doc.text.length)} KB): ${headings.join(' · ') || '(one section)'}`
  })
  const head = `The skill is ${kb(total)} KB in ${docs.length} files. `
    + 'Ask for one section by topic, or for a role.'
  return [head, ...lines].join('\n')
}

function score(section: Section, query: string[]): number {
  const heading = new Set(words(section.heading))
  const file = new Set(words(section.file))
  const body = words(section.body)
  const points = query.reduce((sum, w) => {
    const inBody = Math.min(BODY_CAP, body.filter(b => b === w).length)
    return sum + (heading.has(w) ? HEADING_WEIGHT : 0) + (file.has(w) ? FILE_WEIGHT : 0) + inBody
  }, 0)
  return section.file.startsWith('agents/') ? points * ROLE_FILE_SHARE : points
}

const title = (s: Section): string => `${s.file} › ${s.heading}`

/**
 * The section that best matches `topic`, read in parts of at most MAX_SECTION_CHARS. `part` (1-based)
 * picks the part; when more parts follow, the notice names the call that returns the next one.
 */
export function findSection(docs: Doc[], topic: string, part = 1): string {
  const query = words(topic)
  if (query.length === 0) return indexOf(docs)
  const ranked = docs.flatMap(sectionsOf)
    .map(section => ({ section, points: score(section, query) }))
    .filter(r => r.points > 0)
    .sort((a, b) => b.points - a.points)
  const best = ranked[0]?.section
  if (!best) return `Nothing in the skill matches "${topic}".\n\n${indexOf(docs)}`
  const parts = partsOf(best.body)
  const wanted = Math.min(Math.max(1, Math.floor(part) || 1), parts.length)
  const nextCall = `call devops_brief with topic "${topic}" and part ${wanted + 1} for the rest`
  const next = wanted < parts.length ? [`[part ${wanted} of ${parts.length}: ${nextCall}]`] : []
  const numbered = parts.length > 1 ? ` (part ${wanted} of ${parts.length})` : ''
  const more = ranked.slice(1, 1 + SEE_ALSO).map(r => `- ${title(r.section)}`)
  const also = more.length > 0 ? ['', 'Also matching:', ...more] : []
  const body = parts[wanted - 1].trim()
  return [`From ${title(best)}${numbered}:`, '', body, ...next, ...also].join('\n')
}

/**
 * The body cut into parts of at most MAX_SECTION_CHARS. A cut goes at the last line break in the
 * second half of the window, so a part keeps whole lines; otherwise it goes at the limit.
 */
function partsOf(body: string): string[] {
  const parts: string[] = []
  let rest = body
  while (rest.length > MAX_SECTION_CHARS) {
    const line = rest.lastIndexOf('\n', MAX_SECTION_CHARS)
    const cut = line >= MAX_SECTION_CHARS / 2 ? line : MAX_SECTION_CHARS
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n/, '')
  }
  parts.push(rest)
  return parts
}

/** The seat file for a role (`coder`, `cleaner`, ...): what that seat does, read once. */
export function roleBrief(docs: Doc[], role: string): string {
  const wanted = role.toLowerCase().replace(/^devops-/, '')
  const agents = docs.filter(d => d.file.startsWith('agents/'))
  const match = agents.find(d => d.file === `agents/devops-${wanted}.md`)
    ?? agents.find(d => d.file.includes(wanted))
  if (!match) {
    const roles = agents.map(d => d.file.replace(/^agents\/devops-|\.md$/g, '')).join(', ')
    return `No role "${role}". Roles: ${roles}.`
  }
  return `Role brief from ${match.file}:\n\n${match.text.trim()}`
}
