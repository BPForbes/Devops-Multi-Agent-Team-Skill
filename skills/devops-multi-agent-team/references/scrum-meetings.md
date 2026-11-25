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

## Bug flow: from the Daily Scrum to the board

1. **Raise it at the Daily Scrum.** Whoever finds a bug raises it with
   the team at the next Daily Scrum. The team discusses it, and the record
   keeps it under `bugs`: the finder's agent hash, a title, how the code
   behaves now (`behavior`), how it should behave (`expected`), the
   possible solutions (one or more) and code snippets, and the goal it
   touches when there is one.
2. **The BA reports it to the client.** The BA, attending that standup,
   contacts the person through Orchestration with a bug report
   (`bug_report`, a `bug.report` envelope): the issue, the reason for the
   report, the proposed solution(s), the files, lines and code snippets,
   an easy-to-read explanation and the plan of attack. Report:
   `bug_to_person`.
3. **The client decides.** The person types
   `/devops bug REPORT fine` (the behavior is fine; nothing more happens),
   `/devops bug REPORT fix N` (use proposal N) or
   `/devops bug REPORT fix YOUR ALTERNATIVE`. Only the person may answer.
   Report: `bug_fine` or `bug_fix`.
4. **The team lead makes the issue.** From the BA's report and the
   client's choice, the team lead adds the issue to the board
   (`bug_issue`): a backlog goal of kind `bug` with the issue draft
   (`issue_draft`: title and body opening with the work item,
   `Work item: goal-<hex> (bug)`, then the explanation, now/expected, the
   client's fix, the plan, files, lines and snippets) and the client's
   choice (`client_feedback`). Filing that draft as an issue in the
   project's repo is the team lead's job, outside the board and outside
   this branch; the board never files it. Report: `issue_drafted`.
5. **The team lead records the real issue.** Once filed, the lead records
   its number (`bug_filed`). A real issue is titled `#<number>
   <description>`: the bug goal and its draft take that title, the goal
   keeps the number (`issue`), and the goal the bug touches lists it
   (`bug_issues`). A title without the number and a description, or a
   body that does not name the work item hash, is refused. The work item
   stays of kind `bug`. A listed issue stops counting as a reported bug
   once its bug goal is done.
6. **The team lead assigns it, without overworking the team.** The lead
   may give the bug goal to a seat at once (`assign`), or leave it in the
   backlog for planning. Work that would take a seat past three open
   pieces (assigned or accepted; `OPEN_WORK_LIMIT`) is **held** and goes
   to the team's BA (a `load` ping in `devops://reports`), who checks it
   against the client's objectives (`work_decide`): approve gives it to
   the seat, decline drops it with a reason. When the BA cannot decide,
   it asks the client through Orchestration (`ask`, a load report); the
   person answers `/devops load REPORT approve|decline [REASON]`. Until
   then the seat does not see the work. This holds for any assignment,
   not only bugs.

While the client's fix is open, the bug counts as a reported bug on the
goal it touches, so the BA does not sign that goal (see the chain below).

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
   A goal the client marked Done past missing Review, QA or Security
   checks is listed as Done. The roster does not show those checks as
   passed; the risk record on the goal says they were skipped.

**Team schedule.** Meetings look at a team as a whole by its team hash.
The board keeps a joint table for the sprint (`teamSchedule`, read at
`devops://meetings/<sprint>` as `schedule`): for each team hash, its lead,
the goals it builds and judges, the tasks it planned at Sprint Planning and
its demos. A held Daily Scrum records its team's row (`schedule`); the
Sprint Review records every team's. A single seat, such as the demoer, is
still named by its own agent hash.

During the review:

- Demoing teams **run** the rostered work live on the named surface
  (not only describe it).
- Other AI seats **ask questions**; demoing teams **answer**. When the
  answer is about a concrete behavior, **reproduce** that step live
  instead of only explaining in prose. Questions and answers are
  recorded on the meeting (`questions`) and kept for later refinement.
- Feedback and new backlog goals are recorded. A goal added here
  states its client `objective`, its `acceptance` criteria, its
  `priority` (1 is first) and its `owner` team. The board refuses one
  that omits any of those. Refinement still accepts objective,
  acceptance and owner when they are supplied; priority is required
  there already. A new approach after a denial still requires only
  objective and acceptance; priority and owner stay optional on that path.

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
step's signer runs two words, in order: **merge-ok**, then **done**,
which promotes the goal to the next signature. A signer who rejects the
work runs **merge-deny** with a reason instead. A role's approval is its
sign-off: merge-ok and done are recorded as that role's signature.

**Each seat types the command.** A seat types `/devops merge-ok GOAL`,
`/devops merge-deny GOAL REASON` or `/devops done GOAL` for its own step
(the BA's first `done` adds `--demoer AGENT` and `--meets`). The hook runs it on the board as the seat the
session was bound to (`DEVOPS_SEAT`, and `DEVOPS_TEAM`) through
`scripts/devops-chain.mjs`; Orchestration routes the data from there. The
same steps are the `goal_merge` and `goal_done` tools. A seat's typed
word never grants a push: only words the person types (the composer
origin) do, and a seat session without `DEVOPS_SEAT` is refused.

**Signature envelopes.** Every signature item is one `chain.signature`
envelope (`docs/schemas/envelopes.schema.json`, `Signature`) in the
board's `signatures`: merge-ok and merge-deny (`ok`, `deny`), each done
(`signed`), the BA's scan (step `scan`), Orchestration's merge report
(step `report`, signer `orchestration`) and the client's decision (signer
`client`). The goal's `signoffs`, `reviews` and `scans` point to their
envelope (`sig`). Envelopes stay when a goal is reopened.

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
3. **BA, first signature**: when a worthy item (a feature or an
   improvement) meets the client's expectations and can be demoed on the
   sprint's **scheduled** Sprint Review. The goal must state its objective
   and acceptance criteria, and the BA confirms the goal meets them, by
   task (`meets`); the check is recorded (`expectations`). The signature
   records the demo entry (`kind`: feature or improvement; the demoer's
   agent hash; optional `surface`). Report: `ba_signed`. The BA is the one
   the building team named at its Sprint Planning.

   **Signing a bug goal** (`kind: bug`). A bug has no demo. When fixing
   it is the client's objective (the goal states its objective and
   acceptance criteria), the BA signs it against them (`meets`). When it
   was found during development (no client objective), the seat that
   signed the lead step first raises it to the BA with a reason
   (`/devops raise GOAL REASON`, `goal_raise`); the raise is recorded
   (`raised`) and pings the BA, and the BA's signature carries it.

   **An unfixed reported bug is not signed.** Only reported bugs count: an
   issue in the project's repo that the goal lists (`bugIssues` at
   Refinement or Sprint Review, stored as `bug_issues`), a bug found in
   discovery (QA's triage hand-off on the goal that is not done; see
   `/triage`), or a bug report on the goal the client had fixed whose bug
   goal is not done. While one is open, the BA's merge-ok or done is
   recorded as **merge-deny** with the reason `bug fix needed` (and the
   bugs). The goal reopens and goes back to the **backlog** (out of the
   sprint) until the bug is fixed, and the coders are told through a
   `bug fix needed` thread on the goal in their inbox. The goal records an
   issue draft (`bug_fix.issue_draft`) the team lead may file in the
   project's repo, and the fix is planned like other work. The same holds
   at the BA's second signature. QA signs before the BA, so this is rare.

   **BA override for a big matter.** The BA may sign over open reported
   bugs when the matter is big enough: merge-ok and done with
   `--override REASON` (`override` on `goal_merge` and `goal_done`). The
   reason is required and the signature envelope records it with the bugs
   it signs over (`override: { reason, bugs }`).
4. **Orchestration prepares** (`report_prepare`): Orchestration starts the
   merge presentation for the reports the BA signed. Report: `preparing`.
5. **BA, second signature**: while Orchestration prepares the merge
   presentation. Report: `to_orchestration`.
6. **Merge report** (`report_forward`): Orchestration delivers the big
   picture: the real branch, how the work fits the overall design, the
   implementation summary and the risks. Report: `to_person`.
7. **Client** (the person only): `/devops push-ok REPORT...` (or
   `merge-ok`, `done` with report ids) approves the named merge reports,
   signs their last step, and grants one push of the current tree through
   the push gate. Report: `approved`. When that push happens, each named
   report records who pushed it, when, and the tree (`pushed_by`,
   `pushed_at`, `pushed_tree`). An item is judged on its own: unrelated
   reports, denied or unsigned, never block it. Only a goal it depends on
   (`depends_on`, set from `dependsOn` at Refinement or Sprint Review) can:
   a dependency that is denied or not yet approved refuses the approval
   and grants no push. The person may add `--risk REASON` (quote it when
   it has spaces), and `--goal GOAL` for a goal the lead cannot mark Done
   because Review, QA or Security has not handed it on. That writes a risk
   record — who (the client), when, which checks or which dependency were
   skipped, and the reason — on the goal, on the merge report, and in a
   `chain.signature` envelope (`verdict: skipped`, via `recordSignature`).
   A skipped check is never stored as a pass in verdicts, the report, the
   demo roster or the merge report. `--goal` alone records the risk and
   grants no push; the lead may then sign. A seat (`DEVOPS_SEAT`, including
   `merge-ok` and `done`) cannot pass `--risk`. A bare push-ok (or chat `push`) naming no report
   is refused while merge reports wait for the client: it must name the
   ones it approves. With no report waiting, the bare word still grants
   the push (the client override) and approves nothing.
   `/devops merge-deny [REPORT...] REASON`
   withdraws the push grant and sends the reports (all waiting ones when
   none is named) back to the BA. Report: `denied`.
8. **New approach** (`report_new_approach`): after a denial the BA, on
   standby, asks the client why if the reason is unclear, then turns the
   feedback into new backlog goals (objective, acceptance criteria,
   optional priority and owner), linked to the report (`from_report`) and
   carrying the client's reason (`client_feedback`). Report: `reworked`.
   The BA notes the feedback on the mind map (`mindmap_note`); the
   Researcher still builds and structures the map.

**IMPORTANT: virtual history into real history.** The client's approval
(push-ok, merge-ok or done naming merge reports) is what allows the
virtual history of those items (side worktrees, `local/` refs, review
threads) to move into real history. When it moves, the PR branch the
person sees and reviews carries **compressed** history: keep-commits only,
everything else folded ([virtual-git.md](virtual-git.md), step 6). The
temporary virtual-git branches (listed in the merge plan's `side`) are
deleted only **after** the person merges the real PR: Orchestration runs
`node scripts/devops-chain.mjs merged --base <base> REPORT...`, which
refuses until each pushed tree is on the base, records the merge
(`merged_at`, `merged_by`) and then deletes them. No seat merges a PR.

**merge-deny and reopening.** QA, Review and Security send work back with
their existing send-back hand-offs, which carry the reason. On the chain,
merge-deny by a step's signer reopens the goal: it returns to
`in_progress` (to the backlog when denied for an unfixed bug), its verdicts and signatures start over, and its live report
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
