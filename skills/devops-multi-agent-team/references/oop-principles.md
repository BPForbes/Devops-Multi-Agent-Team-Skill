# Single purpose, closed for modification, substitutable children

Three rules for functions and class hierarchies. They sit under
[clean-code.md](clean-code.md) and are checked by Reviewers and by the cleanup
scan (`cleanup_scan`, goals `split` and `oop`).

1. **Single purpose.** A function does one thing. If it needs to do more, it
   calls helper functions that each do one thing, and itself only orchestrates.
2. **Open for extension, closed for modification.** New behavior arrives as new
   code that plugs into a parent type; existing code does not change. A parent
   declares every extension point, and a child plugs in by implementing it.
3. **Substitutable children (Liskov).** A child can stand in for its parent
   anywhere the parent is used, without the caller noticing. A child keeps every
   promise its parent made.

The walk-throughs for 2 and 3 follow two short explainer videos by s4.codes
(www.s4.codes, @s4.codes on TikTok) that were supplied to the project; the
examples below are rewritten, not copied. See "Source notes" at the end for what
could and could not be read from them.

## 1. Single purpose

- A function has one reason to change and one level of abstraction. The test: say
  what it does in one short sentence without "and". A name with `And` or `Or` in it
  (`loadAndParse`, `save_and_notify`) is named for two jobs.
- When more is needed, extract helpers and let the parent read like an outline:

```ts
// Before: reads, validates, converts and stores in one body.
function importUsers(path) { /* 80 lines */ }

// After: each step has one job and a name that says it.
function importUsers(path) {
  const rows = readRows(path)
  const valid = rows.filter(isValidUser)
  return store(valid.map(toUser))
}
```

- Helpers stay private and near their parent. Pure computation goes in pure helpers;
  I/O stays at the edges. A helper never needs a flag argument to switch what it does:
  that is two helpers.
- Length is only a symptom (about 30 lines, nesting of 3, two or fewer parameters). A
  short function can still do two things, and a long one can be one cohesive step.

## 2. Open for extension, closed for modification

**The example.** A drawing program has a `Shape` with `draw()`, and `drawAll(shapes)`
calls `shape.draw()` on each. Adding a `Triangle` means writing one new class and
changing nothing else: the code is closed against that kind of change.

**Where it breaks.** The requirement changes: shapes must be drawn in a given order.
Three attempts, in the order they were tried:

1. Branch on the concrete type inside `drawAll`: one loop for `shape is Circle`, then
   one for `shape is Square`. Every new shape means editing `drawAll`. Not closed.
2. Let each shape declare `drawsBefore` (a list of shapes it goes in front of).
   Better, but a new `Triangle` forces edits to the *existing* shapes' lists. Still
   not closed.
3. Make the order data in one place and sort by it:

```ts
const drawOrder = [Circle, Square]
function drawAll(shapes) {
  for (const shape of shapes.sortedBy(drawOrder)) shape.draw()
}
// a new shape: add the class, add one entry to drawOrder. drawAll never changes.
```

**What to take from it.** Change the design once, so that the next change of the same
kind needs no edit to existing logic. Choose the axis you expect to vary (new shape,
new order, new payment method, new file format) and close the code against that one.
You cannot close against everything; do not build hooks for changes nobody expects
(YAGNI).

**Rules**

- Depend on the parent (an interface or abstract type), never on its children. A
  `switch` or an `if` chain on a concrete type or a type tag is the sign of code that is
  closed to extension. The scan reports a function with three or more type checks
  (`instanceof`, `isinstance`, `is X`, `switch (x.kind)`) as a `type-switch`.
- Put the extension point on the parent: an abstract method or interface member, a
  hook the parent calls, or a registry the child adds itself to. The parent declares
  how it can be extended; a child extends it by implementing that, with no edit to the
  parent or to its callers.
- Variation that is data (an order, a rate, a mapping) lives in a table or
  configuration, not in `if` branches.
- Closed does not mean frozen. A bug fix, or the one-time change of design that makes
  the next extension free, is a modification and is fine. What is not fine is editing
  stable code every time a variant is added.
- Do not use inheritance only to reuse code. If the child is not a kind of the parent
  (see 3), compose instead.

## 3. Substitutable children (Liskov)

**The rule in one line.** If the code works with a `Parent`, it must work, unchanged and
unsurprised, with any `Child`. A child keeps every promise the parent made.

**Example 1: Square extends Rectangle.** `Rectangle` has `setWidth`, `setHeight` and
`area`. A function sets width 5 and height 2 and expects an area of 10. Passing a
`Square`, whose setters keep both sides equal, gives 4, so the check fails. A square
*is* a rectangle in geometry but not in behavior: the parent promised that width and
height change independently, and the child cannot keep that.

**Example 2: Penguin extends Bird.** `Bird` has `fly()`. A `Penguin` cannot fly, so it
throws. `letFly(bird)` works for a `Bird` and crashes for a `Penguin`. Guarding with
`if (bird instanceof Penguin) return` hides the crash but makes every caller know about
penguins, which breaks rule 2 as well.

**The fix is in the hierarchy, not in the callers.**

```ts
// A shared parent for what really is common; the sibling types do not pretend.
class Shape { area() { /* ... */ } }
class Rectangle extends Shape { /* independent width and height */ }
class Square extends Shape { /* one side */ }

// Put fly() only on the type that can honor it.
class Bird { /* what every bird does */ }
class FlyingBird extends Bird { fly() { /* ... */ } }
class Penguin extends Bird { /* no fly(), so nothing to break */ }
```

**What a child must not do**

- Strengthen what it demands: its preconditions may be the same or weaker, never
  stricter (a child that rejects inputs the parent accepted).
- Weaken what it delivers: its postconditions may be the same or stronger (a child
  that returns less than the parent promised).
- Break the parent's invariants (the independence of width and height).
- Throw or refuse something the parent does not (`UnsupportedOperationException`,
  `NotImplementedError`, "cannot fly"), or override with a no-op that quietly drops the
  promised effect.
- Require callers to check its type before using it.

**How to keep it true**

- If a child cannot keep a promise, the child is not a child of that parent. Move the
  operation to a narrower type (`FlyingBird`), split the interface, or give both
  types a smaller common parent (`Shape`).
- Prefer immutable value types for things like shapes: `withWidth(5)` returns a new
  value, so the "set one side and the other stays" promise does not exist to break.
- Prefer composition when the relationship is "uses" rather than "is a kind of".
- Write **contract tests** once against the parent and run them against every child
  (one shared suite, parameterized over the implementations). The Rectangle check in
  the example is exactly such a test: it should pass for every `Rectangle` subtype.
- The scan reports a child class that throws an unsupported or not-implemented error
  as an `lsp-risk`. Abstract classes and base classes may refuse; children may not.

## How the three fit together

Single-purpose functions are easy to extend. Extension by new children only works if
children are substitutable; a type switch is what callers fall back to when they are
not. So: small functions, an abstraction that declares its extension points, and
children that honor the parent's contract.

## Checks

| Seat | Check |
|------|-------|
| **Coder** | Does the new function do one thing? Does adding the next variant require editing existing code? Can every child be handed to code written for its parent? |
| **Reviewer** | `issue (blocking)`: a new type switch on concrete types, a child that throws or no-ops what its parent promises, a callers' `instanceof` guard that exists only to avoid a child, a function named for two jobs in new code. `suggestion (non-blocking)`: an extension point that could be data. Ask: what would the next variant cost, and what would the parent's tests say about this child? |
| **Cleaner** | Fixes these only with tests first, and only when the statement or the scan calls for it: replacing a type switch with polymorphism or a table, or restructuring a hierarchy, can change a public API, so it is a plan step the person approves ([cleanup-rules.md](../../devops-cleanup/references/cleanup-rules.md)). |
| **QA** | `cleanup_scan` with goal `oop` on the touched files shows no new `type-switch` or `lsp-risk`, and the contract tests pass for every child. |

## Source notes

- The two videos are short vertical explainers by s4.codes: one on the Open/Closed
  Principle (the `Shape` drawing order example above) and one on the Liskov
  Substitution Principle (the `Rectangle`/`Square` and `Bird`/`Penguin` examples). The
  third file supplied was a byte-identical copy of the Liskov video.
- They were read from sampled frames (about one every six seconds), which carry the
  code, diagrams and short captions. The narration was not transcribed, so anything
  said only aloud is not captured here.
- Both end by announcing the next principles in the SOLID series, Interface
  Segregation and Dependency Inversion. Those videos were not supplied, so this page
  does not cover them beyond the one-line versions in clean-code.md.
