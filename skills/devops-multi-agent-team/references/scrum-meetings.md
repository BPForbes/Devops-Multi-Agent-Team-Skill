# Scrum meetings

Read this file. Do not paste it into agent prompts.

Each authoring team holds its own Scrum meetings in each sprint, on the
goal board. The team lead the sprint's allocation names (the team's
manager seat) schedules each one with `meeting_schedule` and holds it
with `meeting_hold`, recording who attended, how long it took and what
it decided. No other seat, and no team outside the allocation, runs a
team's meetings. Orchestration schedules
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
comes once; the retrospective comes once, after it. When every
authoring team in the allocation has held its retrospective, the sprint
closes, and a closed sprint holds no more meetings.

Only the lead holds a meeting, attendees are agent hashes, and a meeting
that runs past its timebox is refused. Meetings decide the work; they do
not change a gate: a push still needs QA PASS, Security CLEAR and the
person's typed `/devops push-ok` on the exact tree.
