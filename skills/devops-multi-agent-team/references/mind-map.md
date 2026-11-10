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
| `.devops/mindmap/MINDMAP.md` | The overview, then the detail: counts, a Mermaid module graph, a module table (dependencies both ways, libraries, key exports), a docs table (title and what each doc says), the most imported files, the most called functions, libraries, possible duplicates | the Researcher; anyone who needs more than the overview |
| `.devops/mindmap/mindmap.json` | The full map behind it | `mindmap_query`, not people |

Built by `mindmap_build` (MCP) or `devops-mindmap build --save`. It runs no
program and writes only `.devops/mindmap/`. Building takes well under a second
on a few thousand files.

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

1. **Quick scan**: `mindmap_overview` (or `/devops map`, or
   `.devops/mindmap/OVERVIEW.md`; with the Claude mod it is already in the
   session prompt). Answer from it when it is enough.
2. **Specifics**: `mindmap_query` (or `/devops map TEXT`), then open a file only
   at the line range given.
3. **Freshness**: the overview says how many files changed since the save; read
   those directly and offer `mindmap_build` with `save=true`
   (`/devops map refresh`).

No roles, thought files or gates are involved, and the tools write nothing
unless asked to save.

## DevOps team run: the Researcher owns it

The Researcher is the primary user. The other seats work from the brief and use
the map only for narrow lookups, so the team does not pay for the same scan
several times.

| Seat | Uses the map for |
|------|------------------|
| **Researcher** | Start of every research round: `mindmap_status`, `mindmap_build` with `save=true` when stale or missing, read `OVERVIEW.md` and the parts of `MINDMAP.md` in scope, `mindmap_query` for each symbol, file, module and library the change touches. Into the brief go: the map's date, the overview lines that matter, the module mind map, each relevant definition as `path:start-end` with its callers and tests, the **Possible duplicates** in scope (explained or listed for cleanup) and the libraries involved. After QA PASS and integration, rebuild and save the map so the next round and plain chat start from a current one. |
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
