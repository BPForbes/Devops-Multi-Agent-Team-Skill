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
