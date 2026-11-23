# Goal board and sprints

The goal board is where sprints and goals live. Any seat can read it.
Only the orchestration server writes it, through the `board_*` tools
(`mcp/server.mjs`). It is the team's shared view of the work, in the same
way a story board is for a product team.

Read this file. Do not paste it into agent prompts.

## Shape

- **Sprint**: a named batch of goals, `sprint-<6 hex>`. Opened with
  `board_create_sprint`. Goals are moved between sprints, and a goal is in
  one sprint at most.
- **Goal**: a goal hash from the goal memory file ([goal-hashes.md](goal-hashes.md)),
  with a title, a state and a history. It is put on the board with
  `board_add_goal` (into a sprint, or the backlog).
- **Handoff**: a payload sent through the server, shown on the board until
  it is done ([handoff-payloads.md](handoff-payloads.md)).

## Goal states

A goal moves one step at a time along:

`backlog` → `ready` → `in_progress` → `review` → `qa` → `security` → `done`

A goal may go to `blocked` from any state and return to the state it left.
`board_move_goal` refuses a jump that skips a step. The step names match the
hand-off kinds, so the board tells a reader which hand-off is next.

## Blame

Every send-back ([handoff-payloads.md](handoff-payloads.md)) carries a blame
tag: the author of the work it returns. The board keeps a ledger of these
(`blame_list`), and each send-back also adds a `sent_back` event to the
goal's history. The author is the seat that signed the virtual push, which
is the coder's agent hash (or the researcher's for a research send-back).
Blame records who wrote the work, not who was at fault: the ledger is for
spotting where rework comes from, and for routing the next item.

## Threads

A thread is a virtual PR conversation on one item: a reviewer's question,
or a QA finding that does not replicate. Any seat may open one, and any seat
may reply, so the seats can go back and forth. Only the seat that opened a
thread resolves it. Threads stay on the board and are not posted to GitHub.
`thread_open`, `thread_reply`, `thread_resolve` and `thread_list` manage them.

## Who reads and changes what

| Seat | Reads | Changes |
|------|-------|---------|
| Orchestration | the whole board | sprints, goal membership, goal states, routing |
| Researcher, Coder, Reviewer, QA, Security | `board_view`, `handoff_inbox` | its own handoffs (`handoff_send`, `handoff_ack`, `handoff_close`) |

A seat never moves a goal on its own. It sends a handoff, and Orchestration
moves the goal when the hand-off says the step is done.

## Storage

The board is one file, `devops-skill/thoughts/non-final/board.json`. It is
gitignored with the rest of `non-final/` and is never committed.
