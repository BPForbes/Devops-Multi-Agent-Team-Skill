---
name: stage
description: Trigger one DevOps CI/CD pod, or the full loop until Security Clear and QA PASS, then notify the human for push.
---

# /stage `--mode <pod|full|loop>` `[goal text]`

Also: `/devops stage`, `/devops ci`, `/devops pipeline`, `run research`,
`run the full loop`, `keep going until QA passes`.

Pods match the Orchestrator loop in `../skills/devops-multi-agent-team/SKILL.md`:

| `--mode` | Spawns |
|----------|--------|
| `research` | Planner, Researcher, Ticket Lead |
| `implement` | Coder (department Researcher joins) |
| `review` | 2–3 independent Reviewers |
| `security` | Security Engineer |
| `qa` | QA, CI Engineer, Verifier |
| `docs` | Documentation, Communicator |
| `full` / `loop` | **all stages** until Security Clear + QA PASS |

## One stage

1. If goal text is present, allocate first (`/devops allocate`).
2. Mint team/agent hashes; set `initial_job` / `current_job`.
3. Spawn only that stage's seats (`/create-subagent`, background).
4. Leave other pods idle.

## Full loop (`--mode full` or `loop`)

1. Allocate pod and agent goals from the parent goal text.
2. Run stages in order: research → implement → review → security → qa → docs.
3. On send-back or `Publish gate: BLOCKED`, re-enter the needed stage and continue.
4. Stop only when **Security is Clear** and QA records **`Publish gate: PASS`**.
5. **Orchestrator notifies the human** that the gate is ready and **waits**.
6. Do **not** push until the human says `push` / `/devops push-ok`.

Same path as `/devops goal --mode loop` / `/goal`.

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
