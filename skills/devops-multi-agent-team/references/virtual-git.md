# Virtual PR and virtual git

The whole policy in one place. The detail lives in the files linked from
each step; this page is the map and the invariants. Nothing here is
optional: it is how the team keeps the real branch free of churn while
agents argue, review and rewrite.

## The idea

Work in progress lives in a **virtual PR**, not on the real branch:

| Part | Where | Real branch sees it? |
|------|-------|----------------------|
| Review thread, Q&A, Handoffs | `devops-skill/thoughts/non-final/review-<seat-id>.md` | never |
| Push JSON (what changed, hunk by hunk) | `push-<seat-id>.json` | never |
| Research brief, reuse map, module mind map, comment-worthy code | `research-<seat-id>.md` | never |
| Line remarks, questions and notes between Coder and Reviewer | review thread `## Line remarks` and `## Q&A`, Push JSON `qa` | never (and never in code comments) |
| QA verdict, triage, check ledger | `qa-…`, `triage-…`, `check-ledger.md` | never |
| The Coder's code | a **detached git worktree** off the integration SHA (the "skill side-branch") | never |
| Team board, seat registry, feedback ledger | fixed-name files in `non-final/` | never |

All of it is gitignored (the installer writes the `.gitignore` block).
Agents can track history and talk because the thread and the worktree
exist; the real branch stays clean until the work is approved.

## Lifecycle

1. **Stay on the current real branch.** Never create a branch (`git
   checkout -b`, `git switch -c`, `git worktree add -b`) unless the human
   named it in that turn. Cloud-agent templates do not authorize one. If the
   human *does* allow a side branch for other work, merge it back with
   `git merge --no-ff` and do **not** delete it first, so history and review
   stay aligned.
2. **Cut a side-branch**: a name the skill tracks (`side/<dept>-<topic>`),
   backed by a detached worktree the Orchestrator creates with
   `git worktree add --detach` ([side-work.md](side-work.md)). No ref, so
   nothing to push, collide on or delete. The Coder commits only there and
   hands over **by commit SHA**.
3. **Virtual review.** The Coder writes Push JSON and a Handoff before the
   first review. Reviewers compare the JSON to the side-branch tree against
   `<integration-base>`. Then Security, then QA
   ([SKILL.md](../SKILL.md), Reviewer entrypoint).
4. **Nothing reaches the real branch** and no real PR is opened or updated
   until Security is Clear and QA records `Publish gate: PASS`.
5. **Integrate.** The Orchestrator cherry-picks the approved SHAs in the
   declared merge order, re-runs the tests after each, and a QA seat that is
   not an author re-approves the integrated tree
   ([department-pods.md](department-pods.md), Team board). Only mechanical
   conflicts are resolved by the Orchestrator, who then counts as an Author.
6. **Compress and push once.** Closed thoughts move to `final/`
   (local). Keep-commits are replayed with their messages, process files are
   folded away, and the Orchestrator pushes **once, after the human
   authorizes that push** ([thoughts-layout.md](thoughts-layout.md), One push).
7. **Folding several AI branches** (for example `cursor/*`, `claude/*`,
   `codex/*` branches that all land in one place): use a non-fast-forward
   merge so the combine point is visible: `git merge --no-ff <other>
   -m "merge: …"`. Never a silent fast-forward. If the project has a
   one-release-file-per-PR rule, fold the duplicates into the single PR-owned
   file (the profile's "Release rules").

## Invariants (a reviewer or QA seat can check each one)

- No ref was added or moved since spawn except the local PR branch the
  Orchestrator advanced; no upstream is set on a seat's worktree.
- `git ls-remote --heads origin` equals the snapshot taken at spawn.
- A seat never ran `git push`, `fetch`, `stash`, `branch`, `tag`,
  `update-ref`, `gc`, `prune`, `reflog expire`, `worktree remove|prune|move`,
  or `git -c …`, and never used `--no-verify`
  ([side-work.md](side-work.md), What a worktree shares).
- Staging is by explicit path; the diff lists only owned files and none of
  the profile's "Never stage" paths.
- Process output (threads, JSON, probes, SARIF, databases) is absent from
  `git diff --stat <integration-base>...HEAD`.
- Only QA gave the OK to push, the human authorized the push, and the push
  was one.

The Claude mod enforces the mechanical part at the tool layer: it refuses
`git push`, `gh pr create|merge`, and branch creation until QA has recorded
PASS and the person ran `/devops push-ok`.
