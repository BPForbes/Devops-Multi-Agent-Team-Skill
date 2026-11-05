# Comment and documentation standards

Coders follow this on every change. Reviewers enforce it strictly: a
violation is a **blocking** finding, not a nit. The language's doc format
and line-comment marker are in the profile ("Comments and documentation",
from `languages.json` `docs`).

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

## 2. Standardized documentation (docstrings)

Public APIs, modules, classes and complex functions carry the language's
standard doc comment so help text can be generated: Javadoc / JSDoc / TSDoc,
PEP 257 docstrings (triple quotes), XML documentation for C# and F#, rustdoc,
Haddock, Doxygen, and so on. Describe parameters, return values, errors and
side effects. The doc check named in the profile (for example `cargo doc`
with warnings denied, `javadoc -Xdoclint`, a docstring linter) runs as part
of validation.

## 3. Actionable markers

Use all-caps markers, with the owner or issue when there is one:

- `TODO:` an incomplete implementation or a feature to add later.
- `FIXME:` a known bug, temporary workaround, or broken code needing
  attention.
- `NOTE:` a subtle nuance, a performance bottleneck, or a security-sensitive
  area.

A `TODO` or `FIXME` the change introduces is listed in the Handoff. A
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
4. Does every new public API, module, class and complex function have its
   doc comment in the language's standard format?
5. Are markers well-formed, and are new ones listed in the Handoff?
6. Do comments follow the formatting rules, and do borrowed algorithms link
   their source?
7. Would a better name remove the need for the comment? (`suggestion`)
