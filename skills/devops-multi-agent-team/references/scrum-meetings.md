# Scrum meetings

Read this file. Do not paste it into agent prompts.

Every team holds its own Scrum meetings in each sprint, on the goal
board, whatever its job: authoring teams and the judging teams (`R1`,
`Q1`, `S1`) alike.
The team lead the sprint's allocation names (the team's manager seat)
schedules each one with `meeting_schedule` and holds it with
`meeting_hold`, recording who attended, how long it took and what it
decided. No other seat, and no team outside the allocation, runs a team's
meetings. In Sprint Planning an authoring team chooses the goals it
builds; a judging team chooses the goals it judges, from the backlog or
already in the sprint, and plans only reviewer, QA and Security tasks
on them. Orchestration schedules
the first one, Sprint Planning, when it spins up the board
([allocation-research.md](allocation-research.md)). A sprint's meetings
and allocation are read at `devops://meetings/<sprint>`.

| Meeting | When | Timebox | What it records |
|---------|------|---------|-----------------|
| Sprint Planning | start of the sprint, first | 2 hours per sprint week | the sprint goal, the backlog goals chosen (only backlog goals; they move into the sprint), and the tasks each goal breaks into (a job and a title each) |
| Daily Scrum | each day of the sprint | 15 minutes | each developer's update: what was done, what is next today, and blockers (collected for the lead to clear) |
| Backlog Refinement | mid-sprint | 1 hour per sprint week | upcoming goals (not in this sprint) clarified, sized (1 to 13 points) and ordered (priority 1 first) |
| Sprint Review | near the end, once | 1 hour per sprint week | the Done goals shown, the feedback, and new goals (not already on the board) added to the backlog |
| Sprint Retrospective | the very end, once, after the review | 45 minutes per sprint week | what went well, the bottlenecks, and at least one agreed improvement |

The board enforces the order: Sprint Planning comes first; Daily Scrums
and Backlog Refinement run between planning and the review; the review
comes once; the retrospective comes once, after it. When every team in
the allocation, the judging teams included, has held its retrospective,
the sprint closes, and a closed sprint holds no more meetings. Its
unfinished goals go back to the backlog, in the backlog state, free for
a later sprint's allocation and planning; they are still done only by a
lead's sign-off, and are judged again from the start (verdicts from
before the return do not count, but a seat that wrote the goal in any
sprint still cannot judge it).

## Done: the lead signs off and reports up; the person signs off last

The team lead decides whether the team's task is truly done. A goal in
a sprint's allocation is done only by its own team lead's sign-off
(`goal_signoff`), and only once it is in the security step and the board
holds, since the goal's last send-back and in this order, a review
hand-off into the QA team the allocation names, QA's hand-off from that
team to its Security team, and, after QA's last such hand-off, that
Security team's latest sign-off with result `clear`. A verdict from any
other team, from a seat that wrote the goal, or from
the goal's own team lead does not count, and neither does one
overturned or sent back since. Moving it to done
any other way is refused, it cannot leave its sprint, and no goal starts
out done. On a team's own board, the
lead (manager) likewise makes the last move of an item to done, after
Security's sign-off.

The lead's sign-off is not the final word. It files a done report to
Orchestration (`devops://reports`); Orchestration passes the reports on
to the person with a summary (`report_forward`) and in its DevOps
report. The person gives the real final sign-off before the real push:
their typed `/devops push-ok` on the exact tree, after QA PASS and
Security CLEAR. Nothing a lead or Orchestration does stands in for it.

Only the lead holds a meeting, attendees are agent hashes, and a meeting
that runs past its timebox is refused. Meetings decide the work; they do
not change a gate.
