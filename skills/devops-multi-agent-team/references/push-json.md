# Push JSON (notification index, not the review)

Coder and Reviewer bounce a **Push JSON** until both are happy.
Companion to the review thread and Handoff — not a replacement.
Reviewers **always** compare it to the side-branch tree vs
`<integration-base>` ([side-work.md](side-work.md)). An omitted
or wrong hunk is a finding. Do not mark Satisfied from the JSON
alone.

`devops-skill/thoughts/non-final/` is **gitignored**. Do not
`git add` Push JSON.

| File | Who | When |
|------|-----|------|
| `push-agent-<hex>.json` | the Coder agent | Latest mock (`push-agent-<hex>-<topic>.json` when the seat works several items). Overwrite in place. Either side may update it; `seat` names who last did. Register an `item-…` hash + notes. |
| `push-agent-<hex>-r<N>.json` | optional | Keep a round if bounce needs history. |

## First handoff (required)

- Coder writes `push-<seat-id>.json` **before the first review**,
  with a Handoff `To: Reviewer`. `closes` may be `[]`.
- Reviewers do not start without that file. Update it on every
  rewrite. Either side may Push when they have something new.
- Open `qa` rows must be answered or withdrawn before Satisfied.
  Coders may open rows (`from`: the Coder's seat id) to ask Reviewers for
  clarification. Satisfied does **not** authorize a git push.

## Q&A

Same ids in the thread `## Q&A` table and the JSON `qa` array.
`status` is `open`, `answered`, or `withdrawn`. A Q&A-only bounce
may set `"files": {}`. Do not invent a commit to record an answer.
Each `qa` row: `id`, `from`, `to`, `ask`, `answer`, `status`;
`from` and `to` are agent hashes
([role-identity.md](role-identity.md), Identity hashes), or a job
when the addressee is not chosen yet.

## Shape

Valid JSON. File paths are object keys. Hunks are
`{ op, lines, why }`. Each file ends with `delta` `+N/-M`.
`op` is `-` (old), `+` (new), or `~` (same span, behavior change).
`lines` is a single line or `start-end`. Index the side-branch
tree vs `<integration-base>`, not `git show HEAD` alone.

Top-level keys: `topic`, `round`, `item` (shared item hash),
`notes` (one line on what this Push JSON is for), `seat` (agent
hash that wrote this version), `team` (that agent's team hash),
`authors` (agent hashes of everyone who wrote the change), `teams`
(team hashes of those authors), `to` (agent hash or job),
`notifies` (agent hashes or jobs), `closes`, `qa`, `comments`,
`docs`, `lint`, `formal`, `files`.

`lint` records the lint gate ([lint-rules.md](lint-rules.md)):
`{ "builtIn": { "verdict": "PASS", "blocking": 0 }, "tools": [{ "command": "ruff check .", "exit": 0 }] }`.
`tools` has one row per command from `lint_commands`, run in the sandbox, with the
command text exactly as listed. `lint_check` with `push` blocks a missing row
(`linter-not-run`) and a non-zero exit (`linter-failed`).

`formal` (optional; only when Lean is on, [formal-check.md](formal-check.md)) is one row per advanced claim:
`{ "id": "F1", "claim": "...", "status": "proved" | "disproved" | "not-attempted" | "gave-up", "lean": "path",
"writeup": "path", "covers": "path:line", "notCovers": "...", "counterexampleTest": "path:line" }` (the last only for
`disproved`). Paths are inside the project. `formal_check` with `push` validates the rows; a row marked `proved`
whose Lean file has a `sorry`, `admit` or `axiom` is a blocking finding. Basic logic gets no row.

`comments` is the **comment budget**: one row per comment (or run of
comment lines) the change adds, `{ "file", "line": "12" or "12-15", "why" }`,
where `why` is what the code cannot say. `[]` means the change adds no
comments, which is the default. A comment not listed is a blocking finding
(`comment_audit` with `listed` checks it). Each `why` answers the comment
gate ([comment-standards.md](comment-standards.md) 0a): what it adds beyond the
executed code, or which design choice it names. Questions never go here or in
code: use `qa`.

`docs` is the **doc budget**: one row per documentation section the change adds
or edits, `{ "file", "section", "from": "path:line" | null, "why", "new"? }`.
`from` is the comment the text replaced, if any; `why` says why it is durable,
shared knowledge rather than a comment ([comment-standards.md](comment-standards.md)
6b). `new` is set only on a new doc file and names the new system or module it
documents; existing docs are updated instead. `[]` is the default.
`comment_audit` with `docs` blocks a doc file the change touches that no row
lists, and always blocks a new doc file without `new`. Example head:
`"seat": "agent-0a0a0a", "team": "team-1a2b3c",
"authors": ["agent-0a0a0a"], "teams": ["team-1a2b3c"],
"to": "agent-0b0b0b"`. Reviewers use `authors` / `teams`, unioned
with the Handoff `Authors:` / `Teams:` lines
([role-identity.md](role-identity.md), Identity hashes), for the
independence check (own agent and own pod both refused). `seat`
replaces the old `from`. Hunks index the side-branch
working tree vs `<integration-base>` when there is no shared
commit yet ([side-work.md](side-work.md)). Example hunk:
`{ "op": "+", "lines": "12-20", "why": "…" }` then `"delta": "+9/-2"`.
