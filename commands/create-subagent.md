---
name: create-subagent
description: Spawn a DevOps role asynchronously from ../agents/. Do not poll background subagents.
---

# /create-subagent

Also: `create a subagent`, `spawn`, the host's subagent tool (Cursor `Task`, Claude Code `Agent`).

Spawn specialized roles. They run **asynchronously in pods**, not a linear queue.

1. Use the host's subagent tool with the matching prompt in `../agents/devops-*.md`.
2. Default `run_in_background: true` and agent `is_background: true`.
   Launch a whole pod in one turn (research, review, qa, …). Each role
   type is async.
3. Do not poll a background subagent. Continue other work or end the turn; the completion notification is enough.
4. The Orchestrator synthesizes. Subagents do not push or open PRs.
   **Only QA may give the OK to push** (except review-bot feedback fixes, or `/devops develop on` then typed `/devops push-ok`; see qa-publish-policy.md). Every change except those exceptions gets Security's SOC 2 review;
   that review does not authorize a push. DO NOT PUSH, PUBLISH, OPEN OR UPDATE A PULL REQUEST,
   MERGE, OR OTHERWISE SUBMIT CODE UNTIL QA MARKS THE PUBLISH GATE PASS.
5. Subagents accept any `/` command, `/devops` skill modes (`question`,
   `mind-map`, `stage`, `review`, `repro`, …), or the same words
   (`/goal`, `/code-review`, `/repro`, `/buildkite-*`, `/sonar-*`, …).
6. Give every spawned seat a **team hash**, **agent hash**, **initial
   job** and **current job** (minted by the Orchestrator, see
   `role-identity.md` Identity hashes; run
   `node scripts/devops-ids.mjs mint team` and
   `node scripts/devops-ids.mjs mint agent`) and put all four in the
   spawn description. Resume standing seats; do not mint a new agent
   hash for them.
7. Working Markdown goes in `devops-skill/thoughts/non-final/` while open.
   Agent files set `is_background: true`. Always spawn with
   `run_in_background: true`.

| Role | Agent file |
|------|------------|
| Researcher | `devops-researcher.md` |
| Coder | `devops-coder.md` |
| Reviewer | `devops-reviewer.md` |
| CI Engineer | `devops-ci-engineer.md` |
| QA | `devops-quality-engineer.md` |
| Security | `devops-security-engineer.md` |
| Ticket Lead | `devops-ticket-lead.md` |
| Verifier | `devops-verifier.md` |
| Integrator | `devops-integrator.md` |
| Communicator | `devops-communicator.md` |

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
