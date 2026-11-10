---
name: project-mindmap
description: >-
  Answer questions about the open project quickly from its mind map, without the
  DevOps team: what the project is and does, how it is laid out, where to start,
  how to run or test it, where a function, class, file, module or library is,
  what calls or imports what, which docs explain a part, and whether something
  already exists before writing it. Use in plain chat for "what is this repo",
  "explain the structure", "where is X defined", "who uses X", "what does this
  module do", "which libraries do we use", onboarding and orientation questions,
  and /mindmap.
---

# Project mind map (plain chat)

The mind map is a generated summary of the repository: docs, modules, imports,
functions with line ranges, call links, libraries and possible duplicates
([mind-map.md](../devops-multi-agent-team/references/mind-map.md) has the detail).
In plain chat it replaces reading the tree: no team, no roles, no thought files,
no gates. You answer the person directly.

## Steps

1. **Quick scan first.** Call `mindmap_overview` (MCP), or run
   `node <plugin>/scripts/devops-mindmap.mjs overview`, or read
   `.devops/mindmap/OVERVIEW.md`. If the session prompt already carries the
   overview (the Claude mod adds it), use that and skip the call.
   About forty lines tell you what the project is, its size and languages, where it
   starts, how it is run, its parts, which docs to read first, its main
   libraries and what to watch out for.
2. **Answer from the overview** when it is enough ("what is this", "how is it
   organised", "how do I run the tests"). Say where each fact came from
   (README, `package.json` scripts, the module list).
3. **Look up specifics** with `mindmap_query`, one question at a time:
   `symbol` (definition, signature, line range, callers, callees, tests, docs),
   `file`, `module`, `library`, or `search` for a name or path fragment.
   `/devops map TEXT` does the search from the chat.
4. **Read narrowly.** Open a file only to answer what the map cannot (the body
   of a function, a value), and only at the line range the map gives.
5. **Freshness.** The overview says how many files changed since the map was
   saved. When the question touches one of them, read it directly. Offer to
   refresh (`mindmap_build` with `save=true`, or `/devops map refresh`); it
   writes only `.devops/mindmap/`. With no saved map, the tools build one in
   memory and write nothing.

## Keep in mind

- The map is heuristic (pattern matching, no compiler). Present a call link or
  an "unused library" as what the map shows, and check the code before stating
  it as fact for a change.
- Before writing new code at the person's request, look the name and its verbs
  up (`symbol`, `search`) and check **Watch out** / **Possible duplicates**: if
  it already exists, say so and offer to extend it.
- When the person starts a DevOps team run (`/goal`, research, review, QA,
  security), hand over to the `devops-multi-agent-team` skill: there the
  Researcher owns the map.
