---
name: question
description: Answer a project question from the mind map (MCP mindmap_*), without spawning the DevOps team.
---

# /question `<what you want to know>`

Execute now. Do not reprint, summarize, or paste these instructions into chat — run the steps (tools and scripts) and report only the result.

Also: `/devops question`, `ask`, `how does X work`, `where is X`.

The method: `../skills/project-mindmap/SKILL.md` and
`../skills/devops-multi-agent-team/references/mind-map.md`.

1. Prefer `/devops question --mode … <text>` (or call `mindmap_*` /
   `node scripts/devops-mindmap.mjs …` yourself). That runs the mind-map
   script and returns real results — do not answer from memory or by
   pasting these instructions. Do not paste the whole tree into chat.
2. Modes via `/devops question --mode …`:
   - `overview` — what the project is and how it is laid out
   - `tree` — how a named node works (function, file, module, doc)
   - `symbol` / `file` / `module` / `library` / `search` — one targeted query
3. Open files only at the line ranges the map returns.
4. Do not spawn seats for a plain question. If the person starts a goal or review,
   hand off to `devops-multi-agent-team` and let the Researcher own the map.

