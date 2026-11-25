# Scrum meetings

Read this file. Do not paste it into agent prompts.

The **client (human)** is the supreme authority
([client-and-agile.md](client-and-agile.md)). Meetings organise AI work;
they never override a clear client order, and they never change a gate.

Every **authoring** and **judging** team holds its own Sprint Planning,
Daily Scrums, Backlog Refinement and Retrospective. The **Sprint Review
is joint**: one review for the whole sprint, all teams together, hosted
by one allocated lead. The team lead the sprint's allocation names
(the team's manager seat) schedules that team's meetings with
`meeting_schedule` and holds them with `meeting_hold`, recording who
attended, how long it took and what it decided. Orchestration schedules
the first Sprint Planning when it spins up the board
([allocation-research.md](allocation-research.md)). A sprint's meetings
and allocation are read at `devops://meetings/<sprint>`.

| Meeting | When | Timebox | What it records |
|---------|------|---------|-----------------|
| Sprint Planning | start of the sprint, first (per team) | 2 hours per sprint week | sprint goal, backlog goals chosen, tasks; Business Analyst present |
| Daily Scrum | each day (per team) | 15 minutes | done / today / blockers; **stress** and **strain**; lead **reallocations** onto higher-priority work; BA present |
| Backlog Refinement | mid-sprint (per team) | 1 hour per sprint week | upcoming goals clarified, sized (1–13), ordered; BA present (objectives + cost) |
| Sprint Review | near the end, **once for the whole sprint** (joint) | 1 hour per sprint week | BA's attendance and demo roster (ahead); **live demos** of features/improvements via GUI / browser / terminal (bugs optional); AI questions and answers; feedback; new backlog goals |
| Sprint Retrospective | after the joint review, once per team | 45 minutes per sprint week | went well, bottlenecks, at least one agreed improvement; **reproduce** a bottleneck or fix only when proof is needed |

Order: Planning first; Daily and Refinement before the joint Review; one
joint Review for the sprint; then each team's Retrospective. When every
allocated team has held its retrospective, the sprint closes. Unfinished
goals return to the backlog as today.

## Daily Scrum: stress, strain and reallocation

Each developer's update still covers done, today and blockers. In
addition the lead and Business Analyst record:

- **stress** — open load on high-priority goals (priority 1 first): which
  goals, points still open, seats still on them.
- **strain** — higher-priority goals delayed or blocked while
  lower-priority work still has seats.
- **reallocations** — the lead's moves: which agent leaves which work and
  joins which higher-priority goal or job, and why. The BA notes cost
  (deferred scope, seat-time). A move that names `goal` and `job` is
  applied to the board when the meeting is held: the agent gets that
  assigned work (its id lands on the move as `work`), and the open work
  it leaves, named by its work id in `from`, is released. A move with
  only free text `to` stays on the record.

Only the team lead decides a reallocation; the BA does not veto it.

## Demo vs reproduction (live surfaces)

([client-and-agile.md](client-and-agile.md), Show live):

- **Sprint Review** → **demo** Done features / improvements (bugs
  optional) on GUI / browser / terminal.
- **AI ↔ AI** on a concrete feature, bug, finding, or blocker →
  **reproduce** it live (`/repro` for failures) so the other seat sees
  the behavior; cuts questions.
- **Daily Scrum, Planning, Refinement** → **no** reproduction by
  default (status and planning talk). Reproduce only if a seat is stuck
  on a specific failing item in that meeting.

## Sprint Review (joint, all teams)

One Sprint Review per sprint. All teams attend. The Business Analyst
**prepares ahead**:

1. **Attendance** — which agent hashes will attend (every team that has
   Done feature or improvement work should send a demoer).
2. **Demo roster** — who demos which Done goal, and which **surface**
   (GUI, browser, terminal, other). **Bug fixes are not required** in
   the demo; **features and improvements should** be demoed live.
   Every AI seat that can demo does so. The roster lists **every** Done
   goal of the sprint; a bug fix is listed with kind `bug` so it skips
   the demo. The board refuses a roster that leaves a Done goal out.

During the review:

- Demoing teams **run** the rostered work live on the named surface
  (not only describe it).
- Other AI seats **ask questions**; demoing teams **answer**. When the
  answer is about a concrete behavior, **reproduce** that step live
  instead of only explaining in prose. Questions and answers are
  recorded on the meeting (`questions`) and kept for later refinement.
- Feedback and new backlog goals are recorded as today.

## Sprint Retrospective (per team)

After the joint review. Talk is enough for most went-well / actions
items. When a bottleneck or agreed improvement needs proof, the seat
that owns it **reproduces** the failing or fixed path live so the team
does not argue from memory. Record what was shown with the actions.

## Daily Scrum (no repro by default)

Done / today / blockers, stress, strain and reallocations only. Do not
run live reproductions in the standup unless a single concrete failure
is blocking the day and a 30-second terminal or browser run clears it.

## Done: lead signs off; client signs off last

The team lead signs a goal Done (`goal_signoff`) under the same Security
and independence rules as before. That is a **team** Done, not the
client's final word. Orchestration reports to the client; the client's
typed `/devops push-ok` (or chat `push`) on the exact tree is the real
final sign-off before a push, and it is final even without QA PASS or
Security CLEAR ([qa-publish-policy.md](qa-publish-policy.md)). If the
client ordered the work without seat sign-offs, do the work and record
the override; do not stall the meeting process against that order. On
the board the client's own Done is `clientSignOff`, which records every
skipped check ([client-and-agile.md](client-and-agile.md)).

Only the lead holds a meeting, attendees are agent hashes (the BA's
hash among them, named as `businessAnalyst`, is required for Planning,
Refinement and Review, and checked at Daily when named), and a meeting
that runs past its timebox is refused.
