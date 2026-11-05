> **Catalog entry {{ID}}** · project: **{{PROJECT}}** · baseline: `{{BASELINE}}`.
> **Verdict:** {{STATUS}}. State here, in one line, whether the premise still holds on the baseline.
> **Accepted defaults:** keep functionality the same in general and reuse existing code, logging and helpers.

### Already on the baseline

These are NOT part of this story. They are the base it extends. Name each by
path and symbol, as found in the research brief's reuse map.

- <what exists, `path`, `symbol`; the tests that cover it>

### Dependencies

```mermaid
flowchart LR
  {{DEPENDENCY_EDGES}}
  THIS(["{{ID}}"])
```

| | |
|---|---|
| **Project** | **{{PROJECT}}** |
| **File(s)** | `<path>` |
| **Change** | <modify / new files / delete / modify + delete duplicates> |
| **Status** | {{STATUS}} |
| **Depends on** | {{DEPENDS_ON}} |
| **Needed by** | {{NEEDED_BY}} |

**OLD** `<path>` lines <from>-<to> (verbatim from `{{BASELINE}}`)

```<language>
<the lines as they are on the baseline, character for character>
```

**NEW** (proposal, not compiled)

```<language>
<what the code becomes. Say "compiled" only if it was.>
```

**Why**

- **Decisions:** each open question and the answer, or `OPEN:` with the owner.
- **Corrections** to the draft or to earlier stories, with the evidence.
- **Assumptions to confirm** with the owner.
- **Cross-story effects:** contracts, wire formats and ABIs this changes (append-only), and the stories on the other side.

### Guidance (for future stories)

- **Pattern:** <a reusable shape this story establishes, as a short kebab-case tag, for example `pure-function-over-supplied-facts`>
- **Applies when:** <the situation in which a later story should reuse it>
- **Do not repeat:** <the trap this story found>

### Not verified

State what was not run or read (builds, targets, platforms) so nobody
mistakes a proposal for a result.

### Tests

The existing test file to extend, and the cases to add. No new test file
unless the module has none.
