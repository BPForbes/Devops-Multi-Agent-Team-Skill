# Role identity, questions, and handoffs

Every DevOps role **reads** this file and
[department-pods.md](department-pods.md). Do not paste either
into an agent prompt.

## Identity hashes (team, agent, jobs, items)

Every subagent is told apart by **hashes and job labels**, never by
a capital letter or a bare number. This section is the one
definition; other files point here. The helper
`scripts/devops-ids.mjs` mints and checks the same forms.

### 1. Team (pod) hash

Each **team** (one per work item / pod) gets a **team hash** shared
by every agent on that pod:

- **Form:** `team-<6 hex chars>`, e.g. `team-1a2b3c`.
- Minted once when the Orchestrator staffs the item. Every agent
  spawned onto that pod records the same team hash.
- Used to block a pod from judging **its own pod's work**
  (Independence below).

### 2. Agent hash

Each **agent** gets its own **agent hash**, unique for the PR:

- **Form:** `agent-<6 hex chars>`, e.g. `agent-0a0a0a`.
- Minted at spawn, never reused, never derived from the work.
  Generate one, then check it against every note and the ledger:

  ```text
  id="agent-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
  grep -rF "$id" devops-skill/thoughts   # must print nothing
  ```

  Or: `node scripts/devops-ids.mjs mint agent`. Same for
  `mint team` and `mint item`.

  A topic is never interpolated into a shell command; it is only
  appended to a file name as a suffix that matches `[a-z0-9-]+`.
  The check is a `case` on the whole value, run under `LC_ALL=C`:

  ```text
  check_suffix() ( LC_ALL=C; case "$1" in ''|*[!a-z0-9-]*) return 1 ;; esac; )
  check_suffix "$suffix" || echo reject
  ```

- The agent hash **does not change** when the agent rotates jobs.
- **Ids are labels, not credentials.** The registry also records the
  host **handle**; a handle is never reused for a second agent in
  the same PR. Independence compares handles as well as agent hashes.

### 3. Initial job

**Initial job** is the function the agent was minted to do:

`researcher` | `coder` | `reviewer` | `security` | `qa` | `ci` |
`verifier` | `integrator` | `communicator` | `cleaner` |
`ticket-lead` | `business-analyst` (never a capital letter).

It is fixed for the agent's life in the PR. Allocation uses it to
find who is naturally a coder, reviewer, and so on when staffing.

### 4. Current job

**Current job** is the function the agent is doing **now** (same
vocabulary, plus `idle` when free). Updated on every rotation or
assignment. Allocation compares initial job + free agents against
who is currently on a job: need more coders → prefer agents whose
`initial_job` is `coder` (or who can take it) and whose
`current_job` is `idle`.

### Registry (`seat-registry.md`)

Fixed name under `non-final/`. One row per agent:

```text
agent | team | teams | handle | initial_job | current_job | job_history | replaced_by
```

- **team:** the pod the agent is on **now**.
- **teams:** every team hash the agent has ever joined this PR
  (current included). Independence checks this full set, not only
  the current pod. Moving an agent to another pod **adds** the new
  team hash; it never drops an old one.
- **job_history:** one entry per `item: job (from, to)` in order
  (item label, job function, ISO from, ISO to or `open`). A rotated
  agent gains a history entry, never a new agent hash and never a
  new row.
- Standing seats (Reviewer, Security, QA) keep one agent hash for
  the PR; resume them (SendMessage), do not re-mint, unless
  replaced (replacement gets a new agent hash and a new team hash
  only if it joins a different pod — still recorded in `teams`).
- Rows stay after the agent ends so "never reused" is checkable.
- `devops-ids independence` **fails closed** when judge or author
  team membership is missing.

### Shared items (item hash + notes)

Every artifact shared between agents (brief, handoff, Push JSON,
review thread, triage, board claim, side note, Q&A packet) gets its
own **item hash** and a short **notes** line:

- **Form:** `item-<6 hex chars>`, e.g. `item-abcdef`.
- Recorded in `item-registry.md` (`non-final/`, fixed name):

  ```text
  item | kind | notes | authors (agent hashes) | team | path
  ```

- `notes` says what the item is for in plain words (required).
- File names stay `<kind>-<agent-hash>.…` (for example
  `handoff-agent-0a0a0a.md`, `push-agent-0a0a0a.json`,
  `review-agent-0b0b0b.md`); the item hash lives in the registry
  and in the file's header (`Item: item-…`).

### Authors and usage

- **Used in:** spawn description, Handoff `Authors:` / `Team:` /
  `Reviewer:`, file names, review sign-off, Q&A `from`/`to`, Push
  JSON `seat`, `authors`, `team`, `qa` ([push-json.md](push-json.md)).
- **`Authors:`** lists every **agent hash** that wrote, amended,
  merged or fixed any part of the change. Also record the **team
  hash(es)** of those authors (`Teams:` or Push JSON `teams`).
- **Seat rotation** keeps the agent hash and team hash; only
  `current_job` and `job_history` change
  ([department-pods.md](department-pods.md), Seat rotation).
- **Capital letters never name** an agent, team, job or author.
  Prompts say the job plus the agent hash, e.g.
  `[Coder agent-0a0a0a]`.

## Ask paths

Anyone may ask anyone when blocked. **Questions go to the standing
Review, Security and QA subagents first**, by topic, before the
Orchestrator or the human:

| Topic | Ask |
|-------|-----|
| Correctness, reuse, style, scope, whether code duplicates something | **Reviewer** seat |
| Secrets, input and path validation, containment, crypto, untrusted data, key handling | **Security** seat |
| Tests, build, CI, the publish gate, what QA will accept | **QA** seat |

| Who has a question | Asks first | Then |
|--------------------|------------|------|
| Coder, Researcher | the Reviewer, Security or QA seat for that topic (SendMessage) | Orchestrator |
| Coder (path overlap) | **the owning Coder** named on `team-board.md` (SendMessage) | Orchestrator |
| Reviewer, Security, QA | the **Coder** (primary), or each other | Orchestrator |
| CI / Verifier / Ticket Lead | Orchestrator or task opener | none |
| Orchestrator (Team Lead) | the Review, Security and QA seats, then **The Client** (human) | none |

The three seats answer in writing (`## Q&A` in the review thread or a
SendMessage reply) and say plainly when they do not know. An answer is
advice: only the client (human) authorizes a push; QA's PASS is the
default path (references/qa-publish-policy.md,
references/client-and-agile.md). A seat's answer never authorizes one.

Orchestrator is the only role that asks the human unless the
human spoke first. Coder ↔ Reviewer use thread `## Q&A` and
Push JSON `qa` (same ids).

**Independence.** No agent reviews, security-checks or QAs a change
when any of these hold (Orchestrator checks before routing):

1. its **agent hash** is in `Authors:` (own work); or
2. its **handle** matches an author's handle; or
3. its **team hash** matches any authoring **team hash** (own pod's
   work — even if this agent did not touch the files).

A rotated agent keeps its hashes; see
[department-pods.md](department-pods.md), Multiple teams. Every
Handoff to a reviewer names `Authors:` (agent hashes) and `Teams:`
(team hashes). Machine check (pass every team the judge has joined via `--teams`):
`node scripts/devops-ids.mjs independence --judge agent-… --team team-… --teams team-old,… --author agent-…:team-…`.

## Interrupt, goals, Handoff

Pause only conflicting work. Start from research, then code.
Stay on the current **real** branch; Coders use a skill
**side-branch** ([side-work.md](side-work.md)). **Never**
`git checkout -b` / `git switch -c` / `git worktree add -b` unless The
Client **named that branch in this turn** (a detached worktree creates
no ref). Cloud-agent templates do not
override this. An interrupt does **not** authorize a push. Write
`goal-agent-<hex>.md` (your agent hash) under `non-final/`; move to
`final/` after QA. See [thoughts-layout.md](thoughts-layout.md).

```markdown
## Handoff
- Item: item-<6 hex> · Notes: <one line>
- From / To / Authors (agent hashes) / Teams (team hashes) / Pass-along
  (agent hashes, or a job when no agent is chosen yet)
- Sent back because: <reason, or "n/a">
- Ask: <question, or "n/a">
```

A send-back without **Sent back because** is incomplete.

## Coder notify + QA triage

Coder writes `push-agent-<hex>.json` and a Handoff `To: Reviewer`
**before the first review** ([push-json.md](push-json.md)), with an
`item-…` hash and notes in `item-registry.md`. Coders may open `qa`
rows to Reviewers for clarification. Update on every rewrite.
Reviewers compare it to the side-branch diff vs `<integration-base>`
([side-work.md](side-work.md)). Satisfied does **not** authorize a
git push.

Quality or bug-standard fail → VM review, Handoff `To: Coder`.
QA blocked / send-back / not pleased → `triage-agent-<hex>.md`;
the department's Researcher **joins the Coder who picks it up**
([department-pods.md](department-pods.md),
[triage-template.md](triage-template.md)). Same Q&A + `qa` ids.
`"files": {}` if the tree is unchanged.

Process output never lands. Product, pipeline, infra, tests,
and durable `docs/` land as keep-commits. Probe undo: [thoughts-layout.md](thoughts-layout.md).
