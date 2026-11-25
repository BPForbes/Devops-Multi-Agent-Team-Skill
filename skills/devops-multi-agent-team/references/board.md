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

## Independence

A team never judges an item it authored. The board enforces this:

- A team that sends a `coder-to-review` or `research-to-coder` hand-off is
  recorded as an author of the goal.
- A seat judges the item when it is the receiving seat of `coder-to-review`,
  `review-to-qa` or `qa-to-security`, or the sending seat of a triage,
  send-back or `security-signoff`. Its team must not be an author team.
- Routing a judge checks the same rule, so a seat cannot be routed in from an
  authoring team.

When resources are low, Orchestration may allow one same-team review with
`board_allow_same_team`, which records a reason. The allowance covers only
that goal and that team, and only one review: the first seat of that
authoring team that judges the goal through it, by a hand-off or a
`work_assign`, in one job, on one item, uses it up (`used_at`, `used_by`,
`judge`, `job`, `item` on the exception). That seat may finish its review:
receive the work, pass it on or send it back. Another seat, another job
(QA cannot also be Security) or another item needs a second allowance,
and no seat may hand judging work to itself. An unrouted hand-off names
no seat yet, so it uses nothing until it is routed. It
does not change the authors.

## Assigned work

Orchestration gives a seat a piece of work on a goal with `work_assign`:
the seat's job (coder, reviewer, qa, security, ...), its agent and team hash,
and a description of what it has to do. Only an unbound server
(Orchestration) may call it, and the server records
`assigned_by: "orchestration"` itself. The seat sees its work with
`devops://work/<agent>`, accepts it with `work_accept`, and reports it done with
`work_complete`. Only the assigned seat can accept or complete its work, and
completing requires accepting first.

A judging job (reviewer, qa, security) cannot go to a team that authored the
goal, under the same rule as hand-offs.

## Reads and writes

Reads are resources, the GET side: `devops://inbox/<agent>`,
`devops://work/<agent>`, `devops://threads/<goal>`, `devops://blame/<goal>`
and `devops://board`. Writes are tools, the POST side: `board_*`,
`handoff_*`, `work_*`, `thread_open`, `thread_reply`, `thread_mark_read`,
`thread_resolve`.

## Threads and unread messages

A thread's participants are its opener and the authors of the goal, plus
anyone who replies. A participant's inbox lists each open thread that has
messages it has not read. Replying marks the thread read for the replier;
`thread_mark_read` marks it read for anyone else.

## Inboxes and push

A seat's inbox is the resource `devops://inbox/<agent hash>`. It holds the
hand-offs addressed to the seat and its open work. A seat subscribes to its
inbox (`resources/subscribe`), and the server sends
`notifications/resources/updated` when the inbox changes, so the seat need not
poll. The server checks the board every two seconds for subscribed inboxes,
because each seat's server process reads the same board file. A subscription
is only for an inbox; other URIs are refused.

## Blame

Every send-back ([handoff-payloads.md](handoff-payloads.md)) carries a blame
tag: the author of the work it returns. The board keeps a ledger of these
(`devops://blame/<goal>`), and each send-back also adds a `sent_back` event to the
goal's history. The author is the seat that signed the virtual push, which
is the coder's agent hash (or the researcher's for a research send-back).
Blame records who wrote the work, not who was at fault: the ledger is for
spotting where rework comes from, and for routing the next item.

## Threads

A thread is a virtual PR conversation on one item: a reviewer's question,
or a QA finding that does not replicate. Any seat may open one, and any seat
may reply, so the seats can go back and forth. Only the seat that opened a
thread resolves it. Threads stay on the board and are not posted to GitHub.
`thread_open`, `thread_reply`, `thread_resolve` and `devops://threads/<goal>` manage them.
A reproduction between seats uses topic `repro` and the hand-off template in
[`commands/repro.md`](../../../commands/repro.md).

## Who reads and changes what

| Seat | Reads | Changes |
|------|-------|---------|
| Orchestration | the whole board | sprints, goal membership, goal states, routing |
| Researcher, Coder, Reviewer, QA, Security | `devops://board`, `handoff_inbox` | its own handoffs (`handoff_send`, `handoff_ack`, `handoff_close`) |

A seat never moves a goal on its own. It sends a handoff, and Orchestration
moves the goal when the hand-off says the step is done. The Done chain is
the one exception, as before for `goal_signoff`: each signer acts for
itself through its own tool (`goal_peer_verify`, `goal_signoff`,
`goal_ba_signoff`, `report_new_approach`), and the board checks who may sign
which step ([scrum-meetings.md](scrum-meetings.md), Done).

## Storage

The board is one file, `devops-skill/thoughts/non-final/board.json`. It is
gitignored with the rest of `non-final/` and is never committed.
