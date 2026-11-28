# Batched messages to agents

Read this file. Do not paste it into seat prompts.

JSON passed to agents is either one message (the default) or **batches**. Set
it with `messages_policy` (`batching` `default` or `batches`, and `batchSize`,
1 to 200, default 20). The setting is kept in `devops-skill/thoughts/non-final/messages.json`.
Rules: `scripts/devops-messages.mjs`.

In `batches`, a long list goes out as a sequence: each message holds up to
`batchSize` items and its place (`batch: { index, of }`). An agent reads the
first batch and asks for the next only when it needs more. That costs a little
more in messages, and saves the tokens of a payload nobody reads in full.

Catalogs are the first messages batched: a catalog with many entries goes out
as several `context.catalog` envelopes, each with its `batch` place. Other JSON
(boards, reports) is still one message; batching them is a later step.
