# Comment and documentation standards

Coders follow this on every change. Reviewers enforce it strictly: a
violation is a **blocking** finding, not a nit. The language's doc format
and line-comment marker are in the profile ("Comments and documentation",
from `languages.json` `docs`).

## 0. A comment is never a deliverable

**Do not add a comment because code was added.** New code does not owe anyone
a comment, a doc block or a header. If the code is self-explanatory, add
nothing. A comment must earn its place by telling the next reader something
the code cannot: a reason, a constraint, a trap. The default for a change is
**no new comments**; the number of comments in a diff is never a measure of
quality, and adding them to look thorough is a defect.

Before writing a comment, try these in order, and stop at the first that works:

1. Rename the variable, function or type.
2. Extract a function whose name says what the block does.
3. Add a test that pins the behaviour.
4. Only then, write the comment.

## 1. Core philosophy

- **Prefer self-documenting code.** Descriptive variable, function and
  class names; clean, idiomatic structure. Improve names and shape before
  adding a comment.
- **Explain intent, not mechanics.** Never restate what the code does
  (`// Increment i by 1`). Explain business rules, constraints, a complex
  algorithm, or a surprising workaround, and why it is needed.
- **Prevent comment rot.** Comments cannot be tested. When you change code,
  update or delete its comments in the same change. A stale comment is a
  defect.
- **Delete commented-out code.** Version control keeps history.

## 2. Doc comments (docstrings), only where they say something

Use the language's standard doc format (Javadoc / JSDoc / TSDoc, PEP 257
docstrings, XML documentation, rustdoc, Haddock, Doxygen, and so on) **when the
contract is not obvious from the name and signature**: units, valid ranges,
errors raised, side effects, ownership or lifetime, thread-safety, ordering,
security assumptions. A function whose name, parameters and return type already
say everything has no doc comment, and a comment that only repeats the
signature (`@param name the name`) is noise to be deleted.

The exception is a project policy that publishes generated API documentation:
then the profile says so ("Comments and documentation"), the public surface of
that library is documented, and the doc check named there runs. Without that
policy the doc checks in `languages.json` are not run and no lint such as
`missing_docs` is enabled just to force comments.

## 3. Actionable markers

Use all-caps markers, with the owner or issue when there is one:

- `TODO:` an incomplete implementation or a feature to add later.
- `FIXME:` a known bug, temporary workaround, or broken code needing
  attention.
- `NOTE:` a subtle nuance, a performance bottleneck, or a security-sensitive
  area.

Markers are for real follow-up, not decoration. A `TODO` or `FIXME` the
change introduces is listed in the Handoff. A
`FIXME` on a known bug blocks QA PASS unless the human accepted it.

## 4. Review feedback uses Conventional Comments

Format: `<label> [decorations]: <subject>` and then the detail.

- Labels: `praise`, `nitpick`, `suggestion`, `issue`, `todo`, `question`,
  `thought`, `chore`, `note`.
- Decorations: `(blocking)`, `(non-blocking)`, `(if-minor)`, and a file or
  rule reference when useful.
- Examples: `suggestion (non-blocking): rename tmp to retryDelay.` and
  `issue (blocking): this duplicates parseHeader() in net/header.c; extend it.`

Reviewers label the reviewer id too ([department-pods.md](department-pods.md),
Send-back).

## 5. Formatting

- Complete sentences: capital letter first, full stop last.
- Keep comments short; wrap before 80 columns.
- When the code follows an external algorithm, a Stack Overflow answer, an
  RFC or a regulation, put a Markdown link to the original in the comment.
- Comments are written for a future reader: no mention of an AI agent, a
  prompt, a conversation, a ticket-only context, or temporary branch state.

## What a strict reviewer checks

1. Does any comment restate the code? (`issue (blocking)`)
2. Is any comment now wrong after this diff? (`issue (blocking)`)
3. Is there commented-out code? (`issue (blocking)`)
4. Was any comment added only because code was added, or does it describe
   code that is already clear? (`issue (blocking)`: delete it, or rename or
   extract so it is not needed.) Count the new comments in the diff and ask
   of each: what does it tell the reader that the code cannot?
5. Where the contract is not obvious (see section 2), or the project
   publishes API docs, is the doc comment present and correct? A missing
   comment on self-explanatory code is **not** a finding.
5b. Are markers well-formed, and are new ones listed in the Handoff?
6. Do comments follow the formatting rules, and do borrowed algorithms link
   their source?
7. Would a better name remove the need for the comment? (`suggestion`)
