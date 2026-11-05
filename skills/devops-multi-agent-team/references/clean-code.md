# Clean code

The standard for all code the team writes or changes, and the basis of the
[cleanup skill](../../devops-cleanup/SKILL.md). It is a floor, not a ceiling: the
list is "but not limited to", the project's own conventions and the language's
idioms win where they differ, and a rule is applied with judgement, not as a
metric to game.

## Sources, and how they were read

Four references were named for this standard:

- [Clean Code, Team 3624 wiki](https://frc3624wiki.readthedocs.io/en/latest/docs/software/advanced/read/CleanCode.html),
  a summary of Robert C. Martin's *Clean Code*: intention-revealing names, no
  misleading words, no noise words, no `m_` prefixes, a name that needs a comment
  has failed, small functions with descriptive names.
- [What is clean code, Codacy](https://blog.codacy.com/what-is-clean-code):
  no hard-coded values, precise names, comment sparingly, small functions, DRY,
  consistent formatting, refactor regularly, use version control; with SOLID,
  DRY and KISS as the underlying principles.
- [How to write clean code, freeCodeCamp](https://www.freecodecamp.org/news/how-to-write-clean-code/):
  descriptive names, single responsibility (a function you cannot name does too
  much), comments that explain intent, one formatting style enforced by tools,
  DRY without over-doing it, functions of roughly 20 to 30 lines or fewer and two
  or fewer arguments, and that shorter is not automatically cleaner.
- [Core principles of writing clean code, Axolo](https://axolo.co/blog/p/core-principles-of-writing-clean-code):
  simplicity, consistency, clarity over cleverness, no magic numbers, descriptive
  names, minimal useful comments, focused functions, DRY, established standards,
  and encapsulating nested conditionals in named functions.

**Caveat.** The session that wrote this could not fetch those pages (its network
did not resolve their hosts); the points above come from search summaries of
them. Check the numbers (30 lines, two arguments) against the pages, and treat
the unreferenced items in "Beyond the four sources" as the team's own additions.

## The principles

1. **Names reveal intent.** A name says what a value is or what a function does,
   without a comment. Be precise and searchable. Do not use misleading words (a
   variable named `accountList` that is not a list), noise words (`Info`, `Data`,
   `Manager`, `Util`, `Helper`), one-letter names outside tiny loops, or `m_`
   prefixes. Use one word per concept across the code. If a name needs a comment
   to explain it, rename it.
2. **Small functions that do one thing.** A function has one reason to change and
   one level of abstraction. If you cannot name it in a few words it does too
   much; split it. Long, descriptive names beat short, cryptic ones. Keep to about
   30 lines or fewer, nesting of 3 or fewer, and as few parameters as you can:
   two or fewer is the aim, more than four is flagged. A boolean flag argument
   means two functions are hiding in one: split them, or use a named option.
3. **Flat, readable control flow.** Validate and return early; keep the happy path
   unindented at the end. Move a complex or nested condition into a function whose
   name says what it checks.
4. **DRY, with care.** Define each piece of logic once and call it. Prefer
   calling code that already exists to writing a similar copy. But reduce
   duplication, do not worship it: two blocks that look alike by accident, or that
   will change for different reasons, stay separate. No premature abstraction.
5. **No magic numbers or hard-coded values.** Give a literal a named constant
   (or configuration entry) that says what it means, defined once.
6. **Comments sparingly, for the reason.** Explain why, a constraint or a trap;
   never restate the code; delete commented-out code
   ([comment-standards.md](comment-standards.md)). The best comment is a better
   name.
7. **Consistency and standards.** Follow the project's conventions for naming,
   formatting and structure. Let a formatter and linter (Prettier, ESLint, rustfmt,
   ruff, gofmt, the profile's tools) enforce one style so reviews are about
   substance.
8. **Simplicity over cleverness (KISS).** The simplest code that works. Every line
   earns its place. A clever trick that costs a reader a minute is a defect. Shorter
   is not cleaner; readable and correct come first.
9. **SOLID, where the code is object-oriented or has module boundaries.** One
   responsibility per type; open for extension, closed for modification; subtypes
   substitutable for their base; small, specific interfaces; depend on abstractions,
   not concrete types.
10. **Tested and refactored continuously.** Behavior has tests, the tests are clean
    too, and code is improved in small steps under version control, one kind of
    change per commit. Leave code a little cleaner than you found it, within the
    scope of the change.

## Beyond the four sources (the team's additions)

- **YAGNI.** Do not build what nothing needs yet.
- **Law of Demeter.** Talk to your neighbours, not their internals (`a.b().c().d()`
  chains are a smell).
- **Explicit errors.** No swallowed errors, no empty catch; fail fast and say why.
  A function that can fail says so in its signature or its documented contract.
- **Prefer immutability** and pure functions; separate commands (change state)
  from queries (return a value).
- **Least astonishment.** A function does what its name says and nothing else.
- **Idiomatic code.** The language's own conventions beat a generic rule (an
  iterator chain in Rust, a comprehension in Python, a `switch` expression in C#).

## How the team applies it

| Seat | Duty |
|------|------|
| **Researcher** | Finds the project's conventions and the existing code to reuse; notes names and constants that already exist. |
| **Coder** | Writes new code to this standard; names carefully; extracts a function instead of commenting; defines a constant instead of repeating a literal; calls existing code instead of copying it. Does not clean unrelated code in a feature change. |
| **Reviewer** | Checks the diff against it and labels findings: `issue (blocking)` for misleading or vague names in new code, copy-pasted logic, a repeated magic number, a swallowed error, a flag argument or a function far over the limits in new code; `suggestion (non-blocking)` for smaller simplifications. |
| **Cleaner** | Applies it to existing code on request, one behavior-preserving step at a time ([cleanup-rules.md](../../devops-cleanup/references/cleanup-rules.md)). |
| **QA** | `cleanup_scan` on the final tree shows no new magic numbers, vague names, flag arguments or over-limit functions in the files the change touched. |

## Thresholds (defaults)

`languages.json` `cleanup`, overridden per project in `.devops/project.md`:

| Check | Default | Source |
|-------|---------|--------|
| code lines per function | 30 | freeCodeCamp suggests 20 to 30 or fewer |
| nesting depth | 3 | the "flat control flow" principle; Martin's guidance is shallower still |
| parameters | 4 flagged, 2 or fewer aimed for | freeCodeCamp: two or fewer |
| duplicated block | 6 lines and 120 characters | the team's choice, to avoid trivial matches |
| same literal repeated | 2 | the team's choice |

A threshold is a prompt to look, never a reason to make code worse: a function over
30 lines that reads clearly and has no good seam stays, with the reason in the
review.
