---
name: devops-cleanup
description: >-
  Behavior-preserving code cleanup driven by a plain-English statement: reduce
  comments, replace duplicated code with calls to one implementation, split large
  functions into helpers, cut nesting and long parameter lists, delete dead and
  commented-out code. Researchers scan and pick targets, Coders change one thing
  per step in a side worktree, Reviewers check that nothing but structure changed,
  QA proves the tests and the before/after numbers. Use when the user says clean
  up, tidy, refactor, reduce comments, remove duplicate code, split big functions,
  simplify, or runs /cleanup.
---

# Cleanup

You are the **Orchestrator**. Cleanup changes how code is written, never what it
does. It runs on the same team, worktrees, gates and rules as the
`devops-multi-agent-team` skill (read its `SKILL.md` and the project profile
`.devops/project.md` first); this skill adds the method.

## The statement

The person says in plain English how the code should be cleaned, for example:

- "Reduce the comments in src/api, keep only the ones that explain why."
- "Find code that is written twice and call one function instead."
- "Split any function over 40 lines into helpers. Don't touch vendor/."
- "Clean up the billing module: duplicates, big functions and noisy comments, but keep the public API."

Turn it into a brief with `cleanup_brief` (MCP) or
`node scripts/devops-cleanup.mjs brief --statement "..."`. The brief holds the
**goals** (comments, duplicates, split, dead code, naming), the **scope** (paths
named in the statement that exist, and what to leave alone), the **thresholds**
(function length, nesting, parameters, duplicate size; numbers in the statement
win), the **constraints** (your own sentences about what must not change, plus
the standing ones), and any sentence it did not understand. Show the brief to the
person. Ask about anything in `unrecognized`; do not guess. A vague statement
("tidy this up") defaults to comments, duplicates and split.

## The flow

1. **Baseline.** Run the profile's validation in the sandbox. It must be green.
   If it is red, stop and report; cleanup does not start on a failing project.
   Run `cleanup_scan` with `save` so the numbers before are kept.
2. **Researcher: scan and choose.** Run `cleanup_scan` for the brief. For each
   candidate decide whether it is worth doing (a duplicate that is two
   different things by accident is not), pick the refactor, and rate the risk.
   Duplicates: search for an existing function first (`reuse_search`, the reuse
   map); the best fix is a call to code that exists. Comments: apply
   [comment-standards](../devops-multi-agent-team/references/comment-standards.md)
   and mark comments that explain *why* as keepers. Output a **cleanup plan**: an
   ordered list of small steps, each with `path:line`, the refactor, the test
   that covers it (or "no test: characterization test first"), and the risk.
3. **Coder (cleaner): one step at a time** in a detached worktree. Follow
   [cleanup-rules.md](references/cleanup-rules.md). Run the tests after every
   step. List every comment you keep in the Push JSON `comments`.
4. **Reviewers** confirm only structure changed: moved code is the same code,
   no condition, order, error path, lock scope or side effect differs, each
   duplicate now calls the one implementation, each new helper has a name that
   says what it does, and comments follow the standard. Remarks go on the
   virtual PR as line remarks.
5. **QA** reruns everything, runs `cleanup_scan` with `compare` and shows the
   numbers went the right way and nothing got worse, and checks the diff is
   free of unrelated churn. **Security** reviews only if the plan touched the
   profile's sensitive paths; a refactor of authentication or crypto code is a
   security change.
6. Nobody pushes before QA's PASS and the person's go.

## What cleanup is not

A feature, a bug fix, a performance change, a rename the person did not ask for,
a reformat of whole files, a dependency update. If cleanup finds a bug, record
it in a triage note and leave it; fix it in its own change.
