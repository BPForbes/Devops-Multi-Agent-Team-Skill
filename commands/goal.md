---
name: goal
description: Do until you achieve X. Persist the objective and keep looping until it is met.
---

# /goal

Also: `set a goal`, `do until X`, `keep going until X`.

Do until you achieve **X**. Do not stop at a plan or a partial implement.

1. Write the objective to
   `devops-skill/thoughts/non-final/goal-agent-<hex>.md`
   (acceptance criteria, non-goals, done-when); use your **agent hash**
   ([role-identity.md](../skills/devops-multi-agent-team/references/role-identity.md)),
   or `orchestrator-<topic>` for the Orchestrator. Do not `git add`
   those files. After QA PASS, move closed goals to
   `devops-skill/thoughts/final/` (local).
2. Orchestrator allocates: `/devops allocate --mode pod` then
   `--mode agent` (or `/devops goal --mode allocate`) so each pod and
   each agent has a goal file. Trigger one CI/CD slice with
   `/devops stage --mode research|…|full` when only part of the loop
   should run.
3. If the host has a goal tool (Cursor `CreateGoal` / `UpdateGoal`), also use it for a long-running human-invoked goal.
4. The Orchestrator (`/devops-multi-agent-team`) loops the DevOps cycle until X is actually achieved.
5. Spawn roles with `/create-subagent` **asynchronously**. Subagents accept the same `/` command, `/devops` skill modes, or plain wording.
6. Mark the local goal file (and `UpdateGoal`) complete only when the criteria are met, or the human stops the goal.
7. **Default publish path:** QA PASS, then the human's go. Human "push" /
   `/devops push-ok` is final and must be done (same meaning in chat or
   slash form). Every change except review-bot feedback fixes (see
   qa-publish-policy.md) still gets Security's SOC 2 review. Do not push
   on a seat's say-so alone.

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
