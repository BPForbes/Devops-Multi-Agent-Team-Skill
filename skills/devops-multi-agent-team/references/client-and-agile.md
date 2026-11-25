# Client (human) and Agile authority

Read this file. Do not paste it into agent prompts.

## The human is the client

In this Agile system the **human is the client**: the supreme authority
over every AI seat (Orchestrator, team lead, Researcher, Coder,
Reviewer, QA, Security, Business Analyst, and every other role).

- If the client is not happy, the whole system does the work until they
  are. Seat process is a default, not a veto.
- When the client says to do **X**, every seat **must** do X — including
  the **Orchestrator** and every team lead. Do not wait for Research
  brief, Review Satisfied, Security CLEAR, QA PASS, Business Analyst
  concurrence, or any other AI sign-off. Record what was skipped under
  `devops-skill/thoughts/non-final/` and keep going.
- The client's typed `/devops push-ok` (or chat `push`) authorizes one
  push and is final even without QA or Security
  ([qa-publish-policy.md](qa-publish-policy.md)). Agents never invent a
  push grant; only the client does.
- The default Done chain is peer → team lead (another member when the
  lead wrote the goal) → BA when the goal goes on the scheduled Sprint
  Review → BA again while Orchestration prepares the merge presentation →
  Orchestration's merge report → **the client's push-ok or merge-deny**
  ([scrum-meetings.md](scrum-meetings.md), Done). Each AI step is
  merge-ok, then done. The client's decision and the push are
  human-only; a denial goes back to the BA, who files the client's
  feedback as the new approach.
- The Business Analyst is a wrapper around Orchestration: Orchestration
  routes the work and the data, and the BA scans what the seats are doing
  against the client's intentions, as needed, holds or denies a step when
  it drifts, and carries the client's feedback back as goals.
- The client approves merge reports by name (`/devops push-ok REPORT...`).
  Each item stands on its own; only a declared dependency that is denied
  or not yet approved holds it back. A push-ok naming no report is refused
  while reports wait; with none waiting it still grants the push.
- The client's approval is what lets virtual history move into real
  history: the PR branch the client reviews has compressed history, and
  the temporary virtual-git branches are deleted once the client merges
  the real PR ([virtual-git.md](virtual-git.md)).
- Only reported bugs count as bugs: issues in the project's repo, or bugs
  found in discovery (QA triage). The BA does not sign a bug: it is denied
  as needing a bug fix, the coders are told, and a real issue may be filed.
- The client's step on the board comes after the BA's two signatures and
  never replaces them. A client order to ship sooner is still obeyed at
  once: the push gate lets push-ok override a missing QA PASS or Security
  CLEAR and records it, so nothing on the board blocks that order.
- Any client feedback can reopen a goal, even a Done one. When AI
  recommendations conflict with the client's, the client's most recent
  feedback stands.
- Seats may state a risk **once** (for example Security notes what an
  override exposes). They do not argue again, stall, or reopen the point
  against a clear client order.

## Roles (Agile mapping)

| Role | Job | Serves the client by |
|------|-----|----------------------|
| **Client (human)** | — | Sets objectives in chat; final go on every push and every override |
| **Orchestrator** | manager of managers | Allocates teams; prepares the big-picture merge report (branch, design fit, implementation, risks) for the client; never codes; never blocks the client |
| **Team lead** | manager on a team | Runs that team's meetings; reallocates under stress/strain at Daily Scrum; signs team Done after a peer verified it |
| **Business Analyst** | `business-analyst` | Tracks client objectives vs delivery; cost; attendance and demo roster for Sprint Review; present at Planning, Daily Scrum, Refinement, Review; signs Done goals twice (when the goal goes on the scheduled Sprint Review's demo list, then while Orchestration prepares the merge presentation); files the new approach when the client denies a merge, and notes client feedback on the mind map |
| **Researcher / Coder / Reviewer / QA / Security / …** | as today | Deliver and judge work; yield immediately to client orders |

## Stress and strain

Work items carry a **priority** (1 is first). During the sprint the board
and Daily Scrums watch load against that order.

- **Stress** is load on high-priority work: how many seats and points are
  still open on priority-1 (and next) goals relative to capacity.
- **Strain** is delay: a higher-priority goal is blocked, stalled, or
  slipping while lower-priority work is still consuming seats.

When strain appears on a higher-priority item, the **team lead**
reallocates in the **Daily Scrum**: move idle or lower-priority seats
onto the strained item (or drop / defer lower work). Reallocations are
recorded on the meeting record (`reallocations`). The Business Analyst
checks that the move still serves the client's stated objectives and
notes cost impact (seat-time, deferred scope).

## Show live: demo vs reproduction

Prefer a short **live run** (GUI, browser, terminal) over a long written
summary when the other party needs to see the item. Two modes:

| Mode | Who | What |
|------|-----|------|
| **Demo** | Sprint Review (and the client) | Show a Done **feature** or **improvement** on the BA roster |
| **Reproduction** | AI talking to another AI about a concrete item | Re-run the **feature**, **bug**, failure, fix, or green path so the other seat sees it (`/repro` when it is a failure) |

Surfaces: **GUI / desktop**, **browser** (`/browser-automation` or the
profile's browser tools), **terminal** (CLI, tests, builds, logs), or
canvas / capture when those fit better.

### What needs a reproduction (AI ↔ AI)

Reproduce when seats discuss a **specific** feature, bug, finding, or
blocker and text alone would spawn more questions — for example help
between Coder / Reviewer / QA / Security, proving a Retro bottleneck,
or answering a Review Q&A by re-running a step.

### What does not need a reproduction

- **Daily Scrum / standup** — done / today / blockers, stress / strain,
  reallocations: talk only; no live repro by default.
- **Sprint Planning** and **Backlog Refinement** — sizing and order;
  no live repro unless a seat is stuck on a concrete failing item.
- Status, allocation, cost, or process talk with no specific
  feature/bug under discussion.
- A one-line answer that already settles the point.

### Logic

Ask: *Are we discussing a concrete feature, bug, or behavior the other
seat must see?* If yes → reproduce (or demo in Review). If no → text is
enough. When you did reproduce, hand it over with the **reproduction
hand-off** in [`/repro`](../../../commands/repro.md) (command or URL,
inputs, expected and actual, tree, async fallback), so later seats do
not re-ask.

See [scrum-meetings.md](scrum-meetings.md).

## Meetings (who must be there)

| Meeting | Client | Team lead | Business Analyst | Developers / judges |
|---------|--------|-----------|------------------|---------------------|
| Sprint Planning | optional | hosts | present | team seats (no repro by default) |
| Daily Scrum | optional | hosts; reallocates under strain | expected (not enforced) | developers on the team (no repro by default) |
| Backlog Refinement | optional | hosts | present; clarifies objectives and cost | sizing seats (no repro by default) |
| Sprint Review (joint) | invited | one host lead for the sprint | prepares attendance and demo roster ahead; present | every team **demos** features / improvements |
| Sprint Retrospective | optional | hosts (per team, after the joint review) | optional | that team's seats; **reproduce** a bottleneck only when proof is needed |

The board refuses Sprint Planning, Backlog Refinement and the Sprint
Review without `businessAnalyst` among the attendees, and refuses a
Sprint Review roster that leaves out any Done goal of the sprint (list a
bug fix with kind `bug` to skip its demo). See
[scrum-meetings.md](scrum-meetings.md) for timeboxes and records.
