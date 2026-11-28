// How JSON is passed to agents (references/messages.md). `default` sends a
// payload as one message. `batches` sends a long list as a sequence of
// messages, each holding up to `batchSize` items and its place in the
// sequence, so the receiver reads the first batch and asks for the next only
// when it needs it. The setting lives beside the board. Pure rules.
import path from 'node:path'

import { BOARD_FILE } from './devops-board.mjs'

/** The setting file, beside the board (relative to the project folder). */
export const MESSAGES_FILE = path.join(path.dirname(BOARD_FILE), 'messages.json')
export const BATCHING = Object.freeze(['default', 'batches'])
export const DEFAULT_POLICY = Object.freeze({ batching: 'default', batchSize: 20 })
export const MAX_BATCH_SIZE = 200

/** A policy from a settings object, checked; missing keys take their defaults. */
export function messagePolicy(settings = {}) {
  const policy = { ...DEFAULT_POLICY, ...settings }
  if (!BATCHING.includes(policy.batching)) {
    throw new Error(`batching is one of ${BATCHING.join(', ')}`)
  }
  const size = policy.batchSize
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) {
    throw new Error(`batchSize is a whole number from 1 to ${MAX_BATCH_SIZE}`)
  }
  return { batching: policy.batching, batchSize: policy.batchSize }
}

/**
 * The messages for a list of items: one message in `default`; in `batches`,
 * one message per `batchSize` items, each with its `batch` place
 * ({ index, of }) and the count of items still to come.
 */
export function batchItems(items, policy) {
  const { batching, batchSize } = messagePolicy(policy)
  if (batching === 'default' || items.length <= batchSize) return [{ items }]
  const of = Math.ceil(items.length / batchSize)
  return Array.from({ length: of }, (_, index) => ({
    items: items.slice(index * batchSize, (index + 1) * batchSize),
    batch: { index, of },
  }))
}
