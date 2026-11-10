---
name: mindmap
description: Build, check or query the repository mind map (docs, modules, imports, functions, calls, libraries) so seats stop re-reading files to find things.
---

# /mindmap

Also: `mind map`, `repo map`, `where is X defined`, `who calls X`.

The repository mind map ([mind-map.md](../skills/devops-multi-agent-team/references/mind-map.md))
is read before any source file.

1. **No argument**: run `mindmap_status` (MCP) or
   `node <plugin>/scripts/devops-mindmap.mjs status`. No saved map, or files
   changed: `mindmap_build` with `save=true` (writes only `.devops/mindmap/`).
   Report the counts and the files that changed; do not paste the summary.
2. **A name, path, module or library** (`/mindmap parseHeader`,
   `/mindmap src/api/routes.ts`, `/mindmap lodash`): `mindmap_query` with
   `symbol`, `file`, `module` or `library`; if nothing matches, `search`.
   Answer from the result: where it is defined (file and line range), callers,
   importers, tests and docs. Open a file only at the line range given.
3. A name defined in more than one place, or listed under **Possible
   duplicates**, is reported as a possible duplicate implementation for the
   Researcher, never silently picked.

The map is heuristic; when it and the code disagree, the code wins and the map
is rebuilt.

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
