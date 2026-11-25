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
- On the board, the client may sign a goal Done without the seat chain
  (`clientSignOff` in `scripts/devops-scrum.mjs`). It needs a reason and
  the risk the client accepts, and it records every unmet check as
  `override.skipped` on the goal and its done report. A skipped check is
  never reported as a pass. Only the person reaches it; no seat tool
  calls it. (Wiring it to a human-only `/devops` word is still open.)
- Seats may state a risk **once** (for example Security notes what an
  override exposes). They do not argue again, stall, or reopen the point
  against a clear client order.

## Roles (Agile mapping)

| Role | Job | Serves the client by |
|------|-----|----------------------|
| **Client (human)** | — | Sets objectives in chat; final go on every push and every override |
| **Orchestrator** | manager of managers | Allocates teams; reports up; never codes; never blocks the client |
| **Team lead** | manager on a team | Runs that team's meetings; reallocates under stress/strain at Daily Scrum; signs team Done and reports up |
| **Business Analyst** | `business-analyst` | Tracks client objectives vs delivery; cost; attendance and demo roster for Sprint Review; present at Planning, Daily Scrum, Refinement, Review |
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
enough. Record commands, URL, or path under thoughts when you did
reproduce, so later seats do not re-ask.

See [scrum-meetings.md](scrum-meetings.md).

## Meetings (who must be there)

| Meeting | Client | Team lead | Business Analyst | Developers / judges |
|---------|--------|-----------|------------------|---------------------|
| Sprint Planning | optional | hosts | present | team seats (no repro by default) |
| Daily Scrum | optional | hosts; reallocates under strain | present | developers on the team (no repro by default) |
| Backlog Refinement | optional | hosts | present; clarifies objectives and cost | sizing seats (no repro by default) |
| Sprint Review (joint) | invited | one host lead for the sprint | prepares attendance and demo roster ahead; present | every team **demos** features / improvements |
| Sprint Retrospective | optional | hosts (per team, after the joint review) | optional | that team's seats; **reproduce** a bottleneck only when proof is needed |

See [scrum-meetings.md](scrum-meetings.md) for timeboxes and records.
