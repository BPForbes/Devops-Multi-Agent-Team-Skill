# The sprint loop: sprints until the client is satisfied

Read this file. Do not paste it into seat prompts.

After the first sprint is allocated ([autopilot.md](autopilot.md)), sprints
follow one another on their own until the client is satisfied. The Business
Analyst sits in every team's meetings to keep the leads and their teams on
the client's vision. Rules: `scripts/devops-loop.mjs`. State:
`.devops/loop.json` (local). `loop_status` shows it.

## 1. A sprint ends

A sprint closes when every team has held its Sprint Retrospective. Its
unfinished goals go back to the backlog, and the Sprint Review has already
put the client's feedback there as new goals
([scrum-meetings.md](scrum-meetings.md)). The meeting that closes it files
the **Orchestrator's sprint report**:

- the goals done, and those the client approved;
- the goals that went back to the backlog;
- the Sprint Review's feedback and new goals;
- the retrospectives' actions;
- how many goals the next sprint can draw on.

`loop_advance` files it too, if a sprint closed without one.

## 2. The Business Analyst signs the report

The BA signs with `loop_report_sign`, adding its view of how the vision was
carried out (`notes`). When the execution of the vision is unclear, the BA
asks the client (`askClient`), and the loop **pauses** until the client
answers.

## 3. The client signs off

The client signs off on the BA's work through that report:

- `/devops satisfied [NOTE]` ends the loop. No further sprint starts.
- `/devops continue [ANSWER]` answers the BA's question and lifts the pause.
  Orchestration then runs `loop_advance`.

Only the person can type these; a seat that tries is refused. The loop does
not wait for the client between sprints unless it is paused.

## 4. The next sprint, on its own

Once the BA has signed, the loop moves on at once, with no further step:

1. **Draft:** the next sprint is drafted from the backlog: every unfinished
   goal (it keeps its scope and the client's fields), every goal from review
   feedback or the client's new approach, and the tasks deferred before.
2. **Allocate:** with no question for the BA, it is allocated at once.
   Otherwise it waits for the BA to steer (`autopilot_steer`), for example
   to choose the owner of a task that spans modules, and Orchestration then
   runs `loop_advance`.
3. **Teams carry over:** each module's team keeps its team hash and the seats
   whose job is still needed, its lead first. Seats are added for new load
   and retired when the load drops, and a module with no work this sprint
   retires its team. A goal's open work from the sprint before is closed
   (`carried`), so no seat holds it twice.
4. **Launch:** the launch list names the new seats to spawn and the retired
   ones to stop. Carried seats go on with their context.

## 5. When the loop pauses

| Pause | Why | Lifted by |
|-------|-----|-----------|
| `ask-client` | the BA asked the client about the vision | `/devops continue ANSWER` |
| `limit` | the loop reached its sprint limit (10 by default; `sprintLimit` on `autopilot_draft`) | `/devops continue` (10 more), or `--more N` |
| `nothing-left` | the backlog is empty and nothing was deferred | `/devops satisfied`, or new goals and `/devops continue` |

Pushes still need the client's `/devops push-ok`, as always.
