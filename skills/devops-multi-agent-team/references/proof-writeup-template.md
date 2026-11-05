# Proof write-up template

For **advanced** logic only, when Lean is on ([formal-check.md](formal-check.md)). Basic logic stays
plain English. Copy next to the Lean file as
`devops-skill/thoughts/non-final/formal-<seat-id>/<id>.md` (local only; do not commit). Write in the
language the person uses. Markdown, with LaTeX for mathematics where it helps (`$...$`, `$$...$$`).

```markdown
# F<n>: <the claim in one sentence>

**Seat:** <coder-id>   **Status:** proved | disproved | not-attempted | gave-up
**Lean:** `formal-<seat-id>/<id>.lean`   **Covers:** `path:line` (the code the model stands for)

## Claim (plain English)
What must always hold, and for which inputs. One short paragraph. Why it matters (the bug it prevents).

## Model
The pure model in Lean, and how it maps to the code: which definitions match which functions or lines, and
what was simplified away (I/O, concurrency, overflow if modelled as unbounded) and why that is safe or is not.

## Reasoning
The argument a person can follow without reading Lean: the key lemma, the induction or case split, and the one
step that is not obvious. For arithmetic or ordering, the mathematics in LaTeX:
$$\forall xs,\; \mathrm{old}(xs) = \mathrm{new}(xs)$$

## Result
Proved (theorem names), or the counterexample (inputs and the output of each version), or why it was
given up (time-box, missing library).

## Does not cover
What the proof says nothing about: the Python or Java implementation, the I/O boundary, `extern` or `unsafe`
code, anything outside the model. Name the tests that cover those.

## Tests derived
The tests added from this model: example values, and the counterexample if any (`path:line`).
```

A write-up that restates the Lean line by line is too long: say what the Lean cannot, and cite the theorem.
