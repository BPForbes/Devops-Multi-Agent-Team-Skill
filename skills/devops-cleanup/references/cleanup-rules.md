# Cleanup rules

These apply to every step of a cleanup. A step that cannot follow them is not
done; stop and say why.

## Before and during

1. **Green baseline.** The profile's validation passes before the first step.
   After every step it passes again. A step that turns it red is reverted, not
   patched forward; one retry, then escalate (see monitoring.md).
2. **Tests first for untested code.** If a target has no test that would catch a
   behavior change, add a characterization test (it records what the code does
   today, including odd behavior) in its own step before touching the code. If
   that is not practical, drop the target and say so.
3. **One kind of change per step, one step per commit.** Comment removal,
   duplicate removal, extraction and dead-code removal are different steps.
4. **No behavior change.** Same outputs, errors, ordering, side effects, logging
   and locking. No public API, wire format or file format change unless the
   statement says so. Not even "while I'm here" fixes.
5. **Small diffs.** No reformatting of lines you do not otherwise change. Run
   the formatter only on files you changed, and only if the project does.

## Duplicate code: call one implementation

1. Search first (`reuse_search`, the reuse map). If a function already does it,
   replace the copies with a call to it. That is the preferred fix.
2. Otherwise choose the canonical copy: the one with tests, in the module that
   owns the concept, or with the most callers. Move it to a shared place the
   reuse map names, with a name that says what it does.
3. Replace the other copies with calls. If copies differ only in a value, make
   it a parameter; if they differ in a type, use the language's generics. Do not
   add a flag parameter that switches behavior.
4. Check each copy really is the same: same types, constants, error handling,
   surrounding state. A reported clone can be two different things that look
   alike; leave those and note why.
5. Do not create a "utils" dumping ground. A helper lives beside its owners.
6. Prove equivalence: the tests pass, and for non-trivial code run old and new
   on the same inputs (a differential test) before deleting the old copy.

## Large functions: split into helpers

1. Extract cohesive blocks (one reason to change, one thing they do) into private
   helpers. Pure computation first; I/O and mutation stay where the original had
   them, in the same order.
2. Name the helper for what it does or returns, not how. If you cannot name it in
   a few words, the cut is wrong.
3. Cut nesting with early returns and guard clauses; keep the happy path
   unindented at the end.
4. Keep the original function's signature and behavior. If a helper would need
   more than a handful of parameters, group them in one value or reconsider the
   cut.
5. Do not move code across a lock, transaction, await or `unsafe` boundary.
6. Re-run the scan: the function should be under the limit and the helpers
   should not themselves be over it.

## Comments

1. Apply comment-standards.md: delete comments that restate code, commented-out
   code, process notes, questions and notes to people; keep reasons, constraints,
   contracts and borrowed-algorithm links.
2. Do not delete a comment that explains why, and do not rewrite one to look
   tidier. Do not add comments; the aim is fewer.
3. A question or note found in code goes to the PR Q&A, then is deleted.
4. List every comment that remains in the files you touched and is new or moved
   in the Push JSON `comments`.

## Constants, flag arguments and names

- A repeated literal becomes one named constant that says what it means, defined once near its owners. Do not
  name `0`, `1`, or a value that is already self-evident in context.
- A function with a boolean flag argument is split into two functions named for what each does (or takes a
  named option), with every caller updated in the same step.
- Names follow clean-code.md: intention-revealing, no noise words, no misleading words, no `m_` prefixes.

## Types and inheritance

These steps can change a public API, so each is a separate step the person has approved, with tests first (and contract
tests for a hierarchy). See oop-principles.md.

- **Type switch:** replace a chain of checks on concrete types with a method on the parent that each child implements, or
  with a lookup table. Add the new child or entry for each old branch; delete the branch only when the tests pass.
- **Child that refuses what its parent promises:** move the operation to a narrower type or split the interface, so no
  caller needs a type check. Do not "fix" it by adding a guard in callers.
- **Multi-purpose function:** one helper per job, the old name kept as the orchestrating parent while it has callers.

## With Lean

Only when the person has said yes for this goal. For a step that rewrites a pure function, the Cleaner (an AI Coder) states
`theorem old_eq_new : ∀ x, old x = new x` over a small Lean model of both versions and prove it, time-boxed. Record
proved, disproved (the counterexample becomes a test) or tests only. A proof about the Lean model does not cover
Python or Java code; their tests still run. See formal-check.md.

## Dead code and names

- Delete dead code only with proof: no references (`reuse_search`), not exported
  API, not reached by reflection, a name table or a build flag. One deletion per
  step.
- Rename only what the statement asked for, with the tool's rename (not search
  and replace), across all callers in the same step.

## Evidence for review and QA

- The cleanup plan (ordered steps), the Push JSON, and the commands run with exit
  codes.
- `cleanup_scan` before and after (`save`, then `compare`): fewer duplicate
  lines, fewer long functions, fewer blocking comment findings, and nothing worse.
- `git diff --color-moved` (or the equivalent) shows moved blocks as moves, and
  the remaining changed lines are explained one by one.
- Every `NOT RUN` named.

## Stop conditions

Stop and ask, in the PR Q&A, when: a step needs a behavior change; two copies
differ in a way you cannot explain; a target has no tests and cannot get any; the
statement conflicts with a project rule; or the scan and your reading disagree.
