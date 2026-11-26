# devops-multi-agent-team

A multi-agent DevOps workflow for Cursor and Claude Code: a skill, agents and
commands, plus:

1. **A language setup file** ([`languages.json`](languages.json), explained in
   [`LANGUAGES.md`](LANGUAGES.md)) that says what build, test, lint, scan and
   style mean for 40 languages and how they interact, plus a services file
   ([`services.json`](services.json)) for Docker, cloud, AI and VMs and a
   sandbox policy, installable through chat with an MCP server.
2. **A Claude mod** (`hooks/`) that detects the languages in the open project,
   adds a free-form `/devops` command with skill modes (`question`, `mind-map`,
   `clean`, `goal`, …) that drive MCP tools instead of plain-text dumps, and refuses
   `git push`, `gh pr create|merge` and git-branch creation until *you* authorize
   by typing `/devops push-ok` (or saying `push` in chat) on the current tree.
   Your authorization is final: it overrides a missing QA PASS or Security CLEAR
   (recorded) so the mod does not deadlock development. `/devops on|off` (aliases
   `enable|disable`) turns the whole skill on or off and writes project
   `.claude/settings.json` `enabledPlugins`. `/devops skill on|off NAME` and
   `/devops skills` manage `skillOverrides`. `/devops` does not stop development.
   If your order conflicts with skill protocol, the mod and seats obey you.

## Turn the plugin off and on

In a Claude Code project that uses this plugin:

| Command | Effect |
|---------|--------|
| `/devops off` or `/devops disable` | Session checks off **and** writes `"devops-multi-agent-team@devops-multi-agent-team": false` under `enabledPlugins` in `.claude/settings.json` (other keys kept). |
| `/devops on` or `/devops enable` | Session checks on **and** sets that key to `true`. |
| `/devops skill off NAME` | Writes `skillOverrides` for a bare skill name (`devops-cleanup`, or aliases like `cleanup`). |
| `/devops skills` | Lists each known skill and its override (absent = on). |

**Re-enable after the plugin has unloaded:** edit `.claude/settings.json` and set `"devops-multi-agent-team@devops-multi-agent-team": true`, or run `claude plugin enable devops-multi-agent-team@devops-multi-agent-team`, then reload plugins or start a new session.

**`skillOverrides` key format:** bare skill name (documented by Claude Code). Prefixed forms such as `devops-multi-agent-team:cleanup` are accepted by `/devops skill` and normalized to the folder name (`devops-cleanup`). Claude Code does **not** apply `skillOverrides` to skills loaded only from a plugin; it does apply them to project copies under `.claude/skills/`. To hide plugin-only skills, disable the whole plugin.

## What is in it

| Path | What |
|------|------|
| `skills/project-mindmap/` | Plain-chat skill: answer questions about the project from the mind map, no team needed. |
| `skills/devops-multi-agent-team/` | The skill: `SKILL.md` and `references/` (team/agent/job/item hashes, pods, side worktrees, Push JSON, QA policy, SOC 2 review, templates). Language-neutral. |
| `agents/` | Role prompts: researcher, coder, reviewer, CI, quality (QA), security, cleaner, ticket lead, business analyst, verifier, integrator, communicator. |
| `commands/` | `/goal`, `/create-subagent`, `/code-review`, `/repro`, `/triage`. |
| `languages.json`, `LANGUAGES.md` | The language setup file (40 languages) and its guide. |
| `standards.json` | Project standards: line length, function size and nesting, parameters, duplicates, comment density, per-language overrides, and linter settings. Copied as `.devops/standards.json`, where a project overrides only the keys it sets. |
| `services.json`, `SERVICES.md` | Docker, cloud, AI and VM services, the sandbox policy, and their guide. |
| `mcp/server.mjs` | The MCP server for installing and managing through chat. |
| `templates/project.md` | Skeleton of the per-project profile (`.devops/project.md`). |
| `scripts/devops-setup.mjs` | `list`, `detect`, `profile`, `install`, `status`, `check`, `sandbox`. No dependencies, Node 18+. |
| `scripts/devops-ids.mjs` | Mint and check `team-` / `agent-` / `item-` hashes; independence and free-agent allocation helpers. |
| `mindmap-text.json` | Every sentence, label and word list the mind map uses; a project overrides keys in `.devops/mindmap/text.json`. |
| `scripts/devops-mindmap.mjs` | The repository mind map: `overview`, `tree`, `note`, `build [--save]`, `status`, `query`. Writes only `.devops/mindmap/`, and only with `--save`. |
| `hooks/`, `types/`, `.claude-plugin/` | The Claude mod and plugin manifest. |

## Repository mind map: with or without the team

`.devops/mindmap/` holds a map of the project built as a **tree with cross
links** (project > module > file > class > function, documentation > doc >
section, libraries; linked by imports, calls, uses, documents, links, tests).
**Documentation is part of it**: each node carries its doc comment or
docstring, file header or README, the doc sections that name it, and a
hand-written note from `NOTES.md`. Files: `OVERVIEW.md` (a quick scan),
`MINDMAP.md` (the tree with documentation, docs to code, modules, libraries,
possible duplicates), `graph.json` (nodes and edges), `mindmap.json` (behind
`mindmap_query`) and `NOTES.md` (yours, never overwritten). No sentence is
written in the code: all wording and English word lists are in
[`mindmap-text.json`](mindmap-text.json), and a project can change any of them
in `.devops/mindmap/text.json`. "How does X work?"
is `mindmap_tree` on X. Build it with
asking "map this project" (the assistant calls `mindmap_build save=true`) or
`node scripts/devops-mindmap.mjs build --save`; it takes well under a second.

- **Plain chat, no team.** Ask "what is this project?", "where is X?", "what
  uses lodash?". The `project-mindmap` skill answers from `mindmap_overview`
  (the Claude mod already puts the overview in the session prompt), then
  `mindmap_query` for specifics, opening files only at the line ranges given.
  No command is needed: just ask in plain words ("how does `total` work?",
  "refresh the map", "note that the cart rounds once").
- **DevOps team run (Research, Coder, Reviewers, Security, QA).** The
  Researcher owns the map: refreshes it at the start of research, queries it
  and puts what the others need in the brief; the others use it only for
  narrow lookups. Details: [`mind-map.md`](skills/devops-multi-agent-team/references/mind-map.md).

## Install through chat (MCP)

The package ships an MCP server (`mcp/server.mjs`, Node 18+, no dependencies)
so you can set up any project by talking to your assistant instead of copying
files.

**Fastest: one command** installs the skill (into the `.cursor/` and/or `.claude/` folders the project already has, else both), copies the tools into the project and connects the MCP server:

```bash
node scripts/devops-setup.mjs init --dest ~/my-project        # or: scripts/install.sh --dest ~/my-project
```

**Self-contained and kept out of git.** The project gets its own copy of the tools (MCP server,
lint, config, data) in `devops-skill/kit/`, so it needs nothing outside its own folder and the
clone can be moved or deleted. Nothing the install writes is committed: the tools, thought files,
the copies in `.claude/` and `.cursor/`, the MCP config files it created and `.devops/` are listed
in `.git/info/exclude`, git's own local ignore file, so on a fresh install no tracked file changes
and `git status` stays clean. Each person runs `init` once in their clone. Re-running it updates the kit.

- `--share-config` keeps `.devops/` (profile, standards, stories) committable so a team shares them;
  the tools and copies stay local.
- A file of the project's own with the same name as one of ours (say `.claude/commands/goal.md`)
  is kept and stays visible to git.
- An earlier install that committed copies: the report lists the files git still tracks and the
  `git rm -r --cached ...` command that untracks them (files stay on disk). It never runs it. An
  old block in `.gitignore` is removed; that `.gitignore` change is yours to review and commit.
- Outside a git repository the block goes into `.gitignore`; run `ensure_gitignore` after `git init`.

`connect` points `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) and `.vscode/mcp.json` at
the project's own server by a relative path (`${CLAUDE_PROJECT_DIR:-.}/devops-skill/kit/mcp/server.mjs`,
`${workspaceFolder}/...`), keeping any other servers listed. If git tracks that config file, it is
left alone and a local alternative is printed (`claude mcp add ... --scope local`, or the user-level
Cursor file). `connect --client claude,cursor,vscode [--npx]` does only the connection; `--npx` runs
the published package instead of the kit (not tried by me).

**The MCP server carries its own setup script.** When a client connects, the server's instructions include [`mcp/setup-script.md`](mcp/setup-script.md): detect, choose languages and services, plan, ask, apply, check the toolchain, remind about the profile. Any assistant that connects knows how to do the install without further prompting, and the same text is the `setup_project` prompt and the resource `devops://setup`. Edit that file to change how the install is run.

**Or connect it by hand**

| Client | How |
|--------|-----|
| Claude Code, as a plugin | `/plugin install devops-multi-agent-team --marketplace BPForbes/Devops-Multi-Agent-Team-Skill`, or locally `claude --plugin-dir /path/to/devops-multi-agent-team`. `plugin.json` registers the server from the plugin folder (`${CLAUDE_PLUGIN_ROOT}`) |
| Claude Code, this repository opened as a project | nothing to do: the root `.mcp.json` starts `${CLAUDE_PROJECT_DIR:-.}/mcp/server.mjs`; approve it once when Claude Code asks. In plugin mode `plugin.json`'s entry of the same name replaces it |
| Claude Code, server only | `claude mcp add devops-multi-agent-team -- node /path/to/devops-multi-agent-team/mcp/server.mjs` |
| Cursor | add to `.cursor/mcp.json`: `{"mcpServers":{"devops-multi-agent-team":{"command":"node","args":["/path/to/devops-multi-agent-team/mcp/server.mjs"]}}}` |
| Any MCP client | stdio command `node /path/to/devops-multi-agent-team/mcp/server.mjs` |

**Then just ask**

> Set up the DevOps team in this project.
> Set it up for Rust, TypeScript and Docker, and add Ollama for local models.
> Define Elm as a language for this project.
> Show me how `cargo test` would run in the sandbox.
> Which of the tools this project needs are not installed?

The assistant calls `detect_project`, shows you a plan from
`install_devops_team` (`apply=false`), and writes only after you say yes. The
`setup_project` prompt (it appears as a slash command in clients that list MCP
prompts) walks the same steps.

| Tool | Does |
|------|------|
| `list_languages`, `get_language` | the 40 languages, each with install, validation, security tools, style and how it interacts with the others |
| `list_services`, `get_service` | Docker, Podman, devcontainers, Kubernetes, AWS, GCP, Azure, Cloudflare, Claude, GPT, Gemini, Ollama, Multipass, Lima, Vagrant, QEMU |
| `detect_project`, `status` | what the project's files show; what is installed |
| `install_devops_team` | skill, agents, commands for Cursor and/or Claude, `.devops/` data, profile, sandbox doc, ignore block in `.git/info/exclude` (`.gitignore` outside git) (plan unless `apply=true`) |
| `get_profile` | the profile it would write, without writing |
| `ensure_gitignore` | add or repair the ignore block (`.git/info/exclude`, or `.gitignore` outside git) |
| `add_language` | define a language that is not listed; validated, saved to `.devops/languages.local.json` |
| `check_toolchain` | is each tool installed? (`<tool> --version` only; env vars reported as set/unset, never their values) |
| `sandbox_plan` | prints the container command that runs a command for a language in the sandbox; runs nothing |
| `module_map` | research: modules, languages and the imports between them as a Mermaid mind map |
| `mindmap_tree`, `mindmap_note` | the mind map as a tree (project > module > file > class > function; documentation > folder > doc > section; libraries) with cross links (imports, calls, uses, documents, links, tests); `tree` opens any node with its doc comment, README or doc sections and note, and its neighbours' docs, to explain how it works; `note` writes hand-made documentation for a node into `.devops/mindmap/NOTES.md` |
| `mindmap_overview` | the project at a glance in about forty lines (what it is, size, where it starts, how it runs, its parts, docs to read first, main libraries, what to watch out for); for plain chat, no team needed |
| `mindmap_build`, `mindmap_status`, `mindmap_query` | the full repository mind map (the Researcher owns it in a team run): docs (title, summary, links), modules, file imports and importers, functions and classes with signatures and line ranges, call links, libraries (declared vs used), tests and docs per file, and names defined twice; `status` lists only the files changed since it was saved; `query` answers one question (symbol, file, module, library, search) so files are not re-read to find it |
| `reuse_search` | research: where a term (or a spelling variant) already appears in code, comments and docs (Markdown, LaTeX, ...); secret files skipped |
| `tag_history` | versions: how the project changed between git tags (commits, files, lines, directories, languages, commit types), unreleased work and a suggested bump; `save` keeps a snapshot in `.devops/tags/` |
| `tag_plan`, `tag_create` | versions: plan the next semver tag; create one annotated local tag. Never pushes, moves or deletes a tag |
| `config_get`, `config_set` | read the project standards in effect (and where each value comes from); change one in `.devops/standards.json` (`set`, `unset`, `add`, `remove`), validated first, planned unless `apply=true` |
| `lint_check`, `lint_commands` | the lint gate: every comment rule, line length, function size, unused symbols, security patterns, outdated APIs and debug leftovers on the added lines, each with its fix, verdict PASS or DENY; with the Push JSON it also checks that every open-source linter (ruff, ESLint, clippy, shellcheck, semgrep, gitleaks, osv-scanner, ...) ran in the sandbox and exited 0. `lint_commands` lists those commands |
| `comment_audit` | the comments a change adds (staged, working tree or `base...head`), as ready-to-paste Conventional Comments: restating comments, commented-out code, questions or notes left in code, process notes, bare TODO/FIXME, signature-only docs, over-commented files, comments that narrate the implementation, concept or usage text that may belong in the docs; with the Push JSON `comments` and `docs` lists it also flags comments the Coder did not justify and unlisted doc changes |
| `story_parse` | read a story in this format (an issue body) into structure: id, project, baseline, status, depends on, needed by, OLD and NEW blocks |
| `story_new`, `story_link` | create a story from the template and link stories (depends-on, absorbs, supersedes, refines, shares-contract); both sides stay in step and a cycle is refused |
| `story_graph` | link one or several catalogs (two projects): dependency order, ready work, longest chain, cross-project edges, patterns, a Mermaid graph, and every inconsistency |
| `story_check` | QA check: each OLD block is verbatim from the baseline commit at the lines it names, and the story has its NEW label, Dependencies, Why and Not verified |
| `story_guidance` | the index for future work: order, patterns, decisions, links |
| `formal_check` | Lean 4 (optional): find `sorry`, `admit`, axioms and uncovered code in `.lean` files and validate the Push JSON `formal` rows; read-only |
| `cleanup_brief`, `cleanup_scan` | cleanup: turn a plain-English statement into a brief (goals, scope, thresholds, constraints); find duplicated blocks, long or deeply nested functions, functions with many parameters and noisy or commented-out code, ranked, with a suggested refactor; `save` a baseline and `compare` after |
| `ghas_plan` | GitHub Advanced Security: CodeQL, dependency review and Dependabot files for your languages and package managers, `SECURITY.md`, a ruleset template, and the settings commands for **you** to run |
| `board_create_sprint`, `board_add_goal`, `board_move_goal` | the goal board (`references/board.md`): open a sprint, put a goal on it (or in the backlog), move a goal one step at a time or to `blocked` |
| `board_allow_same_team` | Orchestration only: let one authoring team judge its own goal once, with a reason, when resources are low; the first judged hand-off or judging assignment uses it up |
| `handoff_send`, `handoff_route`, `handoff_ack`, `handoff_close` | hand-offs between seats (`references/handoff-payloads.md`): the sender sends a checked payload, Orchestration routes an unrouted one, the addressee acknowledges, then closes it |
| `thread_open`, `thread_reply`, `thread_mark_read`, `thread_resolve` | virtual PR threads on a goal's item: open one, reply, mark it read, and resolve it (only the opener) |
| `work_assign`, `work_accept`, `work_complete` | assigned work: Orchestration only assigns it (the server records `assigned_by: "orchestration"`); the assigned seat accepts, then completes it |
| `team_board_open`, `team_item_add`, `team_item_move`, `team_item_signoff` | per-team boards: open a team's own board (its lead is the manager), add a work item (members only), move it as the caller's role under the item rules, and record a security member's sign-off; the lead makes the last move to done |
| `needs_attention` | the team lead's view of what needs a decision: blocked or failed items, and items waiting on security or the person |
| `allocation_plan`, `board_spin_up` | allocation research (`references/allocation-research.md`): plan the teams and seats from the task's streams, each count with its reason, every team judged by one that authored none of its work; then Orchestration opens the sprint, backlogs each stream, and hands each team lead its Sprint Planning and a `seat.setup` payload (recommended `DEVOPS_SEAT`/`DEVOPS_TEAM`, system versions, setup steps; the seat sets itself up) |
| `bug_report`, `bug_issue`, `bug_filed`, `work_decide` | the bug flow (`references/scrum-meetings.md`): a bug raised at the Daily Scrum goes to you as the BA's bug report (issue, reason, proposals, files, lines, snippets, explanation, plan of attack); you answer `/devops bug REPORT fine\|fix N\|fix TEXT`; the team lead puts the issue on the board as a backlog bug goal and assigns it; filing the drafted issue on GitHub is the team lead's job, and `bug_filed` then titles the goal `#<number> <description>` (the draft names the work item hash, kind bug) and lists the number on the goal the bug touches. Work past a seat's limit of three open pieces is held for the BA, who approves or declines it against your objectives or asks you (`/devops load REPORT approve\|decline`) |
| `meeting_schedule`, `meeting_hold` | Scrum meetings (`references/scrum-meetings.md`, `client-and-agile.md`): per-team Planning, Daily (stress/strain + lead reallocations; no repro by default), Refinement; one **joint** Sprint Review (BA roster, live feature demos); per-team Retro. AI↔AI talk about a feature/bug uses **reproduction** (GUI/browser/terminal). Business Analyst attends Planning, Daily, Refinement and Review. Read at `devops://meetings/<sprint>` |
| `goal_merge`, `goal_scan`, `goal_done`, `goal_raise`, `goal_signoff`, `report_prepare`, `report_forward`, `report_new_approach` | the Done chain: each signer runs merge-ok then done (merge-deny with a reason reopens the goal); merge-ok pings the BA, who scans as needed and can hold or deny a step; a team member verifies, the team lead signs Done (another member when the lead wrote it; default: after QA→Security clear), the BA signs when the goal goes on the scheduled Sprint Review and again while Orchestration prepares the merge presentation, Orchestration sends you a merge report (branch, design fit, implementation, risks), and on your denial the BA files the new approach. Seats type `/devops merge-ok|merge-deny|done GOAL` for their own step (never a push grant); every signature is a `chain.signature` envelope. A goal with an unfixed reported bug (a repo issue the goal lists, a QA triage, or a bug report you had fixed) is not signed: the BA's step is denied as "bug fix needed", the goal returns to the backlog and the coders are told; for a big matter the BA may sign over it with a recorded reason (`--override`). A bug goal is signed against your objective, or after its team lead raised it to the BA (`goal_raise`, `/devops raise`). You are the **client**: your typed `/devops push-ok REPORT...` approves the named reports (only a declared dependency can hold one back; a bare push-ok is refused while reports wait), records who pushed them, and is the final sign-off, outranking missing QA/Security; `/devops merge-deny [REPORT...] REASON` sends them back. Your approval moves virtual history into real history (compressed on the PR branch); `devops-chain.mjs merged` deletes the temporary side branches after you merge |

**How the server is sandboxed.** It works only inside the project folders it
is allowed (`DEVOPS_MCP_ROOTS`, else the client's MCP roots, else its working
directory), never `/` or your home folder, and not through symlinks. It writes
only `.cursor/`, `.claude/`, `.devops/` and `.gitignore` there, and every write
tool plans by default (`ghas_plan` also writes `.github/` security files and
`SECURITY.md` when you say apply). It runs two kinds of program, both with fixed
argument lists, no shell and a bare environment: `<tool> --version` for an id in
the data files, and read-only `git` for the tag tools (hooks off; one local
`git tag -a` on request; never a push, a tag move or a delete).
`DEVOPS_MCP_NO_GIT=1` turns the tag tools off. It makes no network requests and
never returns a secret. Commands inside language and service entries are
guidance for the team; the server does not execute them.

**Thought files stay out of git.** Research notes, review threads, QA notes and scratch live in
`devops-skill/thoughts/non-final/` (open work) and `devops-skill/thoughts/final/` (closed work),
next to the tools in `devops-skill/kit/`. The managed block in `.git/info/exclude` ignores all of
`devops-skill/`, and is repaired if damaged. The tests check this against real `git check-ignore`
and `git status`.

## Languages, services and the sandbox

- [`LANGUAGES.md`](LANGUAGES.md) / `languages.json`: 40 languages (C, C++,
  assembly, Rust, Zig, Go, Swift, C#, F#, Java, Kotlin, Scala, Clojure, Python,
  Ruby, PHP, Perl, Elixir, Erlang, Haskell, OCaml, R, Julia, Fortran, COBOL,
  TypeScript, JavaScript, HTML, CSS, Dart, Lua, GDScript, WebAssembly, shell,
  PowerShell, SQL, Terraform, containers, CI workflows). **Layers
  (web, backend, systems, game, scripting, infra, data, science) are sorting
  tags, not restrictions**: any language works for any purpose. The guide also
  lists what was stripped from the requested list and why.
- [`SERVICES.md`](SERVICES.md) / `services.json`: 16 services in five
  categories, each with setup steps, environment variable *names*, what only a
  human may run, and how it helps sandbox the work.
- **Sandbox.** Seats run build, test and scan in a container: network off
  (except dependency install), read-only root, no capabilities, non-root, no host
  secrets. Each language has an official `sandboxImage` (or `null` = host only
  with your OK). `.devops/sandbox.md` has the commands.
  Cloud and Kubernetes: seats plan, the human applies.

## Standards (`standards.json`)

One JSON file sets the limits the audit and the cleanup scan use. The package
ships `standards.json`; the installer creates `.devops/standards.json`, and a
project sets only the keys it wants to change. Any other key, a wrong type or a
value out of range stops the run with the problem named.

```json
{
  "schemaVersion": 1,
  "defaults": {
    "lineLength": { "comment": 80, "code": 100 },
    "function": { "maxLines": 30, "maxNesting": 3, "maxParams": 4 }
  },
  "languages": { "python": { "lineLength": { "code": 88 } } }
}
```

- `defaults`: line lengths (comments and code), function size, nesting, parameters,
  duplicated blocks, magic numbers (allowed numbers, test files), comment density, and scan size.
- `interface`: the relaxed comment limits for interface files (`.h`, `.d.ts`, ...).
- `languages`: per-language overrides of any value in `defaults`.
- `linters`: per language (or `all`), the linter tool, the command that runs it, its
  config file and the options that file must set. The MCP server never runs them;
  Coders run them in the sandbox.
- `lint`: rules turned off, excluded paths, and `exemptPublic` for libraries.

### Changing settings by command

Every change is checked before it is written, and only `.devops/standards.json`
changes. A value the validator rejects is refused with the reason.

| Where | Read | Change |
|-------|------|--------|
| Shell | `devops-config show`, `devops-config get defaults.lineLength.code [--language python]` | `devops-config set defaults.lineLength.code 120`, `unset PATH`, `add lint.exclude "vendor/**"`, `remove PATH VALUE`, `rule sec-insecure-url off`; `--dry-run` previews |
| Chat (MCP) | `config_get` | `config_set` (`op`, `path`, `value`); plans unless `apply=true` |
| Claude Code mod | `/devops config`, `/devops config get PATH` | `/devops config set PATH VALUE` (and `unset`, `add`, `remove`, `rule`); chat and agent may run these when fulfilling your intent |
| Slash command | `/config get PATH` | `/config set PATH VALUE`; the agent shows the change and applies it after you agree |

Paths are dotted; write `\.` for a dot inside a key
(`linters.python.options.mccabe\.max-complexity`). Values are JSON when they parse
(`120`, `true`, `[0,1,2]`), else text. `devops-config` is `node scripts/devops-config.mjs`
in this repository.

## Rules built into the workflow

| Rule | Where | Enforced by |
|------|-------|-------------|
| **Lint gate (hard deny)**: comment rules, line length, function size, unused symbols, security, outdated APIs and debug leftovers on added lines, plus the open-source linters run in the sandbox; every finding carries its fix | `lint-rules.md`, `standards.json` `lint` and `linters` | Reviewers DENY on any blocking finding and send the whole list back; the mod runs it on `git commit` |
| **Documentation first** (Markdown, LaTeX, code comments, then code, then the web) | `research-and-reuse.md`, researcher agent | Reviewers reject a brief without it |
| **Repository mind map**, with or without the team: plain chat answers from its overview; in a team run the Researcher refreshes and queries it and carries it into the brief, so other seats read files only at the line ranges given; fewer tokens and no second copy of a function | [`mind-map.md`](skills/devops-multi-agent-team/references/mind-map.md), `project-mindmap` skill, `mindmap_*` tools; `/devops question` / `/devops mind-map --mode …` or plain words | Researcher: map date, definitions and duplicates in scope in the brief; Reviewers: a name it shows defined elsewhere is a re-implementation finding; QA checks the brief carries it |
| **Module mind map + reuse map** before any Coder starts; "new, because ..." must hold up | `research-and-reuse.md`, `module_map`, `reuse_search` | Reviewers: re-implementation is a blocking finding; QA checks the brief |
| **Clean code** (intention-revealing names, small single-purpose functions, DRY with care, no magic numbers, simplicity over cleverness, SOLID where it fits) | `clean-code.md`, `rules/clean-code.md` | Coders write to it; Reviewers label violations; `cleanup_scan` finds magic numbers, vague names, flag arguments, long or deep functions and duplicates |
| **Formal check with Lean 4** (`formal-check.md`; optional, asked per goal) | `formal-check.md`, `proof-writeup-template.md`, `scripts/devops-formal.mjs` | When on: Researchers pick formal targets, Coders write Lean and a write-up for advanced logic, Reviewers check statement and trace, QA runs the Lean gate |
| **Single purpose, closed for modification, Liskov substitution** (`oop-principles.md`, from two explainer videos) | `oop-principles.md`, `rules/clean-code.md` | Reviewers block new type switches and children that refuse what the parent promises; `cleanup_scan` goal `oop` finds `type-switch`, `lsp-risk` and `multi-purpose-name` |
| **Clean-code topics** (`clean-code-topics.md`, from the s4.codes lesson list) | `clean-code-topics.md` | Reviewers apply the Smell and Do pairs; titles only were visible, sources named in the doc |
| **Comment budget and line remarks**: Coders default to zero new comments, list each one they keep in the Push JSON `comments`, and self-audit; Researchers mark the comment-worthy code; Reviewers leave line remarks on over-commented lines in the virtual PR; questions and notes go to the PR Q&A, never into code | `comment-standards.md` §6-7, `comment_audit` | the mod audits every `git commit` (`/devops comments strict` refuses blocking ones); reviewers post the findings |
| **Comment gate and docs balance (strict: every finding blocks)**: before writing, keeping or changing a comment, Coders, Cleaners and Reviewers ask (a) is it needed, (b) does it say more than the code that runs, (c) does it name the design choice (the existing concept or helper used, and why) without narrating the implementation; interface files (`.h`, `.d.ts`, `.pyi`, ...) carry the design-level explanation of their source under relaxed limits, and the source does not repeat it; docs are updated with the smallest edit, and a new doc file is only for a new system or module (Push JSON `docs` `new`); each language's standard comment style guide applies and is checked where it can be | `comment-standards.md` §0a, §2b, §6b-6c, `languages.json` `docs.guide`, `comments.interface`, `comments.checks` | Reviewers balance comments against docs; `comment_audit` blocks narration, concept text in source files, repeats of the interface, new or unlisted doc files and style-guide breaks |
| **Comment standards**: no comment just because code was added (self-explanatory code gets none); intent not mechanics; no comment rot; no commented-out code; doc comments only where the contract is not obvious or API docs are published; TODO/FIXME/NOTE for real follow-up | `comment-standards.md`, `rules/comments.md`, per-language `docs` | Reviewers: strict and blocking; Conventional Comments labels |
| **Cleanup** (`devops-cleanup` skill, `/cleanup`): a plain-English statement drives behavior-preserving cleanup: fewer comments, duplicated code replaced by calls to one implementation, big functions split into helpers, one small step at a time | `skills/devops-cleanup/`, `cleanup_*` tools | Researchers scan and plan; the cleaner changes one thing per step; Reviewers check only structure changed; QA compares before/after numbers |
| **Stories**: change proposals tied together (OLD verbatim from a baseline commit, then NEW; typed links; patterns and decisions kept for later) | `stories.md`, `/story`, `story_*` tools | Research organizes; Coders OLD then NEW; Reviewers the concepts; QA then Security approve; `story_check` proves OLD |
| **Virtual PR and virtual git** | `virtual-git.md`, `side-work.md` | the mod refuses push, PR and branch creation until QA PASS and your go |
| **Failed checks are watched and corrected, then stop** | `monitoring.md`, the mod's monitor | records `check-ledger.md`, bounded retries (default 3), never loosens a check |
| **Tags are the project history** | `version-tags.md`, `tag_*` tools | pushing a tag is gated like any push |
| **GitHub Advanced Security** | `github-advanced-security.md`, `ghas_plan` | settings stay a human step |

The installer also copies the reuse and comment rules into `.cursor/rules/`
(always on) and `.claude/rules/`, and installs a Coder agent that follows them.
`rules/clean-code.md` and `rules/comments.md` are generated from the `Summary` block of their
reference (`npm run rules`); edit the reference, and CI fails if a rule file is out of date.

## How it fits together

```text
languages.json + services.json + standards.json ──▶ MCP server / devops-setup ──▶ .devops/project.md, sandbox.md, devops-skill/kit/, .git/info/exclude block
                                           │                          ▲
                                           └──▶ mod: status line, /devops │ read first by every seat (SKILL.md, Step 0)
```

The skill no longer carries a "Repo alignment" paragraph per project. That
paragraph (build command, scanners, protected paths, release rules) is the
project's `.devops/project.md`, generated from the language and service data and
then finished by hand.

## Use it

### A. Through chat

See "Install through chat (MCP)" above.

### B. From the command line

```bash
node scripts/devops-setup.mjs detect  --dest ~/my-project
node scripts/devops-setup.mjs install --dest ~/my-project --target both --dry-run
node scripts/devops-setup.mjs install --dest ~/my-project --target both
node scripts/devops-setup.mjs sandbox --lang rust --dest ~/my-project -- cargo test --locked
```

Other commands: `list [--with-services]`, `profile`, `status`, `check id,id`.
Existing files that differ are kept unless `--force`; `--lang` and `--services`
override detection.

### C. As a Claude Code plugin / mod

```bash
claude --plugin-dir /path/to/devops-multi-agent-team
```

The plugin provides the skill, agents, commands, the MCP server and the mod.

## The mod

The plugin's mod (`hooks/register.ts`, with `hooks/orchestrate.ts` and `hooks/brief.ts`) sets
Claude Code up for the team and keeps agents from spending tokens to learn the skill.

**Claude-only setup.** With the plugin installed, `/devops setup claude` (add
`--dry-run` to preview, `--share-config` to commit `.devops/`) runs `devops-setup init --plugin`:
it writes only `.devops/` and the thought folders, kept out of git in `.git/info/exclude`. Nothing
is copied into `.claude/` or `.cursor/` and no tools kit is needed, because the plugin supplies the
skill, agents, commands and MCP server. The shell form is
`node scripts/devops-setup.mjs init --plugin --dest .`.

| Hook | Does |
|------|------|
| `tool.call` Bash (lint gate) | On `git commit` it runs `devops-lint check` (comment rules and code rules) on the staged diff (the working tree for `-a`) and adds the findings to the result. `/devops comments strict` refuses a commit with blocking findings; `off` turns it off. |
| `tool.call` Bash (monitor) | A command that matches a validation command in the language data (for example `cargo test`, `npm run lint`) and fails is recorded in `devops-skill/thoughts/non-final/check-ledger.md`, counted per check, and the result gets a reminder to reproduce, fix the cause and re-run; at the retry cap (default 3, set in `project.md`) it says stop and escalate. A pass clears the count. `/devops monitor off` turns it off. |
| `prompt.compose` (mind map) | When `.devops/mindmap/OVERVIEW.md` exists, adds it to the session prompt, so plain chat knows the project at a glance with no tool call, with or without a DevOps profile. |
| `session.start` | Runs `devops-setup detect --json`, shows `devops: rust+typescript` in the status line, registers `/devops` and the `devops_brief` tool, and reads the project's standards into one line. |
| `tool.run` `devops_brief` | The model reads the skill in pieces: no input gives the index (about 8 KB instead of 250 KB), `topic` the one best section (usually 1 to 4 KB), `role` a seat's brief. Role files rank below the references for a topic, since `role` serves them. |
| `command.run` `/devops` | Gates (`status`, `on`/`off`/`enable`/`disable`, `skill`, `skills`, `push-ok`, `allow-branch`, …) plus **skill modes** (`help`, `question`, `mind-map`, `clean`, `stage`/`ci`, `allocate`, `goal`, `story`, …) with `--mode` orchestration cards that name MCP tools. Trigger one CI/CD pod (`stage --mode research`) or allocate pod/agent goals. Seats use the same modes. Free-form wording maps to skill modes ("run research" → `stage`) or to gate aliases you typed (`push` → `push-ok`). Gate words run only when you type them. `/devops on|off` (and `enable|disable`) turns the whole skill on or off and writes `.claude/settings.json`; `/devops skill on|off NAME` writes `skillOverrides`. One-shot `/devops push-ok` (or chat `push`) takes no `on|off` and is final. Does not stop development. If your order conflicts with skill protocol, obey you. |
| `tool.call` Bash | Refuses `git push` and every `gh` write (anything but a read such as `view`, `list`, `status`, `diff`, `checks`, or a `gh api` GET) until you typed `/devops push-ok` (or said `push` in chat) for the current tree (consumed by that push). Default path still expects QA PASS and Security CLEAR; your grant alone overrides a miss and records it so progress is not deadlocked (`/devops gates off` does not lift the push check; `/devops off` turns the skill off and lifts the checks). A push must be typed exactly as `git push <remote> HEAD[:<branch>]` (`-u`, `-q`, `-v`, `--force-with-lease[=<branch>:<sha>]` allowed), from the session's checkout; any other command that names `push` or `send-pack` is refused. A `gh` write that names a repository (`-R`, `repos/<owner>/<repo>` in `gh api`) must name this checkout's `origin`; `gh pr merge`, gh aliases and extensions are refused. Refuses `git checkout -b`, `git switch -c`, `git worktree add -b`, `git branch <name>` unless you ran `/devops allow-branch <name>` (`/devops gates off` lifts this branch gate only). Detached worktrees and reads pass. If the check itself fails, it refuses. |
| `prompt.compose` | Adds one short section (under 1,200 characters): the languages, `devops_brief` instead of reading the skill whole, the profile, the lint gate and config tools, the standards in effect (line lengths, function limits, allowed numbers), the push gate and the lint mode. An agent starts with what it needs and fetches the rest by piece. |

Limits, stated plainly:

- It guards the **Bash tool** and every tool of any GitHub MCP server (a tool
  named `mcp__<server>__<tool>` whose server name contains `github`) that is
  not a read (`get_*`, `list_*`, `search_*`, `*_read`). `push_files`,
  `create_or_update_file` and `delete_file` are always refused, since they
  write content that is not the checked `HEAD`, and so are
  `merge_pull_request`, `enable_pr_auto_merge` and `update_pull_request_branch`:
  you merge on GitHub. Every other write needs the same check and must name
  this checkout's `origin` repository. Other write paths still need your
  permission settings.
- A push must be a command of its own, typed exactly, with the shell in the
  session's checkout. A chain (`git commit && git push`, `&`, `{ }`), a wrapper
  (`timeout`, `sudo`, `bash -c`), a prefix, quoting, `-C`, `--git-dir`, `-c`, an
  alias, or a shell left in another checkout by an earlier `cd` is refused,
  because the check reads `HEAD` before the command runs. The session's
  checkout is the repository holding the session root; when the session was
  opened above its repositories (the root is not in one), it is the repository
  the shell is in, if that lies under the root. `/devops push-ok` reads the
  tree there too, so `cd` into the repository before granting. A git alias whose
  body pushes or starts with `!`, directly or through another alias, is
  refused in any command, and so are `push.followTags`,
  `push.recurseSubmodules` and `remote.<name>.mirror`. A git command with a
  `$…` or backtick expansion outside literal text, or with `GIT_*=`,
  `HOME=` or `XDG_CONFIG_HOME=` before it, is refused too, since either can
  hide a push.
- The gate an agent cannot pass alone is `/devops push-ok` (or chat `push`),
  a one-shot typed command from you (no `on|off` parameter). While the skill
  is on, your grant alone authorizes one push; a missing QA PASS or Security
  CLEAR is recorded as an override rather than a refusal. `/devops off` (or
  `disable`) turns the skill off and writes project `enabledPlugins`. The
  grant is consumed by one push.
- Any command that names `push` or `send-pack`, with quotes and backslashes
  removed, counts as a push, except the literal message text of `git commit`,
  `git tag` and the like (`<<'EOF'` here-documents included, `<<-` not),
  `git stash push`, and commands that only read or print (`git log`,
  `git status`, `grep`, `echo`, `printf`, `cat`, a `gh api` GET). A word built
  at run time outside a git command (a variable, `printf`, a script, a git
  hook) is not seen, and neither is a program that git config runs
  (`core.fsmonitor`, `core.pager`, `diff.external`, `core.sshCommand`) if
  the config file is edited directly; the skill's rules and your review
  remain the control for those.

## Develop

```bash
npm test      # data check, setup CLI and MCP server tests, claude plugin validate, claude plugin test
```

Tests for the setup CLI are `scripts/devops-setup.test.mjs` and for the MCP
server `mcp/server.test.mjs` (node:test); the mod's are `hooks/*.test.ts` (run by `claude plugin test`).

```bash
node scripts/mcp-smoke.mjs [--with-claude]   # pack, install, set up fresh projects, talk to the MCP servers
```

### Continuous integration

| Workflow | When | Checks |
|----------|------|--------|
| `ci.yml` | every push and pull request | Unit tests on Node 18 and 22. The MCP smoke test: `npm pack` and install as a person downloads it, then set up fresh git projects through `devops-setup init`, through chat (the package's MCP server: detect, plan, apply) and in plugin mode, calling `status`, `config_get` and `lint_check` over stdio and checking `git status` stays clean. The plugin as Claude Code loads it: `claude plugin validate`, `claude plugin test`, and the plugin's MCP server connecting (`claude --plugin-dir . mcp list`). On a pull request, the lint gate on every line it adds. No API key. |

## Licence

MIT, see [LICENSE](LICENSE).
