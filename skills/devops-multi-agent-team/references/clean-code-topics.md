# Clean-code topics: how to deal with each

A topic-by-topic guide that extends [clean-code.md](clean-code.md) and
[oop-principles.md](oop-principles.md). The topic list follows the lesson titles of the
s4.codes "Clean Code" series (www.s4.codes, @s4.codes on TikTok), grouped the way the
series groups them.

**What this page is built from.** Only the lesson titles and groupings were visible
(thumbnails), not the videos themselves. Each topic below is written from the published
sources it points to (mainly Robert C. Martin's *Clean Code*, Martin Fowler's
*Refactoring* and Ken Pugh's *Prefactoring*) and from general practice, in this
project's own words. Where a title was ambiguous the reading chosen is stated. It is
not a summary of what the videos say; where a video disagrees, the video was not seen.

Each topic: **Rule**, **Smell** (what a Reviewer or the scan looks for), **Do**.

## Function design

- **Name length.** Rule: a name's length follows its scope. A variable used in three
  lines may be `i`; one used across a module needs a full name. Functions invert it:
  a function used widely gets a short, general name; a narrow private helper gets a
  long, precise one. Smell: `data`, `tmp2`, `processStuff`, or a 60-character name for a
  public entry point. Do: lengthen until the name says what it holds or does, then
  shorten only if the scope is large and the name is still unambiguous.
- **Naming altitude.** Reading: a name sits at the same level of abstraction as the
  function body. Rule: a function that calls `openSocket` and `writeBytes` is not
  named `sendInvoice` unless its body works at the invoice level too. Smell: a
  high-level name over low-level steps, or the reverse. Do: split so each function
  works at one level, and name it for that level.
- **Function contexts.** Reading: a function's meaning should be clear without the
  surrounding file. Rule: it states what it needs as parameters or through a clearly
  named owner, not hidden state; its name does not rely on a neighbor. Smell: reads or
  writes globals or fields that the name does not mention; a flag argument; a name
  that is only meaningful next to another function. Do: pass what it needs, return what
  it produces, and make side effects part of the name.

## Unit tests

- **The three laws of TDD.** (1) Write no production code except to pass a failing
  test. (2) Write no more of a test than is enough to fail (not compiling is failing).
  (3) Write no more production code than is enough to pass the one failing test. Do:
  the cycle is red, green, refactor, in minutes. The Coder runs it for new behavior;
  the Cleaner starts from tests that pass before any change.
- **Keep your tests clean.** Rule: test code is held to the same standard as production
  code, because dirty tests get deleted and then the code cannot be changed safely.
  Smell: copy-pasted setup, magic values, a test nobody can read. Do: extract builders
  and helpers, name tests for the behavior.
- **Tests enable the -ilities.** Flexibility, maintainability, reusability: a trusted
  suite is what lets you restructure without fear. No tests, no refactor, so the
  Cleaner and every restructuring step ([cleanup-rules.md](../../devops-cleanup/references/cleanup-rules.md))
  needs them first.
- **Writing clean tests.** Rule: readability above all. Arrange / act / assert in one
  glance (build, operate, check). Do: a small domain-specific vocabulary of helpers so
  the test reads like the requirement. Smell: a test that needs scrolling.
- **One concept per test.** Rule: one behavior per test, so a failure points at one
  thing. A single assert is a guide, not the rule; the rule is one concept. Smell: a
  test named `testEverything`, or several unrelated scenarios in one body.
- **F.I.R.S.T.** Fast, Independent (no order dependence), Repeatable (any environment,
  no network or clock luck), Self-validating (pass or fail, no reading logs),
  Timely (written with or before the code). Smell: flaky tests, shared mutable state,
  sleeps.

## Boundaries

- **Wrap third-party code.** Rule: the code you do not own is used through your own
  small interface, in one place. Smell: library types in your domain signatures, the
  same vendor call repeated across modules. Do: define the interface you wish you had,
  implement it over the library, and write tests of the library's behavior against it.
  An upgrade or a swap then touches one file. In this project it also applies to
  [services](../../../SERVICES.md) and model providers.
- **The adapter pattern.** The mechanism for the rule above: an adapter converts the
  library's interface to the one your code expects. Do: the adapter holds the
  conversion and nothing else, no business rules; callers depend on the interface, so
  tests use a fake. Smell: the adapter grows logic (then the logic belongs in a domain
  class).

## Error handling

- **Exceptions over return codes.** Rule: where the language uses exceptions, raise one
  instead of returning a code the caller must remember to check. Smell: nested `if`
  ladders testing codes, ignored return values. Do: let the happy path read straight
  down. In languages without exceptions (C, Go, Rust), use the idiom the language
  gives (`Result`, `error` values) consistently, and never drop one silently.
- **Write try-catch first.** Rule: when code can fail, write the failure scope first:
  the `try` block and a test that forces the exception, then fill in the body. The
  block is a transaction boundary, so state after the catch must be consistent. Do:
  catch at the level that can decide what to do, keep the `try` small, and say in the
  message what was being done and why it failed.
- **Wrap third-party APIs.** The same boundary rule applied to errors: translate a
  library's many exception types into the few your code understands, at the adapter,
  so callers do not know which vendor failed.
- **The special case pattern.** Rule: instead of returning `null` or a code that
  callers must check, return an object that behaves correctly for the special case
  (an empty list, a "guest user", a null object with a default behavior). Smell: the
  same `if (x == null)` in many callers. Do: put the special behavior in one place.
  Limits: do not hide a real failure (a missing record that should exist is an
  error, not a special case), and never return `null` where a special case or an error
  is possible.

## Objects and data

- **Data abstraction.** Rule: an object exposes behavior and hides its representation.
  A getter and setter for every field is not abstraction. Do: expose what a caller
  needs to do (`fuelPercentRemaining()`), not how it is stored (`tankGallons`).
- **Data/object anti-symmetry.** Objects hide data and expose behavior; data
  structures expose data and have no behavior. They are opposites: procedural code
  with data structures makes it easy to add a function and hard to add a type; object
  code makes it easy to add a type and hard to add a function. Do: choose per case on
  which kind of change you expect (this is the Open/Closed question in
  [oop-principles.md](oop-principles.md)); do not mix.
- **The Law of Demeter.** A method talks to its own fields, its parameters and objects
  it creates, not to the internals of objects it gets back. Smell: train wrecks,
  `a.getB().getC().doIt()`. Do: tell the owner what you want (`a.doIt()`), or move
  the behavior. Not a smell: a chain over plain data structures or a fluent builder,
  where nothing is hidden.
- **Hybrids, DTOs and active records.** Hybrids (half object, half data structure:
  logic plus public getters and setters for everything) get the worst of both: avoid.
  A DTO is a pure data structure with no behavior, used at a boundary. An active
  record is a data structure with `save`/`find`: treat it as data, and keep business
  rules in separate objects that use it rather than growing it.

## Formatting

- **Code reading flow.** Rule: code reads top to bottom like a newspaper: headline
  (the name), then the summary, then detail. Callers above the functions they call,
  most important concept first. Do: keep related functions close, and put a function
  directly after its first caller.
- **Visual code layout.** Vertical: blank lines separate concepts, tightly related lines
  stay together, declarations near their use. Horizontal: short lines, spaces to show
  precedence, no column alignment that a rename will break. Do: let the formatter
  decide, so layout is never a review comment.
- **Placement and rules.** Rule: a team uses one set of formatting rules, applied by a
  tool, not by argument. Do: a committed formatter and linter config
  (`.editorconfig`, rustfmt, black, prettier); the Reviewer does not comment on
  what the tool already enforces.

## Comments

- **Visual clutter and formatting.** Rule: banners, closing-brace notes (`} // end if`),
  attribution and change logs, commented-out code and noise comments ("increment i")
  are clutter; version control already holds history and authorship. Do: delete them.
  Smell: a comment that restates the line below it. This is already enforced by
  [comment-standards.md](comment-standards.md) and the comment audit.
- **Poor communication style.** Rule: a comment that must exist is written as clear,
  correct prose about intent or a non-obvious constraint: complete sentences, no
  rambling, no jokes, no names of the people involved, no misleading or out-of-date
  claims. Smell: a comment longer than the code, a question left in a comment
  (questions go to the PR, per the comment rules), a comment that disagrees with the
  code. Do: if it takes a paragraph to explain, rename or restructure first.

## SOLID and design

Single responsibility and its "why", Open/Closed, strategic closure and Liskov are in
[oop-principles.md](oop-principles.md). This page adds:

- **Why SRP matters.** A class with one reason to change is changed by one kind of
  request, so unrelated work does not collide, tests stay small and reuse is cheap.
  Smell: a class whose methods fall into groups that use different fields; two
  teams editing the same class for different reasons.
- **Strategic closure.** No design can be closed against every change. Rule: pick the
  changes you consider likely (from the requirements, the tickets and what has changed
  before) and close the code against those; accept that others will cost an edit. The
  Researcher records the likely axes of change in the project profile's
  "Extension points" line.

## Classes

- **Naming pressure.** Reading: if a class is hard to name, it is doing too much. A
  name that needs "and", "Manager", "Processor", "Helper" or "Utils" is a symptom. Do:
  split until each part has a short, noun-phrase name that says what it is.
- **Feature envy.** A method that uses another class's data more than its own belongs
  in that class. Smell: a run of `other.getX()`, `other.getY()` feeding a calculation.
  Do: move the method (Fowler: *Move Method*).
- **Hidden classes.** Reading: a concept that is only implied by a group of fields,
  parameters or a block of code that always travel together (a data clump, a repeated
  parameter list, a block that could be named) is a class waiting to be named. Do:
  *Extract Class* or introduce a parameter object; the new name is the vocabulary the
  code was missing.
- **Policy and detail.** Rule: high-level policy (the business rule) does not depend on
  low-level detail (the database, the HTTP library, the file format); both depend on an
  abstraction the policy owns. Do: the policy declares an interface, the detail
  implements it, and the detail can be swapped (the adapter above). This is
  Dependency Inversion; it was only announced in the supplied videos, so this is the
  general principle, not the series' treatment.
- **Prefactoring.** Ken Pugh's term for applying lessons from past refactorings up
  front, not adding speculative features. Its guidelines include "when you are
  abstract, be abstract all the way", "consistency is simplicity" and "don't repeat
  yourself". Do: make the sensible separations and abstractions now when they are
  cheap, and no more.
- **Overengineering.** The balance to prefactoring. Smell: an interface with one
  implementation and no expected second, a plugin system nobody asked for, a hook for
  a change nobody has predicted, configuration for a constant. Do: YAGNI. Build for
  the change the requirements show; extract when the second case arrives (the rule of
  three for duplication). Reviewers raise this as `suggestion (non-blocking)` unless
  it adds real cost.

## Checks

| Seat | Check |
|------|-------|
| **Coder** | Test first for new behavior; names fit their scope and level; third-party code behind a small adapter; a special case object instead of `null` checks; nothing speculative. |
| **Researcher** | Records each boundary (library or service) and whether it is already wrapped, and the likely axes of change. |
| **Reviewer** | `issue (blocking)`: a swallowed error, a new `null` return that callers must check, a library type leaking into domain signatures, a hybrid object, a test that depends on another test. `suggestion`: train wrecks, feature envy, naming pressure, a class that wants extracting, overengineering. Nit: anything a formatter should settle. |
| **QA** | Tests are F.I.R.S.T.; the suite passes alone and in any order; the formatter and linter are clean. |
| **Cleaner** | Applies the Smell to Do pairs above only with tests first, one behavior-preserving step at a time. |

## Not covered

The series also has lessons not in the screenshots (the visible list is a part of the
channel), and an animated Git Essentials course. Documentation for those needs the
lesson titles or the videos.
