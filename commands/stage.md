---
name: stage
description: Trigger one DevOps CI/CD pod (research, implement, review, security, qa, docs) or the full loop, with optional goal text.
---

# /stage `--mode <pod>` `[goal text]`

Also: `/devops stage`, `/devops ci`, `/devops pipeline`, `run research`, `trigger qa`.

Pods match the Orchestrator loop in `../skills/devops-multi-agent-team/SKILL.md`:

| `--mode` | Spawns |
|----------|--------|
| `research` | Planner, Researcher, Ticket Lead |
| `implement` | Coder (department Researcher joins) |
| `review` | 2–3 independent Reviewers |
| `security` | Security Engineer |
| `qa` | QA, CI Engineer, Verifier |
| `docs` | Documentation, Communicator |
| `full` | whole loop |

1. If goal text is present, allocate first: `/devops allocate --mode pod`
   then `--mode agent` (or `/devops goal --mode allocate`).
2. Mint **team hash** and **agent hashes**; set `initial_job` / `current_job`.
3. Spawn only that stage's seats with `/create-subagent` (background).
4. Seats use the same `/devops` skill modes humans do (`question`, `mind-map`,
   `reuse`, `review`, `repro`, …) — see agent-commands.md, Seat methods.
5. Leave other pods idle unless `--mode full`.

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
