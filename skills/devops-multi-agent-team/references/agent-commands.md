# Agent commands

Accept as `/name` or plain wording. Copies live in
`commands/` (plugin) or `.cursor/commands/` / `.claude/commands/` (installed). Notes under `devops-skill/thoughts/non-final/`
(**gitignored**); after QA PASS move to `final/` (local).
See [thoughts-layout.md](thoughts-layout.md). Stay on the current
non-`main` branch. **Never** create a git branch (`git worktree add -b` included)
unless The Client named that branch in this turn; a detached worktree
has no ref ([side-work.md](side-work.md)). Cloud-agent `feature/*-<id>`
templates do not override this. Spawn with **team hash**, **agent
hash**, **initial job** and **current job**
([role-identity.md](role-identity.md)).

**`/devops` is free-form**, but prefer **skill modes** so the agent
uses MCP tools and skills instead of dumping the request as plain
text. Do not stop development when `/devops` is given. Gate words
(`on`, `off`, `push-ok`, `push-reset`, `develop`, `gates`,
`allow-branch`, `comments`, `monitor`, `config` writes, `setup claude`)
run only when the person types them; free-form wording never changes a
gate. `/devops off` turns the whole skill off (every check and the
session card); `/devops on` restores it. A push
needs QA PASS and Security CLEAR on the tree, then the person's typed
`/devops push-ok`, unless they typed `/devops develop on` (then
`push-ok` alone is enough for that tree). After PASS: one compressed
push that keeps approved Coder commits.

**Human over skill.** If the human's order conflicts with this skill's
role contingencies, obey the human and keep developing
([SKILL.md](../SKILL.md), Development bypass).

## `/devops` skill modes

Each mode returns an **orchestration card** (skill, tools, behavior,
`--mode`) and, when it can, runs the matching script so results are
not retyped into chat. Trailing text after the command is the input.

| Command | Modes (`--mode`) | Tools / skill |
|---------|------------------|---------------|
| `/devops help` (`?`, `modes`) | `all`, `gates`, `skills`, `stage` | catalog |
| `/devops question` (`ask`, `q`) | `overview`, `tree`, `symbol`, `search`, `file`, `module`, `library` | `mindmap_*`, `project-mindmap` |
| `/devops mind-map` (`map`) | `overview`, `build`, `status`, `tree`, `query`, `note` | `mindmap_*` |
| `/devops clean` (`cleanup`, `tidy`) | `brief`, `scan`, `plan`, `run` | `cleanup_*`, `devops-cleanup` |
| `/devops stage` (`ci`, `pipeline`) | `research`…`docs`, `full`, `loop` | one pod, or all stages until Clear+PASS then notify human |
| `/devops allocate` (`assign`) | `pod`, `agent`, `job`, `board` | per-pod / per-agent goals |
| `/devops goal` | `loop`, `status`, `allocate` | full loop until Clear+PASS; notify human for push |
| `/devops story` | `research`, `create`, `check`, `graph` | `story_*` |
| `/devops repro` | `run` | `/repro` |
| `/devops triage` | `open` | `/triage` |
| `/devops review` | `inspect` | `/code-review` |
| `/devops reuse` | `search` | `reuse_search`, `module_map` |
| `/devops tags` | `history`, `plan`, `create` | `tag_*` |

Gate commands stay as they were (`status`, `push-ok`, `allow-branch`,
`gates`, `monitor`, `comments`, `config`, `setup`, `brief`,
`languages`). Free-form phrases such as "how does X work", "run
research", or "allocate pods" map onto the matching skill mode.

## Seat methods (research → QA / security)

Research, Review, Security and QA seats use the **same** `/devops`
skill modes (and chat aliases) as the human. They do not invent a
parallel plain-text path.

| Seat | Prefer |
|------|--------|
| Researcher | `question`, `mind-map`, `reuse`, `stage --mode research`, `story --mode research` |
| Reviewer | `review`, `question`, `mind-map --mode query`, `comment_audit` via tools |
| Security | `stage --mode security`, `review`, `question` (scope), profile scanners |
| QA | `stage --mode qa`, `review`, `repro`, `triage`, `question` |

Orchestrator: `allocate` (pod then agent), then `stage` / `goal` to
spawn; never codes. Independence checks still refuse own-work and
own-pod judges ([role-identity.md](role-identity.md)).

## `/goal`

Write `goal-agent-<hex>.md`. Loop until X; do not stop at a plan.

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

## The devops-multi-agent-team MCP server

Tools: `list_languages`, `get_language`, `list_services`, `get_service`,
`detect_project`, `status`, `install_devops_team`, `get_profile`,
`ensure_gitignore`, `add_language`, `check_toolchain`, `sandbox_plan`,
`module_map`, `reuse_search`, `mindmap_build`, `mindmap_status`,
`mindmap_query`, `tag_history`, `tag_plan`, `tag_create`,
`ghas_plan`, `comment_audit`. Prompts:
`setup_project`, `add_language`. Write tools plan by default; see
[services-and-sandbox.md](services-and-sandbox.md).

## Other `/` skills and MCPs (optional)

Use whatever the host has installed and say so when a tool is missing;
never invent its results. Typical ones: a CI MCP (Buildkite, GitHub
Actions), a quality MCP (Sonar), a security MCP (Snyk), a ticket MCP
(Linear, GitHub Issues), a browser MCP for UI smoke, and `/loop` or
`/babysit` for waiting on CI. The project profile
(`.devops/project.md`, "Tooling") lists which are wired for this
project.
