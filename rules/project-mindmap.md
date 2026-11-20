# Project mind map first

When `.devops/mindmap/` exists, use it before reading the tree, in plain chat as
much as in a DevOps team run.

- For any question about the project (what it is, its layout, how to run it,
  where something is, what uses what), start from the overview
  (`mindmap_overview`, or `.devops/mindmap/OVERVIEW.md`) and answer from it.
- For specifics ask `mindmap_query` (symbol, file, module, library, search) and
  open files only at the line ranges it gives.
- If files changed since the map was saved (the overview says how many), read
  those directly and offer to refresh the map (`mindmap_build` with
  `save=true`).
- Before writing a new function, look its name up in the map; if it exists,
  extend it instead.
- The map is heuristic: check the code before relying on a call link for a
  change.
