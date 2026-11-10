# Repository mind map

The mind map is the team's shared picture of the repository: how the
documentation is organised, how modules depend on each other, which file
imports which, which function calls which, and which libraries are used where.
Every seat reads it **before** opening source files. It exists to save tokens
and to stop duplicate implementations: a seat that knows where `slugify` is
defined, its signature, its line range and its callers does not read five files
to find out, and does not write a second `slugify`.

| File | What | Who reads it |
|------|------|--------------|
| `.devops/mindmap/MINDMAP.md` | The summary: counts, a Mermaid module graph, a module table (dependencies both ways, libraries, key exports), a docs table (title and what each doc says), the most imported files, the most called functions, libraries, possible duplicates | every seat, first |
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

## How seats use it

1. **Start of any task**: `mindmap_status`. If no map is saved, `mindmap_build`
   with `save=true`. If it lists changed, added or removed files, re-read
   **only those**; trust the map for the rest.
2. **Orient**: read `MINDMAP.md`. Do not open files to learn the layout.
3. **Look things up** with `mindmap_query`, one question at a time:

   | Ask | Gets |
   |-----|------|
   | `symbol: "parseHeader"` | definitions (file, line range, signature, exported, tests, docs), callers, callees, a warning if it is defined twice; similar names when there is no exact match |
   | `file: "src/api/routes.ts"` | its symbols with line ranges, imports, importers, libraries, tests, docs, calls in and out |
   | `module: "src/api"` | files, dependencies both ways, libraries, exports |
   | `library: "lodash"` | manifest and version, files that use it |
   | `search: "route"` | symbol names, file paths and doc titles containing the text |

4. **Read narrowly**: open a file only at the line range the map gives.
5. **After the change**: `mindmap_build` with `save=true`, so the next seat
   starts from a current map. The Coder does this before handoff; QA checks
   `mindmap_status` reports nothing stale for the files in the Push JSON.

## By role

- **Researcher**: the research brief's module mind map and reuse map start
  from `MINDMAP.md` and `mindmap_query` (then `reuse_search` for names the map
  does not hold, comments and prose). Every row of **Possible duplicates** in
  the area of the change is either explained or listed for cleanup.
- **Coder**: before adding a function, `mindmap_query` with `symbol` and
  `search` for its name and its verbs. A hit means extend or call it, or ask
  the Researcher. Refresh the map before handoff.
- **Reviewer**: a new name that `mindmap_query` shows defined elsewhere is a
  re-implementation finding (blocking) unless the brief's "new, because ..."
  holds. Check new imports against the module graph for forbidden edges.
- **QA and Security**: `library` queries show where a vulnerable or
  undeclared dependency is used.

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
