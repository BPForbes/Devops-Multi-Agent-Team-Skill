---
name: story
description: Create, link, check and review stories (OLD and NEW change proposals tied together in a catalog). Research organizes, Coders write OLD then NEW, Reviewers review the concepts, QA then Security approve.
---

# /story

Execute now. Do not reprint, summarize, or paste these instructions into chat — run the steps (tools and scripts) and report only the result.

Also: `new story`, `link stories`, `story graph`, `check story`.

The method and the roles: `../skills/devops-multi-agent-team/references/stories.md`.
Prefer `/devops story --mode graph|research|check …` so `devops-stories.mjs`
runs (graph / guide / check) instead of only printing a card.

1. **Research first.** Spawn Researchers to read the docs, the open stories and issues, and the module map, then write the
   organization brief: the story list, the relation graph, the draft catalog entries and the open decisions.
   Check the draft with `story_graph` (or `/devops story graph`). Do not start Coders before the brief exists.
2. **Create.** `story_new` (plan, then apply) for each story; `story_link` for each relation. To bring an existing issue in,
   read it with the GitHub tools and run `story_parse` on its body to get the structure.
3. **Coders: OLD, then NEW,** per story in dependency order. Run `story_check` after OLD; every block must be verbatim.
4. **Reviewers** review the concepts and leave line remarks and Q&A on the virtual PR.
5. **QA** runs `story_check` and `story_graph`, then **Security** reviews, then QA records the final `Publish gate: PASS`.
6. `story_guidance` (apply) regenerates `guidance.md`; commit the stories with the catalog.

Nobody pushes without the human's go. Default path waits for QA's PASS; a
client order to push sooner wins and the skipped gate is recorded, never
reported as passed.
