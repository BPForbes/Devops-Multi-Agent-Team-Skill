# Repository mind map

The mind map is a shared picture of the repository: how the
documentation is organised, how modules depend on each other, which file
imports which, which function calls which, and which libraries are used where.
It serves two modes: **plain chat**, where anyone asks about the project and
gets an answer from the overview without the team, and **a DevOps team run**
(Research, Coder, Reviewers, Security, QA), where the **Researcher** owns it and
puts what the other seats need into the brief. It exists to save tokens and to
stop duplicate implementations: a seat that knows where `slugify` is
defined, its signature, its line range and its callers does not read five files
to find out, and does not write a second `slugify`.

| File | What | Who reads it |
|------|------|--------------|
| `.devops/mindmap/OVERVIEW.md` | The quick scan, about forty lines: what the project is (README), size and languages, where it starts, how it is run (scripts, make targets), its parts and what each is for, docs to read first, most depended-on files, main libraries, what to watch out for | plain chat first; the Researcher first in a team run; the Claude mod puts it in the session prompt |
| `.devops/mindmap/MINDMAP.md` | The overview, then the **tree** (a Mermaid mindmap, and the code tree with each module's, file's and function's documentation on its line), **docs to code** (which doc sections describe which functions and files), then the detail: counts, a Mermaid module graph, a module table (dependencies both ways, libraries, key exports), a docs table (title and what each doc says), the most imported files, the most called functions, libraries, possible duplicates | the Researcher; anyone who needs more than the overview |
| `.devops/mindmap/graph.json` | The tree and its cross links as nodes and edges, for any graph tool | `mindmap_tree`, other tools |
| `.devops/mindmap/mindmap.json` | The full map behind it | `mindmap_query`, not people |
| `.devops/mindmap/text.json` | **Optional, yours**: the project's own wording for any sentence, label, heading or word list (see below) | read by every mind map tool and the Claude mod |
| `.devops/mindmap/NOTES.md` | **Hand-written**: how a module, file, function or doc works, one `## <node>` section each. Never generated, so rebuilding keeps it | written with `mindmap_note` or by hand; shown with its node everywhere |

Built by `mindmap_build` (MCP) or `devops-mindmap build --save`. It runs no
program and writes only `.devops/mindmap/`. Building takes well under a second
on a few thousand files.

## The tree and the graph

The map is one **tree** with **cross links**. Every node carries its own
documentation.

```text
project                         README summary
├── module   src/cart           its README, or the doc comment of its index file
│   ├── file   cart.ts          its header comment / module docstring
│   │   ├── function total      its doc comment or docstring, signature, L8-10
│   │   └── class Cart
│   │       └── method add
│   └── doc    README.md        title and summary
│       └── section ...         nested by heading level
├── documentation
│   └── folder docs/
│       └── doc design.md
│           └── section Totals  -> documents total(), money(), cart.ts
└── libraries
    └── library lodash          manifest and version
```

| Cross link | From | To |
|------------|------|----|
| `imports` | file | file |
| `calls` | function | function |
| `uses` | file | library |
| `documents` | doc section or doc | function, type or file it names |
| `links` | doc | doc |
| `tests` | test file | file it imports |

`mindmap_tree` (or `devops-mindmap tree --node X`) opens any node: where it sits
(`path`), its documentation and note, its subtree to a depth, and its links
both ways, each neighbour with **its** documentation. Asked about `total`, it
answers "adds up every line item; calls `money` (rounds to cents); documented
in design.md > Totals; note: rounds once so totals match the receipt" without
opening a file. Node names: a path, `path#name`, a module id, a bare name
defined once, a doc path, `docs/` folder, or `project`.

## Documentation in the map

Documentation comes from four places and is attached to the node it describes:

1. **In the code**: the doc comment right above a declaration (`/** */`, `///`,
   `//`, `#`, `--`, skipping decorators and attributes) or the docstring right
   below it (Python), cut to its first paragraph, `@param`-style tags left out.
   A file's header comment, module docstring or Go `// Package` comment
   describes the file. License headers, lint pragmas and TODOs are not
   documentation.
2. **READMEs**: a module's README describes the module; the root README the
   project. Without one, the doc comment of the module's index file is used.
3. **Doc files**: every heading is a section node. A section **documents** the
   functions and files it names: a code span written like code (`` `total()` ``,
   `` `Cart.add` ``, `` `parseHeader` ``, `` `CartItem` ``) or a link or path to
   a file. A plain lowercase word in backticks (`` `status` ``) is not linked,
   so write function names with `()` or qualified. Each function lists the
   sections that describe it (`documentedIn`).
4. **Notes** (`NOTES.md`): what the code and docs do not say: how a module works
   as a whole, why it is built that way, what to watch out for. Written with
   `mindmap_note` (plans unless `apply=true`; replaces that node's section) or by
   hand. Read live by `mindmap_tree` and `mindmap_query`, used for the module
   line of the overview at the next build.

Undocumented parts are visible too: a node with no `summary` and no `notes` is
a gap the Researcher can fill with a note.

## Wording: nothing is written in the code

Every sentence the mind map produces (overview labels, MINDMAP.md headings and
intros, table columns, tree labels, link names such as "called by", status
messages, errors, the NOTES.md header, the text the Claude mod adds to the
session prompt, and the MCP tool descriptions) is a template in
[`mindmap-text.json`](../../../mindmap-text.json) at the package root, with
`{placeholders}` the code fills in. So are the English word lists that steer
the scan:

| Word list | What it does |
|-----------|--------------|
| `notDocumentationContains`, `notDocumentationStarts` | a comment containing or starting with one of these is not documentation (license headers, lint pragmas, TODOs) |
| `docSectionLabels` | a doc comment's summary stops at a line like `Args:` or `Returns:` |
| `genericNames` | names too common to link as calls (`get`, `run`, ...) |

To change the wording for one project (another language, your team's terms),
write `.devops/mindmap/text.json` with the same shape and only the keys you
change:

```json
{
  "text": { "overviewTitle": "# {title} : vue d'ensemble", "overviewParts": "**Parties du code :**" },
  "words": { "docSectionLabels": ["Paramètres", "Retourne"] }
}
```

Keys you leave out keep the default. An unknown key or a wrong type is refused
with a message naming it, so a typo does not silently do nothing. A test checks
that no default sentence appears in the code and that every key the code uses
exists in the file.

## What is in it

- **Documentation**: every Markdown, reStructuredText, LaTeX and AsciiDoc file
  with its title, a one-line summary (front-matter `description` or the first
  paragraph), headings, the repository files it links to and the code paths it
  names. Each code file lists the docs that cover it (`documentedBy`).
- **Modules**: files, languages, which modules they depend on and are used by,
  libraries, key exported names.
- **Files**: language, module, a content hash, line count, imports resolved to
  files, importers, libraries, tests that import it (`testedBy`), docs.
- **Symbols**: functions, methods, classes, types, with kind, exported or not,
  the declaration line as a signature, and a **line range** (`line`–`end`), so
  a seat reads exactly those lines instead of the whole file. Helpers nested in
  a function are left out.
- **Call links**: `file#caller → file#callee`, resolved only when the callee is
  in the same file, in a file the caller imports, or defined once in the
  project. Ambiguous calls are counted, not guessed.
- **Libraries**: from `package.json`, `requirements*.txt`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`, `pubspec.yaml`, joined
  with the imports in code: declared where and at what version, used by which
  files, `undeclared` (standard library or missing from the manifest) or
  `unusedInScannedCode`.
- **Possible duplicates**: a function, class or type name defined in more than
  one non-test file.

Secret-looking files (`.env`, keys, `credentials*`, `secrets*`) are never read,
secret-looking values in signatures are redacted, and `node_modules`, build
output and `devops-skill/thoughts/` are skipped.

## Plain chat (no DevOps team)

The `project-mindmap` skill ([SKILL.md](../../project-mindmap/SKILL.md)) and the
`project-mindmap` rule cover this. For any question about the project:

No command is needed: the person asks in plain words ("what is this
project?", "how does `total` work?", "refresh the map") and the
`project-mindmap` skill picks the tool.

1. **Quick scan**: `mindmap_overview` (or `.devops/mindmap/OVERVIEW.md`; with
   the Claude mod it is already in the session prompt). Answer from it when it is enough.
2. **Specifics**: `mindmap_tree` on the node ("how does X work?": its
   documentation, note, children and the documentation of what it calls and
   what calls it) or `mindmap_query`, then open a file
   only at the line range given.
3. **Freshness**: the overview says how many files changed since the save; read
   those directly and offer `mindmap_build` with `save=true`
   when the person asks for it.

No roles, thought files or gates are involved, and the tools write nothing
unless asked to save.

## DevOps team run: the Researcher owns it

The Researcher is the primary user. The other seats work from the brief and use
the map only for narrow lookups, so the team does not pay for the same scan
several times.

| Seat | Uses the map for |
|------|------------------|
| **Researcher** | Writes `mindmap_note` for each module or function whose working the brief had to work out (how it works, why, traps), so the next round and plain chat get it for free. Start of every research round: `mindmap_status`, `mindmap_build` with `save=true` when stale or missing, read `OVERVIEW.md` and the parts of `MINDMAP.md` in scope, `mindmap_query` for each symbol, file, module and library the change touches. Into the brief go: the map's date, the overview lines that matter, the module mind map, each relevant definition as `path:start-end` with its callers and tests, the **Possible duplicates** in scope (explained or listed for cleanup) and the libraries involved. After QA PASS and integration, rebuild and save the map so the next round and plain chat start from a current one. |
| **Coder** | Reads the brief's mind-map section, not the whole map. Before adding a function, `mindmap_query` with `symbol` and `search` for its name and verbs; a hit means extend or call it, or ask the Researcher. Opens files at the line ranges the brief gives. |
| **Reviewer** | `mindmap_query` with `symbol` for each new name: one the map shows defined elsewhere is a re-implementation finding (blocking) unless the brief's "new, because ..." holds. New imports are checked against the module graph for forbidden edges. |
| **Security and QA** | `mindmap_query` with `library` to see where a vulnerable or undeclared dependency is used; QA checks the brief carries the map's date and the duplicates in scope. |

## Limits

Heuristic: regular expressions per language, no compiler. Dynamic imports,
reflection, macros, generated code, overloads and same-named methods on
different types are not told apart, and call links can miss or merge. Use the
map to decide **where to look**, then read those lines before relying on a
link for a change. When the map and the code disagree, the code wins: rebuild
the map.

## Commit it or not

The map is regenerated in under a second, so committing it is optional. Commit
`.devops/mindmap/` when fresh clones or cloud sessions should start with it;
`mindmap_status` says whether it is still current. Otherwise add
`.devops/mindmap/` to `.gitignore` and build it at the start of each session.
