# Project profile

Read by the Orchestrator and every seat before any work
(`skills/devops-multi-agent-team/SKILL.md`, Step 0). Generated on
{{DATE}} by `devops-setup install` from `languages.json`. **Edit it
freely and commit it**: this file, not the skill, is where this
project's rules live. Re-run `devops-setup profile` to see what the
generator would write now.

## Project

- Integration base: `<branch or PR the work lands on>`
- Instruction files (they win over the skill): {{INSTRUCTION_FILES}}
- Default branch rule: stay on the current non-default branch; never
  create a git branch unless the human names it in that turn.

## Languages and layers

{{LANGUAGES}}

## Departments

Departments are named by function; one Coder and one Researcher per
department per item ([department-pods.md](skills/devops-multi-agent-team/references/department-pods.md)).

{{DEPARTMENTS}}

## Fast validation

Run the lines for every language the change touches, then the
cross-language ones. Replace `<...>` placeholders with this project's
real command once, here. A command that cannot run is `NOT RUN`.

{{VALIDATION}}

## Security

{{SECURITY}}

## Services

Supporting systems this project uses (containers, cloud, AI, VMs). Names of
environment variables only; values live in the environment or a secret manager.

{{SERVICES}}

## Sandbox

{{SANDBOX}}

## Comments and documentation

Coders follow `comment-standards.md`: **no comment is added just because code
was added** (self-explanatory code gets none); intent not mechanics; no comment
rot; no commented-out code; doc comments only where the contract is not obvious
or where API docs are published; TODO/FIXME/NOTE only for real follow-up;
complete sentences; links for borrowed algorithms. Reviewers enforce it as
blocking, on the virtual PR as line remarks; questions and notes go in the PR Q&A,
never in code. Coders run `comment_audit` before handoff and list the comments they
keep in the Push JSON `comments`. Does this project publish generated API docs? `<yes (which packages) | no>`.
Per language (the doc check applies only if the answer is yes):

{{DOCS}}

## Style rules

{{STYLE}}

## Opt-in presets

Adopt a preset by copying its rules into the project's own style rules and
pinning them in tooling.

{{PRESETS}}

## Cross-language boundaries

{{INTERACTIONS}}

## Setup notes

{{NOTES}}

## Fill in by hand

- **Sensitive paths** (regex for the review-bot exemption, see
  `qa-publish-policy.md`): `<e.g. ^(src/auth/|src/crypto/|\.github/|Dockerfile|.*\.lock$)>`
- **Never stage:** `<local symlinks, generated files, files a release workflow owns>`
- **Shared files** (claim on `team-board.md` before editing): `<build files, lockfiles, shared schemas, .gitignore>`
- **Release rules:** `<changelog / version / lock rules the QA seat checks, or "none">`
- **Tooling wired:** CI `<GitHub Actions | Buildkite | none>` · quality `<Sonar | none>` · security `<Snyk | none>` · tickets `<Linear | GitHub issues | none>` · browser `<MCP | none>`
- **Story catalog:** project code `<XX>`, baseline `<branch sha>`, linked catalogs `<other repos' .devops/stories paths>`, issue tracker `<GitHub issues>`
- **Cleanup thresholds** (defaults in `languages.json` `cleanup`, from `clean-code.md`; change here when the project wants different ones): function lines `30`, nesting `3`, parameters `4`, duplicate block `6` lines, repeated literal `2`
- **Extension points** (the parents, interfaces or registries new behavior must plug into, and where children are listed): `<...>`
- **Project conventions beyond clean-code.md** (naming, structure, formatter and linter commands): `<...>`
- **Docs to read first** (the Researcher reads these before any code): `<README, docs/, ADRs, .tex sources, runbooks, schema files>`
- **Test directories** (weakened-test checks look here): `<tests/, src/**/tests.rs, **/__tests__>`
- **Blocking boundary rules** (a Reviewer blocks a change that breaks one): `<e.g. the kernel only orchestrates drivers; the web layer never reads the database>`
- **Default branch / integration base:** `<main>`; **check retry cap** for auto-correction: `3`
- **Shipped feature sets / targets** to build in full: `<e.g. cargo features, dotnet configurations, wasm target>`
