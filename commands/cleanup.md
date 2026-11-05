---
name: cleanup
description: Clean up code from a plain-English statement - reduce comments, replace duplicated code with calls, split large functions into helpers. Behavior is preserved.
---

# /cleanup `<what to clean and how, in plain English>`

Also: `clean up`, `tidy`, `reduce comments`, `remove duplicate code`, `split big functions`.

The method: `../skills/devops-cleanup/SKILL.md` and `../skills/devops-cleanup/references/cleanup-rules.md`.

1. Turn the statement into a brief: `cleanup_brief` (goals, scope, thresholds, constraints, anything not understood).
   Show it and ask about the unclear parts.
2. Baseline: validation green in the sandbox; `cleanup_scan` with `save`.
3. Researchers scan (`cleanup_scan`), search for existing code to call (`reuse_search`), and write the ordered cleanup plan.
4. Coders (`devops-cleaner`) do one small step at a time in a worktree; tests after every step.
5. Reviewers check that only structure changed; QA compares the scan (`compare`) and reruns everything; Security only if
   sensitive paths are touched.
6. Nobody pushes before QA's PASS and the person's go.
