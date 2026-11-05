# devops-multi-agent-team

A multi-agent DevOps workflow for Cursor and Claude Code, extracted from
the copies that lived in three projects (Bailey-Forbes-Flinstone,
KeyQuorum, Homework-Central), plus two things those copies did by hand:

1. **A language setup file** ([`languages.json`](languages.json), explained in
   [`LANGUAGES.md`](LANGUAGES.md)) that says what build, test, lint, scan and
   style mean for C, C++, assembly, Rust, Go, C#, Java, Kotlin, Python,
   TypeScript, JavaScript, CSS, shell, PowerShell, SQL, Terraform, containers
   and CI workflows, and how web, backend, systems, scripting, infra and data
   layers meet.
2. **A Claude mod** (`hooks/`) that detects the languages in the open project,
   adds a `/devops` command, and refuses `git push`, `gh pr create|merge` and
   git-branch creation until QA has recorded a PASS and *you* have said go.

## What is in it

| Path | What |
|------|------|
| `skills/devops-multi-agent-team/` | The skill: `SKILL.md` and `references/` (seat ids, pods, side worktrees, Push JSON, QA policy, SOC 2 review, templates). Language-neutral. |
| `agents/` | Nine role prompts: researcher, reviewer, CI, quality (QA), security, ticket lead, verifier, integrator, communicator. |
| `commands/` | `/goal`, `/create-subagent`, `/code-review`, `/repro`, `/triage`. |
| `languages.json`, `LANGUAGES.md` | The language setup file and its guide. |
| `templates/project.md` | Skeleton of the per-project profile (`.devops/project.md`). |
| `scripts/devops-setup.mjs` | `list`, `detect`, `profile`, `install`. No dependencies, Node 18+. |
| `hooks/`, `types/`, `.claude-plugin/` | The Claude mod and plugin manifest. |

## How it fits together

```text
languages.json ──▶ devops-setup detect ──▶ devops-setup install ──▶ .devops/project.md   (per project, hand-edited, committed)
                         │                                              ▲
                         └──▶ mod: status line, /devops, prompt context │ read first by every seat (SKILL.md, Step 0)
```

The skill no longer carries a "Repo alignment" paragraph per project. That
paragraph (build command, scanners, protected paths, release rules) is the
project's `.devops/project.md`, generated from the language data and then
finished by hand.

## Use it

### A. In a project, for Cursor and/or Claude Code

```bash
node scripts/devops-setup.mjs detect  --dest ~/my-project
node scripts/devops-setup.mjs install --dest ~/my-project --target both   # cursor | claude | both
```

Copies the skill, agents and commands into `.cursor/` and/or `.claude/`,
`languages.json` and `LANGUAGES.md` into `.devops/`, writes
`.devops/project.md` for the detected languages, and adds the `.gitignore`
block for `.devops/thoughts/`. Existing files that differ are kept unless you
pass `--force`; `--dry-run` previews; `--lang rust,typescript` overrides
detection. Then fill in the "Fill in by hand" section of the profile and
commit it.

### B. As a Claude Code plugin / mod

```bash
claude --plugin-dir /path/to/devops-multi-agent-team
# or, once the repo is on GitHub:
#   /plugin install devops-multi-agent-team --marketplace <owner>/devops-multi-agent-team
```

The plugin provides the skill, agents and commands under the plugin
namespace, plus the mod.

### C. Just the language setup

Read `LANGUAGES.md`; copy an entry from `languages.json`; or override one per
project in `.devops/languages.local.json`.

## The mod

| Hook | Does |
|------|------|
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
npm test      # language file check, setup CLI tests, claude plugin validate, claude plugin test
```

Tests for the setup CLI are `scripts/devops-setup.test.mjs` (node:test); the
mod's are `hooks/*.test.ts` (run by `claude plugin test`).

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

None chosen yet. Add a `LICENSE` file (or an SPDX `license` in
`.claude-plugin/plugin.json`) before sharing the repository.
