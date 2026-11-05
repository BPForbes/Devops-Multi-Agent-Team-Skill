# Tracking versions through tags

Tags are the project's own record of releases. The team reads them to see
how the project changes, and updates them carefully because a published tag
is a promise.

## Collect and read

The MCP tool `tag_history` (or `devops-tags history`) reads the local git
tags and, between each pair of consecutive tags, reports:

- tag, date, commit, subject and whether it is annotated or signed;
- commits, files changed, insertions and deletions;
- the directories that changed most and the languages they belong to;
- the mix of commit types when messages follow Conventional Commits
  (`feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `build`, `chore`, other);
- the version step (major, minor, patch, pre-release) and whether it fits
  what changed (a `feat` in a patch release, a breaking change in a minor).

`save: true` writes the result to `.devops/tags/history.json` so later runs
can compare snapshots (new tags, changed ones, a moved tag is flagged). That
folder is meant to be committed if you want the trend in git.

GitHub-hosted tags and releases: the server makes no network calls. Run `git
fetch --tags` first (the human's OK), or read `list_tags` / `list_releases`
with the GitHub MCP and compare with the local view.

## Update

- `tag_plan` computes the next version from the latest semver tag
  (`major`, `minor`, `patch`, or an explicit `version`), checks the name is
  valid and unused, and prints the exact commands. It changes nothing.
- `tag_create` (with `apply=true`) creates one **annotated** local tag at a
  commit. It refuses a name that exists, a non-semver name, an unknown
  commit, and any attempt to move or delete a tag.
- **Pushing a tag is publishing.** It follows the same gate as a push: QA
  PASS, the human's go, one push. The server never pushes; the mod refuses
  `git push` without both.
- **Moving or deleting a published tag** is never done by a seat. If a tag
  is wrong, publish the next version and say why in the release notes.

## What the Researcher and QA do with it

- Research: read the last few tag-to-tag summaries to learn which modules
  change often and which are stable before proposing where to add code.
- QA: the profile's "Release rules" may require a version bump or a tag for
  certain changes; check the plan against the history (a patch bump for a new
  feature is a finding).
