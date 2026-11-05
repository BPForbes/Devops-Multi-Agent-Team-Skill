# Thought-process files

Working notes are **transient** and **gitignored**. Do not commit
research dumps, review threads, `/goal` logs, `/repro` notes, role
goals, or Push JSON. Committing `non-final/` stores those blobs
in every earlier commit.

| Path | Git | When |
|------|-----|------|
| `devops-skill/thoughts/non-final/` | **Gitignored** | Open work |
| `devops-skill/thoughts/final/` | **Gitignored** | Closed work (kept locally after QA PASS) |

Both folders are created by the installer and listed in `.gitignore`. The
installer (or the MCP tool `ensure_gitignore`) writes and repairs the managed
block between `# >>> devops-multi-agent-team` and `# <<< devops-multi-agent-team`.
It leaves the committed `.devops/` folder (profile, language data, stories)
alone. Check with `git check-ignore -v <path>`. Never `git add` anything under
`devops-skill/thoughts/`. Push JSON lives in `non-final/`
([push-json.md](push-json.md)).

**non-final:** a seat's files are named `<kind>-<seat-id>.md`
(`.json` for Push JSON), with its own id from
[role-identity.md](role-identity.md) (Seat ids): `handoff-`,
`review-` (the thread, named for the Reviewer who opens it),
`security-`, `qa-`, `triage-` (named for the QA seat that opens it;
add `-<n>` for a second), `goal-`, `research-`, `push-` (add `-<topic>` to any of them when a seat works
several items). Also
`formal-<seat-id>/` (a folder: the Lean files and write-ups, [formal-check.md](formal-check.md); `.lake/` stays out), `repro-<topic>.md`, `side-<dept>.md`, `cr-<topic>.md`, and the
Orchestrator's fixed-name `seat-registry.md`, `feedback-ledger.md`
and `team-board.md` (append-only: seat | item | worktree | files and
build-file sections touched | status)
([triage-template.md](triage-template.md),
[side-work.md](side-work.md)). **final** after QA PASS: move
matching files locally; do not `git add`.

If a note must survive clones, put it in `docs/` or skill
`references/`. Do **not** commit “Record Satisfied / Security /
QA” notes. Empty `git status` means nothing to commit. Redact
tokens; prefer exit codes.

## One push (after PASS)

Coders do not commit on the shared checkout. After Satisfied,
Security Clear, **and QA marks PASS** (or the review-bot path in qa-publish-policy.md):

1. Move closed thoughts to `final/` (local).
2. Compress. **Keep reviewer-approved trees as keep-commits**
   (Orchestrator). A **keep-commit** since `<integration-base>`
   includes product,
   pipeline, infra, test, or durable `docs/` marked Satisfied —
   replay in order with original messages. **Fold** the rest so
   the tip tree matches the approved tree.
   `git reset --soft <integration-base>` then one commit is
   allowed **only** when there are no keep-commits. Otherwise
   replay keep-commits, then commit remaining tip-tree delta.
3. `git log --stat <integration-base>..HEAD` and
   `git diff --stat <integration-base>...HEAD`: a path added then
   deleted still ships its blob in history. `git status --short` clean of files you created.

### Step 3a — strip a path from a keep-commit

Throwaway clone (`git clone --no-hardlinks . /tmp/scrub`),
backup a ref, `git filter-repo --force --path <path>
--invert-paths --refs <integration-base>..HEAD`. Re-run step 3.
`git diff $old HEAD` empty. Push `--force-with-lease`. A scrub
after a prior push does **not** unpublish forge blobs.

4. Push once. The Client authorizes this rewrite for this
   skill’s final publish only.

## Scratch files (Reviewer, Security, QA)

The rule is the **class of output**. Threads, Push JSON,
triage/repro, probes, CodeQL DBs, and SARIF never land.
Product, pipeline, infra, tests, and durable `docs/` land as
keep-commits. Prefer `/tmp/probe`. Reserved lower-case names:
`_scratch/` or `.scratch`. Undo with `git checkout -- <exact
path>` — never `git checkout -- .` / `git restore :/` / stash.
Fixed-name probes cannot take a reserved name: delete
immediately. A project's own scan scripts do not see gitignored probes.
