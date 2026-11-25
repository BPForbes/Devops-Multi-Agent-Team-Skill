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

## Done: the sign-off chain; client decides last

A goal goes Done through an ordered chain of signatures, each recorded
on the goal (`signoffs`, plus a `<step>_signoff` history event). Every
step's signer runs two words, in order: **merge-ok** (`goal_merge`,
decision `ok`), then **done** (`goal_done`), which promotes the goal to
the next signature. A signer who rejects the work runs **merge-deny**
(`goal_merge`, decision `deny`) with a reason instead.

**The BA scans as needed.** Every merge-ok pings the goal's Business
Analyst (the one the building team named at Sprint Planning): the ping is
recorded on the goal (`pings`, a `ba_pinged` history event) and listed
under `baPings` in `devops://reports` until the BA scans that step.
merge-ok does not wait for a scan. The BA scans what is being merged when
it sees a need, checking that it matches the client's intentions
(`goal_scan`): `ok`, or `hold` or `deny` with a reason. While the BA's
latest scan of the step holds or denies it, merge-ok on that step is
refused; a later `ok` scan lifts it. A scan never reopens the goal
(merge-deny does), and the BA signing its own step pings no one. The
client's push-ok is not held by a scan.

1. **Peer**: when a member believes the goal is done, it looks for
   another member of its own team first (team members work on the same
   thing), and asks Orchestration only when none is free. The verifier
   wrote none of the goal, is not the lead, and acts under the building
   team's hash (and is on the team board's member list when the team has
   one). The goal has passed security; a later send-back voids the
   verification.
2. **Team lead**: the lead signs under the same Security and independence
   rules as before, and only after a current peer verification. If the
   lead worked on the goal, another member of the team (not the peer)
   signs this step instead. The goal becomes `done` (team Done), and a
   done report is filed as `awaiting_ba`. `goal_signoff` is this step's
   done on its own.
3. **BA, first signature**: when a worthy item (usually a feature, not a
   bug) can be demoed and is put on the sprint's **scheduled** Sprint
   Review. The signature records the demo entry (`kind`: feature,
   improvement or bug; optional `surface`). Report: `ba_signed`. The BA is
   the one the building team named at its Sprint Planning.
4. **Orchestration prepares** (`report_prepare`): Orchestration starts the
   merge presentation for the reports the BA signed. Report: `preparing`.
5. **BA, second signature**: while Orchestration prepares the merge
   presentation. Report: `to_orchestration`.
6. **Merge report** (`report_forward`): Orchestration delivers the big
   picture: the real branch, how the work fits the overall design, the
   implementation summary and the risks. Report: `to_person`.
7. **Client** (the person only): `/devops push-ok` (or chat `push`,
   `/devops merge-ok`, `/devops done`) approves every merge report waiting
   for it, signs the last step, and grants one push of the current tree
   through the push gate. Report: `approved`. `/devops merge-deny REASON`
   withdraws the push grant and sends the report back to the BA. Report:
   `denied`.
8. **New approach** (`report_new_approach`): after a denial the BA, on
   standby, asks the client why if the reason is unclear, then turns the
   feedback into new backlog goals (objective, acceptance criteria,
   optional priority and owner), linked to the report (`from_report`) and
   carrying the client's reason (`client_feedback`). Report: `reworked`.
   The BA notes the feedback on the mind map (`mindmap_note`); the
   Researcher still builds and structures the map.

**merge-deny and reopening.** QA, Review and Security send work back with
their existing send-back hand-offs, which carry the reason. On the chain,
merge-deny by a step's signer reopens the goal: it returns to
`in_progress`, its verdicts and signatures start over, and its live report
becomes `reopened`. Any feedback can reopen a goal: the building team's
BA (for example after Sprint Review feedback) or the client may deny any
step, even on a Done goal. A Done goal that is reopened is flagged
`needs_client_review`: the BA asks Orchestration to have the client review
the recommendations. Where an AI recommendation conflicts with the
client's, the client's most recent feedback stands. The BA follows up on
the reason for every denial; any seat that needs clarification asks
through a board thread or a hand-off.

The lead's Done is a **team** Done, not the client's final word. The
client's typed `/devops push-ok` (or chat `push`) on the exact tree is the
real final sign-off before a push, and it is final even without QA PASS
or Security CLEAR ([qa-publish-policy.md](qa-publish-policy.md)). If the
client ordered the work without seat sign-offs, do the work and record
the override under `devops-skill/thoughts/non-final/`; do not stall the
meeting process against that order. The board's client step comes only
after the BA's two signatures; it never replaces them
([client-and-agile.md](client-and-agile.md)).

Only the lead holds a meeting, attendees are agent hashes (the BA's
hash among them, named as `businessAnalyst`, is required for Planning,
Refinement and Review, and checked at Daily when named), and a meeting
that runs past its timebox is refused.
