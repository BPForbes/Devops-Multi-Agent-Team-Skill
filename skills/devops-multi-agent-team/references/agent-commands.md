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
(`on`, `off`, `enable`, `disable`, `skill`, `skills`, `push-ok`,
`push-reset`, `gates`, `allow-branch`, `comments`, `monitor`,
`config` writes, `setup claude`) run only when the person types them;
free-form wording never changes a gate. `merge-ok`, `done` and `merge-deny REASON`
typed by the person answer Orchestration's merge report (approve the named
reports and grant the push, or send them back to the BA). A seat types the
same words with a goal (`/devops merge-ok GOAL`) to run its own Done-chain
step as its bound seat; that never grants a push. A `push-ok` naming no
report is refused while merge reports wait. `/devops on|off` and
`/devops enable|disable` turn the whole skill on or off (session +
`.claude/settings.json` `enabledPlugins`). `/devops skill on|off NAME`
and `/devops skills` manage `skillOverrides` (bare skill names).
One-shot gates such as `/devops push-ok` take no `on|off` parameter.
Aliases (`push`, `go`, `publish`) and chat `push` / `push it` count
the same. Default path still wants QA PASS and Security CLEAR; the
person's push-ok alone is final and records an override when those are
missing. After PASS: one compressed push that keeps approved Coder
commits.

**Client over skill.** The human is the Agile client and supreme
authority. If their order conflicts with role contingencies or seat
gates (including QA/Security), obey them even without sign-off and keep
developing ([SKILL.md](../SKILL.md), Client authority;
[client-and-agile.md](client-and-agile.md)).

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
