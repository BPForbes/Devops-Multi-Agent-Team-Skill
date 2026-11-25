---
name: allocate
description: Orchestrator assigns goals to pods (team hashes) and to each agent on the team.
---

# /allocate `--mode pod|agent|job|board` `[parent goal]`

Execute now. Do not reprint, summarize, or paste these instructions into chat — run the steps (tools and scripts) and report only the result.

Also: `/devops allocate`, `/devops goal --mode allocate`, `assign pods`, `assign agents`.

1. **pod** — write `goal-team-<hex>.md` per team hash from the parent goal
   (acceptance criteria for that department/item).
2. **agent** — write `goal-agent-<hex>.md` per seat with the slice that agent owns.
3. **job** — `node scripts/devops-ids.mjs free --registry '…' --initial JOB`;
   set `current_job`; prefer agents whose `initial_job` matches.
4. **board** — update `seat-registry.md` and `team-board.md` with the rows.

Mint ids with `node scripts/devops-ids.mjs mint team` and `mint agent`.
Independence rules still apply for review/security/QA
([role-identity.md](../skills/devops-multi-agent-team/references/role-identity.md)).

