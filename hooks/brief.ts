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

/** The section that best matches `topic`, cut to MAX_SECTION_CHARS, with the next best named after it. */
export function findSection(docs: Doc[], topic: string): string {
  const query = words(topic)
  if (query.length === 0) return indexOf(docs)
  const ranked = docs.flatMap(sectionsOf)
    .map(section => ({ section, points: score(section, query) }))
    .filter(r => r.points > 0)
    .sort((a, b) => b.points - a.points)
  const best = ranked[0]?.section
  if (!best) return `Nothing in the skill matches "${topic}".\n\n${indexOf(docs)}`
  const cut = best.body.length > MAX_SECTION_CHARS
  const rest = `read the rest of "${best.heading}" in ${best.file}`
  const note = `[cut at ${MAX_SECTION_CHARS} characters: ${rest}]`
  const shortened = `${best.body.slice(0, MAX_SECTION_CHARS)}\n${note}`
  const body = cut ? shortened : best.body
  const more = ranked.slice(1, 1 + SEE_ALSO).map(r => `- ${title(r.section)}`)
  const also = more.length > 0 ? ['', 'Also matching:', ...more] : []
  return [`From ${title(best)}:`, '', body.trim(), ...also].join('\n')
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
