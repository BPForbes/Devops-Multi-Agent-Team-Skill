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

## Style rules

{{STYLE}}

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
- **Shipped feature sets / targets** to build in full: `<e.g. cargo features, dotnet configurations, wasm target>`
