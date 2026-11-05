# Formal check with Lean 4 (optional)

Lean 4 can turn a claim about pure code ("these two functions give the same result",
"this invariant always holds", "this child keeps the parent's promise") into a
machine-checked proof. It is an optional tool for settling a question, never a gate:
no project is required to have Lean, and nothing here blocks a push.

## What a proof does and does not show

- It shows that a **Lean model** satisfies a **stated specification**. A wrong
  specification can still be proved, so the statement is reviewed like code.
- Lean 4 compiles to C. It has **no Python or Java backend**, so a proof does not
  carry over to a Python or Java implementation. The target-language code still has its
  own tests; the Lean model can generate the expected values for them.
- It fits pure logic: algorithms, data structures, parsers, state machines, ordering
  and equivalence rules. It fits I/O, UI, concurrency and business glue poorly, because
  writing the specification is the hard part.
- Record the result honestly: **proved**, **disproved (counterexample)**, **not
  attempted** or **gave up (time-boxed)**. A `sorry` is "not proved", never "proved".

## Who writes the Lean

**AI Coders write all of it**: the model, the theorem statement and the proof. The person is never asked
to write or read Lean; their only part is the yes or no above. The Researcher names the claim in plain
English (what must hold, for which code at `path:line`) and does not write Lean. The Coder who wrote the
proof is not the one who judges it: a Reviewer checks that the statement says what the claim says and that the model
matches the code, because Lean checks the proof but cannot check that the statement is the right one.

## When it is considered

1. **Researcher**, in the brief's "Formal checks" section (the claim in plain English; a Coder writes the Lean), when a claim is about
   equivalence or an invariant of pure code and tests alone leave doubt.
2. **Review rounds.** The profile sets `Formal check rounds` (default 3). When the
   same review thread reaches that many rounds with the Coder and Reviewers still
   disagreeing about what the code does (for example "is the refactor equivalent",
   "does the child violate the parent's contract"), the Orchestrator asks the person
   once, in these words: *"Review is at round N and still disputes behavior. Use Lean
   to check it? (yes/no)"*.
   - A plain **yes** turns Lean on for the rest of this goal. **no** (or silence) leaves it off,
     and the question is not asked again for this goal.
   - The Orchestrator asks only if Lean is present: the project has a `lean` entry
     detected (`lean-toolchain`, `lakefile.*` or `.lean` files) or `lean --version`
     verifies in the sandbox. If it is absent, it does not ask and says nothing.
   - It is asked for a dispute about a specific property, not for every review.
3. **Cleanup**, below.

## How a seat uses it

1. The Coder restates the claim as a Lean theorem over the smallest pure
   model of the code (copy the logic; do not model the whole system). Illustrative sketch, not compiled here;
   the proof script will need adjusting to the Lean and Mathlib version:

```lean
def old (xs : List Nat) : List Nat := xs.filter (· > 0) |>.map (· + 1)
def new (xs : List Nat) : List Nat := xs.filterMap fun x => if x > 0 then some (x + 1) else none

theorem old_eq_new (xs : List Nat) : old xs = new xs := by
  induction xs with
  | nil => rfl
  | cons x xs ih => by_cases h : x > 0 <;> simp [old, new, h] at * <;> simp [ih]
```

2. Time-box it. Use `lake build` in the sandbox; the proof lives in the thoughts folder
   (`devops-skill/thoughts/non-final/`) unless the person says the project keeps it.
3. Record the outcome in the review thread or brief: the statement, the model's source
   `path:line`, the result, and what it does not cover (the target-language code).
4. A disproof is the most useful result: the counterexample becomes a test in the
   project's own language.

## Safety

A `lakefile.lean` and Lean macros are code that runs at build time, and `lake` downloads
dependencies. Treat building someone else's Lean project like running untrusted code: only in the
sandbox ([services-and-sandbox.md](services-and-sandbox.md)), with network only for the
hosts the profile allows, dependencies pinned by revision, and `sorry`, `unsafe`,
`@[extern]` and `@[implemented_by]` reviewed by hand because the proof does not cover them.

## Cleanup while Lean is on

When Lean is on for the goal, the cleanup skill ([devops-cleanup](../../devops-cleanup/SKILL.md))
uses it for the steps where it helps: for a candidate that is a pure function (a
split into helpers, a replaced duplicate, a rewritten branch), the Researcher
names the equivalence claim in the plan and the Cleaner (a Coder) writes the theorem and proves it before the step
counts as done. A step that cannot be proved in the time-box still goes ahead on its
tests, and the plan says "tests only". Impure code, public API changes and anything
the person has not approved are unaffected; proofs never replace the tests, the
Reviewers' check that only structure changed, or QA's `cleanup_scan compare`.

## Where this appears

| Seat | What it does with Lean |
|------|------------------------|
| **Orchestrator** | Asks the yes/no question at the configured round, only when Lean is present, and passes the answer to the seats. |
| **Researcher** | Names the claim in plain English in the brief's "Formal checks" when a pure-code claim needs more than tests. Writes no Lean. |
| **Coder / Cleaner** | Writes the Lean model, theorem and proof, time-boxed, and records the result. |
| **Reviewer** | Checks that the statement says what the dispute is about and that the model matches the code at the cited lines. |
| **QA** | Confirms the recorded result is accurate and that target-language tests still pass. |
| **Security** | Reviews lakefiles, dependency revisions and unsafe or extern declarations. |
