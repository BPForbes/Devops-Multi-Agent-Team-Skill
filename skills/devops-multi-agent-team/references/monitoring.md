# Monitoring failed checks and auto-correcting

A failing check is work to do, not noise. This page says how failures are
noticed, how the team corrects them without cheating, and when it stops and
asks. The same loop applies to a local command and to a CI run.

## What is watched

- **Local checks.** The Claude mod watches Bash commands that match a
  validation command in the profile (for example `cargo test`, `npm run
  lint`, `dotnet build`, `pytest`, `make`). When one exits non-zero it
  appends a row to `.devops/thoughts/non-finalized/check-ledger.md`, counts
  the attempt for that command, and adds a reminder to the tool result with
  the correction loop below. A pass resets the count.
- **Remote CI.** After a PR exists, watch its checks: in a Claude cloud
  session `subscribe_pr_activity`; elsewhere the CI MCP or `gh run list`.
  Treat each red check the same way as a local failure.

## The correction loop

1. **Record** the failure: command or check name, exit code or conclusion,
   the first failing line, attempt number.
2. **Classify**: our change broke it (default), an existing failure, an
   environment problem, or flaky. Calling something flaky needs evidence: a
   rerun of the same commit, with both results in the ledger.
3. **Reproduce** it in the sandbox with the same command CI runs
   ([services-and-sandbox.md](services-and-sandbox.md)). No fix before a
   reproduction (or a note that it cannot be reproduced here).
4. **Fix the cause** on the side-branch, by a Coder who may fix it (a review
   finding's fixer becomes an Author). Update the Push JSON.
5. **Re-run the same check** and show it passing. Then the wider validation.
6. **Stop after 3 attempts** on the same check (the default; the profile may
   change it). Open `triage-<seat-id>.md` with the ledger rows, hand it to
   the human or QA, and do not keep trying variations.

## Never, to make a check pass

- skip, disable, delete, quarantine or loosen a test or assertion;
- weaken a linter rule, a scanner suite, a query filter, a workflow or a
  required check, or raise a threshold;
- add an ignore or suppression comment without the human's agreement;
- push an empty commit, close and reopen a PR, or force-rerun until green;
- rewrite history on a branch you do not own;
- run the failing command on the host when a sandbox image exists.

A fix that needs any of these is not a fix; it is a decision for the human.

## Ledger format

Append-only, one row per observation, no secrets, no full logs:

```text
time (UTC) | check | where (local|ci) | exit/conclusion | attempt | class | first failing line | status
```

`status` is one of `open`, `reproduced`, `fixed`, `verified`, `escalated`.
The Orchestrator reads the ledger at every wake; a row not `verified` or
`escalated` is open work.
