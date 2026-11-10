# Reuse before you implement

Before writing any new function, module, service or driver, research the
project in depth: do existing code, helpers, interfaces, registries or
generated clients already cover the need, and can they be used or extended?

- **There are never two functions or methods that do the same thing.**
- When something is close but not enough, extend it (wrap, compose, or add an
  operation to its interface, driver or registry) instead of writing a
  parallel copy.
- Integration goes through the existing layers and facades, not around them.
- If a shared helper is missing, add it once in a shared place and point every
  caller at it.
- Write the search down: documentation read, terms searched, what you found,
  and for each find "reuse", "extend" or "new, because ...". Put it in the
  research brief and the PR description.
- Reviewers block duplicated code. Say what exists and how to extend it.

The DevOps multi-agent team has the Researcher produce a module mind map and a
reuse map (`references/research-and-reuse.md`) before any Coder starts. The
Researcher owns the repository mind map (`references/mind-map.md`) and carries
it into the brief; any seat, and plain chat, asks `mindmap_query` where
something is defined and who calls it instead of re-reading files.
