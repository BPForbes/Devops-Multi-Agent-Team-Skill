# Comment and documentation standards

Coders follow this on every change. Reviewers enforce it as strictly as it
goes: **every** violation is a blocking finding (`issue (blocking)`), formatting
and the language's style guide included. There are no nits on comments and docs.
The only relaxation is the limits for interface files (section 2b). The language's doc format
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

## 0a. The comment gate: three questions before any comment

Coders ask these before writing a comment, Cleaners before keeping or changing
one, and Reviewers of every comment in the diff. The answer must be yes to (a)
and to (b) or (c). Otherwise the comment does not go in.

**(a) Is it needed at all?** Read the code without the comment. If the names,
types, structure and tests already tell the reader what they need, the comment
is useless: delete it. Try the ladder above first.

**(b) Does it say more than the code that runs?** A comment that describes the
executed steps (`// loop over users and add the active ones`) only repeats the
code, and goes stale the day the code changes. A good comment gives the
maintainer what the code cannot hold: the reason, the constraint, the
alternative that was rejected and why, the trap, the external rule (an RFC, a
regulation, a vendor bug), the units or the invariant.

**(c) Does it explain the design choice, not the implementation?** When a part
of the code is built from existing concepts (shared helpers, a base class, a
pattern, values imported from another module), a short comment may say *which*
concept is used and *why* here, so the maintainer knows the structure is
deliberate and where to change it. Example: `// Parsing is delegated to
net/header so retry and size limits stay in one place.` It does not walk
through *how* the helper works or narrate the lines that follow; that is the
implementation, and the helper's own name and docs carry it. A comment that
explains the concept for the whole module or many files belongs in the
documentation (section 6b), with at most a one-line pointer in the code.

Further rules every comment must pass:

- **Right level.** Comment at the declaration (function, type, module) rather
  than line by line inside the body. A body that needs many inline comments
  needs extracting instead.
- **Say why not.** When the obvious approach was rejected, the comment names it
  and the reason (`A Map is not used: callers rely on insertion order.`).
- **One source of truth.** Do not copy what the docs, a spec or another comment
  already say; link to it (`See docs/retry.md.`).
- **Survives refactoring.** No line numbers, no "above" or "below", no names of
  callers that may change, no dates, authors or change history (git keeps
  those).
- **Domain words.** Use the project's glossary terms, the same word the code
  and the docs use for a concept.
- **Nothing sensitive.** No secrets, internal hostnames, customer data or
  exploit details in a comment.
- **Tests.** The test name states the behaviour. A test comment is only for a
  non-obvious fixture or a regression it pins (with the issue number).
- **Generated and vendored code** is never commented or re-commented by hand.
- **The language's guide.** Follow the comment rules of the language's standard
  style guide: marker spacing, placement, doc vs line comment, the doc-comment
  format. The profile lists them per language ("Comments and documentation",
  from `languages.json` `docs.guide`). Where the project's own style guide is
  stricter, it wins.

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

## 2b. Interface files: the blueprint carries the explanation

Interface files are where comments are welcome: C and C++ headers (`.h`,
`.hpp`, `.hh`), TypeScript declarations (`.d.ts`), Python stubs (`.pyi`), OCaml
`.mli`, F# `.fsi`, Erlang `.hrl`, COBOL copybooks, and the like (the list per
language is `comments.interface` in `languages.json`).

- The interface comment **describes its source file**: what the module does,
  how it is implemented at the design level (which approach, which existing
  helpers or patterns it builds on) and why. The source file then needs fewer
  comments, which keeps it lean.
- A comment in the source that repeats the interface comment is a blocking
  finding (`repeats-interface`): the interface says it once.
- Relaxed, not loose: the gate (section 0a) still applies, and restating the
  signature, narrating the implementation line by line, commented-out code,
  questions and process notes are blocking here too. Interface files get higher
  limits for comment density (`commentAudit.interface`: a warning from 60%,
  blocking from 75%) and for prose length (12 lines instead of 6), and concept
  text there is a suggestion, not a blocking finding.
- Do not overdo it: a short module overview and a contract per declaration
  where the name and types do not say it. Not a tutorial.
- Languages without interface files (Go, Java, C#, Rust, ...) keep the source
  rules; the module-level doc comment (package comment, `//!`) plays this role,
  under the source limits.

## 3. Actionable markers

Use all-caps markers, with the owner or issue when there is one:

- `TODO:` an incomplete implementation or a feature to add later.
- `FIXME:` a known bug, temporary workaround, or broken code needing
  attention.
- `NOTE:` a durable fact about the code: a subtle nuance, a performance
  bottleneck, or a security-sensitive area. Never addressed to a person.

A marker never carries a question, a request or a conversation. Those go in
the PR remarks (section 6).
Markers are for real follow-up, not decoration. A `TODO` or `FIXME` the
change introduces is listed in the Handoff. A
`FIXME` on a known bug blocks QA PASS unless the human accepted it.

## 4. Review feedback uses Conventional Comments, on the virtual PR

Review feedback is written in the review thread (the virtual PR), never in the
code.

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

## 6. Where each kind of information goes

| It is... | It goes in... |
|----------|---------------|
| What a function does when that is not obvious: its contract, units, ranges, errors, side effects, ordering | a **code comment** (doc comment) |
| Why code looks the way it does and must stay that way: a constraint, an invariant, a trap, a workaround | a **code comment**, stating the lasting reason |
| A bug fix whose reason the next reader needs so they do not undo it | a **code comment** stating what must stay true and why (with the issue number). The story of the fix ("fixed the bug where...") is not code |
| A question for a Reviewer or Coder | the **PR Q&A** (review thread, Push JSON `qa`) |
| A remark, an explanation for a reviewer, a note to a teammate or to your future self | the **PR remarks** (line remarks, Handoff) |
| What changed and why in this change | the **commit message** and the PR description |
| Follow-up work | an **issue**, with `TODO(#n)` in the code only when the spot needs the pointer |

A note, a question or a remark is never left inside a comment. If you want a
reviewer to look at a line, say so in the PR; delete the question from the
code once it is answered.

## 6b. Comment or documentation?

Before adding or changing a comment, ask whether the text belongs in the
documentation instead. The test is **scope and audience**:

| The text... | Put it in... |
|-------------|--------------|
| Is only true of these few lines and only someone editing them needs it | a **code comment** |
| Describes how and why a module is implemented, at the design level | the module's **interface file** (section 2b), if the language has one; else the module doc comment |
| States a function's contract (units, errors, side effects) | a **doc comment** in the language's format |
| Explains a concept, a pattern or a flow that spans several functions or files (how modules fit together, why the layers are split this way) | the **docs** (`README`, `docs/`, the module's README), with at most a one-line pointer in the code |
| Tells a user or operator how to use, configure, run or deploy something | the **docs** (usage, configuration, runbook) |
| Records a decision with its alternatives and trade-offs | an **ADR** or the design doc, if the project keeps them; else the docs |
| Is longer than about five lines of prose | usually the **docs**; the code keeps the one sentence the next editor must not miss |

Docs are written only as needed, and **updating what exists always comes
first**:

- **Update the existing doc**, with the smallest edit that makes it true: change
  the sentence or table row that is now wrong, add the one paragraph that is
  missing. Do not restructure, reword or reformat a doc you were not asked to
  change.
- **A new doc file only for a new system or module** that no existing doc
  covers. The Push JSON `docs` row names that system in `new`; a new doc file
  without it is a blocking finding (`new-doc`).
- Document only what is **durable and shared**: a concept many places rely on,
  a workflow people run, a decision people will ask about again. One function's
  detail does not get a doc page. No doc per change, no doc per function, no
  changelog prose in the docs.
- Do not duplicate: a fact lives in **one** place, code comment or doc, and the
  other links to it.
- The docs change in the same change as the code they describe. A stale doc is
  a defect, like a stale comment.
- If the project has no docs folder and the text is not shared knowledge, the
  answer is usually neither: improve the names instead.

Every doc section the change adds or edits is listed in the Push JSON `docs`
([push-json.md](push-json.md)): the file, the section, the comment it replaced
(`from`), if any, and `new` for a new file. An unlisted doc change is blocking.

## 6c. Balance (Reviewers)

Reviewers judge comments and docs together, not each alone:

All of these are `issue (blocking)`:

- Code full of comments that explain one concept again and again: move the
  concept to the interface file or the existing docs once, keep the pointer.
- A new doc page that only restates the code or one function: delete it, or
  fold the one durable fact into the existing doc.
- A new doc file where an existing doc could have been updated, or a doc edit
  larger than the change needs (rewording, restructuring, reformatting).
- A **new system or module** with no documentation at all: neither an interface
  file or module doc comment, nor a section in the docs. This is the usual case
  for missing docs; anything else updates what exists.
- A comment and a doc that say the same thing: keep one, link from the other.
- A source comment that repeats its interface comment.

Missing comments on clear code and missing docs on local detail are **not**
findings.

## 7. How Coders avoid over-commenting

1. **Default to zero new comments.** The number of comments in a diff is never
   a measure of quality. Every comment you do write passes the gate (section 0a)
   and the docs question (section 6b).
2. **Climb the ladder before commenting:** rename, extract a function, add a
   test that pins the behaviour. Only then write a comment.
3. **Comment budget.** Every comment the change adds is listed in the Push JSON
   `comments` array with the reason the code cannot say it
   ([push-json.md](push-json.md)). An unlisted comment is a blocking finding.
4. **Self-audit before handoff.** Run the comment audit (MCP `comment_audit`,
   or `node scripts/devops-comments.mjs audit --staged`). It flags comments
   that restate code, commented-out code, questions or process notes left in
   code, bare markers, signature-only doc lines, over-commented files and long
   prose. The Claude mod runs it on `git commit` and reports the result
   (`/devops comments strict` refuses a commit with blocking findings).
5. **Use the research.** The Researcher marks the code that is comment-worthy
   and the concepts that are doc-worthy
   ([research-and-reuse.md](research-and-reuse.md)); comment those places and
   not others.
6. **Answer line remarks.** Reviewers leave remarks on over-commented lines in
   the virtual PR. Delete the comment, or reply with the reason it stays; do not
   argue in a comment.

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
   comment on self-explanatory code is **not** a finding. Every finding in
   this list is `issue (blocking)`.
5b. Are markers well-formed, and are new ones listed in the Handoff?
6. Do comments follow the formatting rules, and do borrowed algorithms link
   their source?
7. Would a better name remove the need for the comment? (`suggestion`)
8. Is any question, remark or note to a person left in code? (`issue (blocking)`: move it to the PR Q&A and delete it.)
9. Does every new or changed comment pass the gate (section 0a)? A comment that
   narrates the implementation step by step, or explains a concept that belongs
   in the docs, fails it.
10. Is the balance right between comments and docs (section 6c)? Is every doc
   change listed in the Push JSON `docs`, and does it follow section 6b?
11. Does each comment follow the language's style guide (profile, `docs.guide`;
   the audit's language checks from `comments.checks`)?
11b. Interface files (section 2b): do they describe the source at the design
   level without overdoing it, and does the source avoid repeating them?
11c. Docs: is every doc edit the smallest that makes the existing doc true, and
   is any new doc file for a new system, named in the Push JSON `docs` `new`?
12. Run `comment_audit` and post each finding that holds as a **line remark** on the virtual PR (`path:line`, a Conventional Comment); do not edit the code yourself.
