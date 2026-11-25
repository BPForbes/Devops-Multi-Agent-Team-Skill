---
name: create-subagent
description: Spawn a DevOps role asynchronously from ../agents/. Do not poll background subagents.
---

# /create-subagent

Execute now. Do not reprint, summarize, or paste these instructions into chat — run the steps (tools and scripts) and report only the result.

Also: `create a subagent`, `spawn`, the host's subagent tool (Cursor `Task`, Claude Code `Agent`).

Spawn specialized roles. They run **asynchronously in pods**, not a linear queue.

1. Use the host's subagent tool with the matching prompt in `../agents/devops-*.md`.
2. Default `run_in_background: true` and agent `is_background: true`.
   Launch a whole pod in one turn (research, review, qa, …). Each role
   type is async.
3. Do not poll a background subagent. Continue other work or end the turn; the completion notification is enough.
4. The Orchestrator synthesizes and **obeys the client (human)** like
   every other seat ([client-and-agile.md](../skills/devops-multi-agent-team/references/client-and-agile.md)).
   Subagents do not push or open PRs. Default path: every change except
   review-bot feedback exceptions gets Security's SOC 2 review, then QA
   PASS; only the **client** authorizes a push (`push-ok`). Seat
   verdicts do not authorize a push. DO NOT PUSH, PUBLISH, OPEN OR
   UPDATE A PULL REQUEST, MERGE, OR OTHERWISE SUBMIT CODE UNTIL THE
   CLIENT AUTHORIZES IT (default path also wants QA PASS).
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
| Business Analyst | `devops-business-analyst.md` |
| Verifier | `devops-verifier.md` |
| Integrator | `devops-integrator.md` |
| Communicator | `devops-communicator.md` |

