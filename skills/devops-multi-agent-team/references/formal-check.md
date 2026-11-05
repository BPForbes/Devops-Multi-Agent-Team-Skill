# Formal check with Lean 4 (optional)

Lean 4 turns a claim about pure code ("these two functions give the same result", "this
invariant always holds", "this child keeps the parent's promise") into a machine-checked
proof. It is optional: no project is required to have Lean, and when it is off nothing
here applies. When it is on, it is used from the start, in research, so the logic is
settled before it is coded and a virtual PR carries its own evidence instead of a
debate.

## What a proof does and does not show

- It shows that a **Lean model** satisfies a **stated specification**. A wrong
  specification can still be proved, so the statement is reviewed like code.
- Lean 4 compiles to C. It has **no Python or Java backend**, so a proof does not carry
  over to Python or Java code. The target-language code still has its own tests, and
  the Lean model supplies their expected values and counterexamples.
- It fits pure logic: algorithms, data structures, parsers, state machines, ordering and
  equivalence rules, bounds. It fits I/O, UI, concurrency primitives and business glue
  poorly, because writing the specification is the hard part.
- Record results honestly: **proved**, **disproved** (counterexample), **not-attempted**
  or **gave-up** (time-boxed). A `sorry` is "not proved", never "proved".

## Turning it on

Lean is *present* when the project has a `lean` entry detected (`lean-toolchain`,
`lakefile.*` or `.lean` files) or `lean --version` verifies in the sandbox. If it is
absent the Orchestrator says nothing about it.

1. **At the start of a goal**, if Lean is present and the goal changes pure logic, the
   Orchestrator asks once: *"Lean 4 is available. Use it to specify and prove the core
   logic before it is coded, and to help review and QA? (yes/no)"*. A plain **yes** turns
   it on for the whole goal; **no** leaves it off. The profile's `Lean default` (`ask`,
   `on` or `off`; `ask` if unset) can answer this in advance.
2. **At a stalled review.** If it is off and one review thread reaches the profile's
   `Formal check rounds` (default 3) still disputing what pure code does, the
   Orchestrator asks once more: *"Review is at round N and still disputes behavior. Use
   Lean to check it? (yes/no)"*. A "no" here is final for the goal.

The person never writes or reads Lean. Their only part is the yes or no.

## Who does what when Lean is on

| Seat | Part |
|------|------|
| **Researcher** | Drives it in research. Picks the **formal targets** (the logic worth proving), writes each claim in plain English with the code at `path:line`, marks it basic or advanced, and asks a Coder seat to model the advanced ones. Uses the results in the recommendation: a counterexample can reject a design before any code exists. Writes no Lean. |
| **Coder** | **Writes all the Lean**: the model, the theorem and the proof, time-boxed, in `devops-skill/thoughts/non-final/formal-<seat-id>/`. Specifies first, then implements the real code to mirror the model, adds tests from the model's example values and counterexamples, and records `formal` rows in the Push JSON. |
| **Reviewer** | Reads the statement and write-up first instead of re-deriving the logic. Checks that the statement says what the claim says, that the model matches the code at the cited lines, and the `notCovers` gap. Spends review effort on that gap, not on the proof. |
| **QA** | Runs the Lean gate below. |
| **Security** | Reviews lakefiles, dependency revisions, `unsafe`, `extern` and `implemented_by`, and any security-relevant claim (authorization, crypto, parsing). |
| **Orchestrator** | Asks the questions above, passes the answer to every seat, and makes sure the formal targets are listed before a Coder starts. |

The Coder who wrote a proof does not judge it; a Reviewer does.

## Basic and advanced logic

- **Basic logic** is plain English (or the team's own language) in the brief, the
  handoff and the thread. No Lean, no write-up. A single condition, a simple mapping, an
  obvious loop, a rename.
- **Advanced logic** is communicated as **Lean code plus a write-up** (Markdown, with
  LaTeX for the mathematics where it helps) attached to the virtual PR. It is advanced if
  any of these hold: an invariant spans several calls or threads; a rewrite's equivalence is
  not obvious from the diff; arithmetic with bounds or overflow; an ordering, protocol or state
  machine; a security-relevant check; a Reviewer asked about it twice.

The write-up follows [proof-writeup-template.md](proof-writeup-template.md): claim, model
and what it stands for, reasoning in prose, result, what it does not cover. It lives next
to the `.lean` file, is linked from the Push JSON `formal` row and the review thread's
"Formal (Lean)" section, and a line remark cites the id (for example "F2") instead of
restating the argument. Both stay gitignored in `non-final/`; a proof the project wants to keep
goes into `docs/` or the repository with the person's agreement.

## The loop

1. **Research.** Formal targets listed in the brief ([research-and-reuse.md](research-and-reuse.md)).
   Advanced claims modelled and tried; a disproof changes the plan.
2. **Code.** Lean model and theorem first; then the implementation and tests that mirror them.
3. **Handoff.** Push JSON `formal` rows ([push-json.md](push-json.md)) and write-ups. The
   Coder runs `formal_check` with `push` before handing off.
4. **Review.** Reviewers check statement, trace and gap. A dispute ends in a proof or a
   counterexample test, not another round of argument.
5. **QA.** The Lean gate, below, then the usual final pass.

## The Lean gate (QA, when Lean is on)

Before PASS:

- `lake build` is green for the Lean project in the sandbox, or the report says
  `NOT RUN` with the reason.
- `formal_check` (MCP) or `node scripts/devops-formal.mjs --push <push json>` reports no
  problems and no `sorry`, `admit` or `axiom` in a file a row marks proved.
- Every `native_decide`, `unsafe`, `extern` and `implemented_by` is named in a write-up with why it is
  acceptable.
- QA re-derives at least one statement from its claim in plain words (the statement is the part Lean cannot
  check) and confirms the model matches the code at `covers`.
- Each counterexample is a test in the project's language that fails on the old code and passes on the new.
- The model's example values were run against the real code in its own language (a differential
  check); the proof covers the model, not the code.

A row marked `proved` that fails the rebuild or has a hole **blocks PASS**. A claim that is
`gave-up` or `not-attempted` does not block; it is listed in the QA report with its `notCovers`.

## Safety

A `lakefile.lean` and Lean macros are code that runs at build time, and `lake` downloads
dependencies. Treat building any Lean project as running untrusted code: only in the sandbox
([services-and-sandbox.md](services-and-sandbox.md)), with network only for the hosts the
profile allows, dependencies pinned by revision, and `sorry`, `unsafe`, `@[extern]` and
`@[implemented_by]` reviewed by hand because the proof does not cover them.

## Cleanup while Lean is on

When Lean is on for the goal, the cleanup skill ([devops-cleanup](../../devops-cleanup/SKILL.md))
uses it for the steps where it helps: for a candidate that is a pure function (a split into helpers, a replaced
duplicate, a rewritten branch), the Researcher names the equivalence claim in the plan and the Cleaner (a Coder)
writes the theorem and proves it before the step counts as done. A step that cannot be proved in the time-box still
goes ahead on its tests, and the plan says "tests only". Impure code, public API changes and anything the person has
not approved are unaffected; proofs never replace the tests, the Reviewers' check that only structure changed, or
QA's `cleanup_scan compare`.
