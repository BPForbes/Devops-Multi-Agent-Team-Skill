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

## Live demos (GUI, browser, terminal)

AI seats **show** work live to other seats and to the client when that
cuts questions. Prefer a short live run over a long written summary.

| Surface | Use when |
|---------|----------|
| **GUI / desktop** | The change is a desktop or host UI; drive the app where the host can see it |
| **Browser** | Web UI, docs pages, local preview, deployed preview; use the host's browser MCP (`/browser-automation` or the profile's browser tools) |
| **Terminal** | CLI, scripts, tests, builds, logs, CI job output; run the commands live and point at the result |
| **Other** | Canvas, video, or screen capture when the host offers them and a live surface is a poor fit |

**When (as needed):**

- **Sprint Review** — features and improvements: live demo on the
  roster (bugs optional).
- **Sprint Retrospective** — when a bottleneck or improvement needs
  proof, show the failing or fixed path live instead of only describing it.
- **Help between seats** — when a Coder, Reviewer, QA, Security or
  other seat is stuck or explaining a finding, demo the repro, the
  green path, or the failing command so the other seat sees it.
- **Daily / ad hoc** — only when a short live show unblocks the team
  faster than text.

Every AI that can demo **should** demo when asked or when the roster
names them. Record what was shown (commands, URL, or path) in the
meeting record or under thoughts so later seats do not re-ask.

See [scrum-meetings.md](scrum-meetings.md).

## Meetings (who must be there)

| Meeting | Client | Team lead | Business Analyst | Developers / judges |
|---------|--------|-----------|------------------|---------------------|
| Sprint Planning | optional | hosts | present | team seats |
| Daily Scrum | optional | hosts; reallocates under strain | present | developers on the team |
| Backlog Refinement | optional | hosts | present; clarifies objectives and cost | sizing seats |
| Sprint Review (joint) | invited | one host lead for the sprint | prepares attendance and demo roster ahead; present | every team **live**-demos features / improvements |
| Sprint Retrospective | optional | hosts (per team, after the joint review) | optional | that team's seats; live demo bottlenecks when needed |

See [scrum-meetings.md](scrum-meetings.md) for timeboxes and records.
