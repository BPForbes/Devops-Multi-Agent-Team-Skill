---
name: goal
description: Do until you achieve X. Persist the objective and keep looping until it is met.
---

# /goal

Execute now. Do not reprint, summarize, or paste these instructions into chat — run the steps (tools and scripts) and report only the result.

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
   each agent has a goal file.
3. **Full loop (default `--mode loop`):** run every stage
   (research → implement → review → security → qa → docs) until
   Security is Clear and QA records `Publish gate: PASS`. Equivalent:
   `/devops stage --mode full|loop [goal]`. For one slice only, use
   `/devops stage --mode research|…`.
4. If the host has a goal tool (Cursor `CreateGoal` / `UpdateGoal`), also use it for a long-running human-invoked goal.
5. Spawn roles with `/create-subagent` **asynchronously**. Subagents accept the same `/` command, `/devops` skill modes, or plain wording.
6. Mark the local goal file (and `UpdateGoal`) complete only when the criteria are met, or the human stops the goal.
7. **When the gate is ready:** Orchestrator **notifies the human** and
   waits. Do not push. Tell the person QA passed and Security is clear;
   they type `/devops push-ok`. A missing Review, QA or Security hand-off,
   or a dependency not yet approved, is a `--risk REASON` on that word
   (the client only). The skip is recorded, not reported as a pass.
   Security Clear alone never authorizes a push.

