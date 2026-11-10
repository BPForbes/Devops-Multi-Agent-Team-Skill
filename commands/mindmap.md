---
name: mindmap
description: Show the project at a glance, or build, check or query the repository mind map (docs, modules, imports, functions, calls, libraries) so seats stop re-reading files to find things.
---

# /mindmap

Also: `mind map`, `repo map`, `where is X defined`, `who calls X`.

The repository mind map ([mind-map.md](../skills/devops-multi-agent-team/references/mind-map.md))
works with or without the DevOps team: in plain chat follow the
`project-mindmap` skill; in a team run the Researcher owns it.

1. **No argument**: `mindmap_overview` (MCP) or
   `node <plugin>/scripts/devops-mindmap.mjs overview`. Show the overview (it is
   short) and how many files changed since it was saved; offer to refresh.
   **`refresh`**: `mindmap_build` with `save=true` (writes only
   `.devops/mindmap/`) and show the new overview.
2. **A name, path, module or library** (`/mindmap parseHeader`,
   `/mindmap src/api/routes.ts`, `/mindmap lodash`): `mindmap_query` with
   `symbol`, `file`, `module` or `library`; if nothing matches, `search`.
   Answer from the result: where it is defined (file and line range), callers,
   importers, tests and docs. Open a file only at the line range given.
3. **`how NAME`** (`/mindmap how total`): `mindmap_tree` on that node; explain
   how it works from its documentation, note, children and neighbours.
   **`note NAME TEXT`**: `mindmap_note` (show the plan, apply after a yes).
4. A name defined in more than one place, or listed under **Possible
   duplicates**, is reported as a possible duplicate implementation for the
   Researcher, never silently picked.

The map is heuristic; when it and the code disagree, the code wins and the map
is rebuilt.

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
