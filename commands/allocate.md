---
name: allocate
description: Orchestrator assigns goals to pods (team hashes) and to each agent on the team.
---

# /allocate `--mode pod|agent|job|board|autopilot` `[parent goal]`

Also: `/devops allocate`, `/devops goal --mode allocate`, `assign pods`, `assign agents`.

1. **pod** — write `goal-team-<hex>.md` per team hash from the parent goal
   (acceptance criteria for that department/item).
2. **agent** — write `goal-agent-<hex>.md` per seat with the slice that agent owns.
3. **job** — `node scripts/devops-ids.mjs free --registry '…' --initial JOB`;
   set `current_job`; prefer agents whose `initial_job` matches.
4. **board** — update `seat-registry.md` and `team-board.md` with the rows.
5. **autopilot** — the first sprint from a list of tasks
   ([autopilot.md](../skills/devops-multi-agent-team/references/autopilot.md)):
   `autopilot_draft` with the tasks and the BA's agent hash; spawn the BA
   (`devops-multi-agent-team:devops-business-analyst`) to answer the draft's
   questions and steer it with `autopilot_steer`, then `autopilot_allocate`;
   spawn one subagent per seat in the launch list (`subagent`, bound by its
   `env`, given its work, and the lead its brief). Do not spawn seats before
   allocation.
   After that the sprint loop runs the next sprints on its own
   ([sprint-loop.md](../skills/devops-multi-agent-team/references/sprint-loop.md)):
   when a sprint closes, have the BA sign the report (`loop_report_sign`);
   spawn the new seats and stop the retired ones in each new launch list; run
   `loop_advance` after the person's `/devops continue` or the BA's steering.

Mint ids with `node scripts/devops-ids.mjs mint team` and `mint agent`.
Independence rules still apply for review/security/QA
([role-identity.md](../skills/devops-multi-agent-team/references/role-identity.md)).

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
