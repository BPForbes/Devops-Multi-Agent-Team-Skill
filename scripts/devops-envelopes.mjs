// Typed seat envelopes: validates a message against the schema in
// docs/schemas/envelopes.schema.json (see docs/orchestrator-design.md).
// Pure: reads the schema file once, validates the value it is given.
import fs from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const SCHEMA_PATH = new URL('../docs/schemas/envelopes.schema.json', import.meta.url)

const KIND_SHAPE = /^[a-z]+\.[a-z.-]+$/

let compiled

function validator() {
  if (compiled === undefined) {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    compiled = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')))
  }
  return compiled
}

/** Returns { ok, errors }. Unknown kinds, unknown versions and bad ids are refused. */
export function validateEnvelope(envelope) {
  const check = validator()
  const ok = check(envelope) === true
  const errors = ok ? [] : (check.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`)
  return { ok, errors }
}

/** The envelope kinds the schema accepts, from its own definitions. */
export function envelopeKinds() {
  const kinds = new Set()
  const walk = node => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      const kind = node.const
      if (typeof kind === 'string' && KIND_SHAPE.test(kind)) kinds.add(kind)
      Object.values(node).forEach(walk)
    }
  }
  walk(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')).$defs)
  return [...kinds].sort()
}
