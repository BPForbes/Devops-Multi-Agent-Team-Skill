# devops-multi-agent-team

A multi-agent DevOps workflow for Cursor and Claude Code, extracted from
the copies that lived in three projects (Bailey-Forbes-Flinstone,
KeyQuorum, Homework-Central), plus two things those copies did by hand:

1. **A language setup file** ([`languages.json`](languages.json), explained in
   [`LANGUAGES.md`](LANGUAGES.md)) that says what build, test, lint, scan and
   style mean for 39 languages and how they interact, plus a services file
   ([`services.json`](services.json)) for Docker, cloud, AI and VMs and a
   sandbox policy, installable through chat with an MCP server.
2. **A Claude mod** (`hooks/`) that detects the languages in the open project,
   adds a `/devops` command, and refuses `git push`, `gh pr create|merge` and
   git-branch creation until QA has recorded a PASS and *you* have said go.

## What is in it

| Path | What |
|------|------|
| `skills/devops-multi-agent-team/` | The skill: `SKILL.md` and `references/` (seat ids, pods, side worktrees, Push JSON, QA policy, SOC 2 review, templates). Language-neutral. |
| `agents/` | Nine role prompts: researcher, reviewer, CI, quality (QA), security, ticket lead, verifier, integrator, communicator. |
| `commands/` | `/goal`, `/create-subagent`, `/code-review`, `/repro`, `/triage`. |
| `languages.json`, `LANGUAGES.md` | The language setup file (39 languages) and its guide. |
| `services.json`, `SERVICES.md` | Docker, cloud, AI and VM services, the sandbox policy, and their guide. |
| `mcp/server.mjs` | The MCP server for installing and managing through chat. |
| `templates/project.md` | Skeleton of the per-project profile (`.devops/project.md`). |
| `scripts/devops-setup.mjs` | `list`, `detect`, `profile`, `install`, `status`, `check`, `sandbox`. No dependencies, Node 18+. |
| `hooks/`, `types/`, `.claude-plugin/` | The Claude mod and plugin manifest. |

## Install through chat (MCP)

The package ships an MCP server (`mcp/server.mjs`, Node 18+, no dependencies)
so you can set up any project by talking to your assistant instead of copying
files.

**Connect it once**

| Client | How |
|--------|-----|
| Claude Code, as a plugin | `claude --plugin-dir /path/to/devops-multi-agent-team` (the plugin's `.mcp.json` registers the server), or after the repo is on GitHub `/plugin install devops-multi-agent-team --marketplace <owner>/devops-multi-agent-team` |
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
| `list_languages`, `get_language` | the 39 languages, each with install, validation, security tools, style and how it interacts with the others |
| `list_services`, `get_service` | Docker, Podman, devcontainers, Kubernetes, AWS, GCP, Azure, Cloudflare, Claude, GPT, Gemini, Ollama, Multipass, Lima, Vagrant, QEMU |
| `detect_project`, `status` | what the project's files show; what is installed |
| `install_devops_team` | skill, agents, commands for Cursor and/or Claude, `.devops/` data, profile, sandbox doc, `.gitignore` block (plan unless `apply=true`) |
| `get_profile` | the profile it would write, without writing |
| `ensure_gitignore` | add or repair the block that keeps `.devops/thoughts/` out of git |
| `add_language` | define a language that is not listed; validated, saved to `.devops/languages.local.json` |
| `check_toolchain` | is each tool installed? (`<tool> --version` only; env vars reported as set/unset, never their values) |
| `sandbox_plan` | prints the container command that runs a command for a language in the sandbox; runs nothing |
| `module_map` | research: modules, languages and the imports between them as a Mermaid mind map |
| `reuse_search` | research: where a term (or a spelling variant) already appears in code, comments and docs (Markdown, LaTeX, ...); secret files skipped |
| `tag_history` | versions: how the project changed between git tags (commits, files, lines, directories, languages, commit types), unreleased work and a suggested bump; `save` keeps a snapshot in `.devops/tags/` |
| `tag_plan`, `tag_create` | versions: plan the next semver tag; create one annotated local tag. Never pushes, moves or deletes a tag |
| `comment_audit` | the comments a change adds (staged, working tree or `base...head`), as ready-to-paste Conventional Comments: restating comments, commented-out code, questions or notes left in code, process notes, bare TODO/FIXME, signature-only docs, over-commented files; with the Push JSON `comments` list it also flags comments the Coder did not justify |
| `story_parse` | read a story in the FL/KQ format (an issue body) into structure: id, project, baseline, status, depends on, needed by, OLD and NEW blocks |
| `story_new`, `story_link` | create a story from the template and link stories (depends-on, absorbs, supersedes, refines, shares-contract); both sides stay in step and a cycle is refused |
| `story_graph` | link one or several catalogs (two projects): dependency order, ready work, longest chain, cross-project edges, patterns, a Mermaid graph, and every inconsistency |
| `story_check` | QA check: each OLD block is verbatim from the baseline commit at the lines it names, and the story has its NEW label, Dependencies, Why and Not verified |
| `story_guidance` | the index for future work: order, patterns, decisions, links |
| `ghas_plan` | GitHub Advanced Security: CodeQL, dependency review and Dependabot files for your languages and package managers, `SECURITY.md`, a ruleset template, and the settings commands for **you** to run |

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

**Thought files stay out of git.** Installing adds a managed block to
`.gitignore` that ignores everything under `.devops/thoughts/` except
`non-finalized/.gitkeep` and leaves the committed `.devops/project.md` alone.
It is repaired if damaged and warns if another rule ignores all of `.devops/`.
The tests check this against real `git check-ignore`.

## Languages, services and the sandbox

- [`LANGUAGES.md`](LANGUAGES.md) / `languages.json`: 39 languages (C, C++,
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

## Rules built into the workflow

| Rule | Where | Enforced by |
|------|-------|-------------|
| **Documentation first** (Markdown, LaTeX, code comments, then code, then the web) | `research-and-reuse.md`, researcher agent | Reviewers reject a brief without it |
| **Module mind map + reuse map** before any Coder starts; "new, because ..." must hold up | `research-and-reuse.md`, `module_map`, `reuse_search` | Reviewers: re-implementation is a blocking finding; QA checks the brief |
| **Comment budget and line remarks**: Coders default to zero new comments, list each one they keep in the Push JSON `comments`, and self-audit; Researchers mark the comment-worthy code; Reviewers leave line remarks on over-commented lines in the virtual PR; questions and notes go to the PR Q&A, never into code | `comment-standards.md` §6-7, `comment_audit` | the mod audits every `git commit` (`/devops comments strict` refuses blocking ones); reviewers post the findings |
| **Comment standards**: no comment just because code was added (self-explanatory code gets none); intent not mechanics; no comment rot; no commented-out code; doc comments only where the contract is not obvious or API docs are published; TODO/FIXME/NOTE for real follow-up | `comment-standards.md`, `rules/comments.md`, per-language `docs` | Reviewers: strict and blocking; Conventional Comments labels |
| **Stories**: change proposals tied together (OLD verbatim from a baseline commit, then NEW; typed links; patterns and decisions kept for later) | `stories.md`, `/story`, `story_*` tools | Research organizes; Coders OLD then NEW; Reviewers the concepts; QA then Security approve; `story_check` proves OLD |
| **Virtual PR and virtual git** | `virtual-git.md`, `side-work.md` | the mod refuses push, PR and branch creation until QA PASS and your go |
| **Failed checks are watched and corrected, then stop** | `monitoring.md`, the mod's monitor | records `check-ledger.md`, bounded retries (default 3), never loosens a check |
| **Tags are the project history** | `version-tags.md`, `tag_*` tools | pushing a tag is gated like any push |
| **GitHub Advanced Security** | `github-advanced-security.md`, `ghas_plan` | settings stay a human step |

The installer also copies the reuse and comment rules into `.cursor/rules/`
(always on) and `.claude/rules/`, and installs a Coder agent that follows them.

## How it fits together

```text
languages.json + services.json ──▶ MCP server / devops-setup ──▶ .devops/project.md, sandbox.md, .gitignore block
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

| Hook | Does |
|------|------|
| `tool.call` Bash (comment audit) | On `git commit` it runs the comment audit on the staged diff (the working tree for `-a`) and adds the findings to the result. `/devops comments strict` refuses a commit with blocking findings; `off` turns it off. |
| `tool.call` Bash (monitor) | A command that matches a validation command in the language data (for example `cargo test`, `npm run lint`) and fails is recorded in `.devops/thoughts/non-finalized/check-ledger.md`, counted per check, and the result gets a reminder to reproduce, fix the cause and re-run; at the retry cap (default 3, set in `project.md`) it says stop and escalate. A pass clears the count. `/devops monitor off` (typed by you) turns it off. |
| `session.start` | Runs `devops-setup detect --json`, shows `devops: rust+typescript` in the status line, registers `/devops`. |
| `command.run` `/devops` | `status`, `languages`, `setup` (anyone); `push-ok`, `push-reset`, `allow-branch NAME`, `gates on|off` (only when **you** type them; an agent that runs the command is refused). |
| `tool.call` Bash | Refuses `git push`, `gh pr create\|merge\|ready\|edit\|close\|reopen`, `gh release create` unless the newest `qa-*.md` under `.devops/thoughts/` has `Publish gate: PASS` **and** you ran `/devops push-ok` (consumed by that push). Refuses `git checkout -b`, `git switch -c`, `git worktree add -b`, `git branch <name>` unless you ran `/devops allow-branch <name>`. Detached worktrees and reads pass. If the check itself fails, it refuses. |
| `prompt.compose` | Adds a short session section naming the detected languages and pointing at `.devops/project.md`. |

Limits, stated plainly:

- It guards the **Bash tool**. GitHub MCP tools (`create_pull_request`,
  `push_files`, `merge_pull_request`, ...) are not gated by it; use your
  permission settings for those.
- The QA note is a file an agent can write. The gate that an agent cannot
  pass alone is `/devops push-ok`, which only a typed command from you sets.
- Shell parsing is by words, with quoted text ignored. A command built
  through `eval` or a script that itself pushes is not seen; the skill's
  rules and your review remain the control for those.

## Develop

```bash
npm test      # data check, setup CLI and MCP server tests, claude plugin validate, claude plugin test
```

Tests for the setup CLI are `scripts/devops-setup.test.mjs` and for the MCP
server `mcp/server.test.mjs` (node:test); the mod's are `hooks/*.test.ts` (run by `claude plugin test`).

## Where the original content went

| Was (in each project) | Now |
|-----------------------|-----|
| `.cursor/skills/devops-multi-agent-team/` (Flinstone has the fuller set, Homework-Central a shorter one) | `skills/devops-multi-agent-team/`, one generic copy built on Flinstone's fuller reference set |
| `.cursor/agents/devops-*.md`, `.cursor/commands/*.md` | `agents/`, `commands/` (links are relative, so they work under `.cursor/`, `.claude/` and the plugin) |
| `qa-publish-policy.md` (C/ASM, `make`, `.ver` rules) and `codeql-validation-publish-policy.md` (C#/TS/Rust) | one generic `qa-publish-policy.md`; commands and CodeQL settings per language in `languages.json` |
| `Repo alignment` paragraph in each `SKILL.md`; versioning rules in `.cursor/rules/versioning.mdc` | each project's `.devops/project.md` ("Fill in by hand": release rules, never-stage paths, sensitive paths) |
| `.cursor/rules/csharp-no-var.mdc`, the C# / TS / CSS hard rules | opt-in style presets in `languages.json` (`optInStyle`) |
| KeyQuorum's Rust conventions (tests in own file, no secret literals, wire codes append-only) | the `rust` entry's `style` and `setupNotes` |
| thoughts under `.cursor/thoughts/` | `.devops/thoughts/` (same layout, host-neutral) |

Project-only rules (the Flinstone `.ver` lock system, KeyQuorum's contract
and Worker rules, Homework-Central's design tokens) are intentionally **not**
in the package. They stay in those projects' own `AGENTS.md`/`CLAUDE.md`,
which the skill treats as taking precedence.

## Licence

MIT, see [LICENSE](LICENSE).
