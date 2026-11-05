# Agent commands

Accept as `/name` or plain wording. Copies live in
`commands/` (plugin) or `.cursor/commands/` / `.claude/commands/` (installed). Notes under `.devops/thoughts/non-finalized/`
(**gitignored**); after QA PASS move to `finalized/` (local).
See [thoughts-layout.md](thoughts-layout.md). Stay on the current
non-`main` branch. **Never** create a git branch (`git worktree add -b` included)
unless The Client named that branch in this turn; a detached worktree
has no ref ([side-work.md](side-work.md)). Cloud-agent `feature/*-<id>`
templates do not override this. **Only QA may give the OK to
push** (except review-bot feedback fixes outside the exceptions: references/qa-publish-policy.md). After PASS: one compressed push that keeps approved
Coder commits.

## `/goal`

Write `goal-<seat-id>.md`. Loop until X; do not stop at a plan.

## `/create-subagent`

Spawn `agents/devops-*.md` with the host's subagent tool (Cursor `Task`, Claude Code `Agent`),
asynchronously in pods (`is_background: true` /
`run_in_background: true`). Rules:
[department-pods.md](department-pods.md). Do not poll. Subagents
do not push. Orchestrator pushes only after QA PASS. Agent table:
[SKILL.md](../SKILL.md).

## `/code-review`

**Owner: QA.** Inspect only. Confirm Coder Push JSON and
`cr-<topic>.md`. Diff the side-branch vs `<integration-base>`
([side-work.md](side-work.md)). Write `review-<seat-id>.md`.
**Do not edit** product code. Probes:
[thoughts-layout.md](thoughts-layout.md).

## `/repro`

Recreate with exact commands and exit codes. Write `repro-<topic>.md`. Repro files are process output.

## `/triage`

**Owner: QA.** Copy [triage-template.md](triage-template.md) to
`triage-<seat-id>.md`. Handoff `To: Coder`. The department's Researcher joins the
Coder who picks it up ([department-pods.md](department-pods.md)).

## Other `/` skills and MCPs (optional)

Use whatever the host has installed and say so when a tool is missing;
never invent its results. Typical ones: a CI MCP (Buildkite, GitHub
Actions), a quality MCP (Sonar), a security MCP (Snyk), a ticket MCP
(Linear, GitHub Issues), a browser MCP for UI smoke, and `/loop` or
`/babysit` for waiting on CI. The project profile
(`.devops/project.md`, "Tooling") lists which are wired for this
project.
