# The dashboard

Read this file. Do not paste it into seat prompts.

The dashboard is one Markdown report, `devops-skill/thoughts/non-final/DASHBOARD.md`,
beside the board. The server rewrites it after every change to the board, the
catalog ledger or the sprint loop, so it is never behind the board. It is
generated: edit the board, not the report. Rules: `scripts/devops-dashboard.mjs`.

It has these sections, in order:

1. **Deadlocks and questions:** open deadlocks, those waiting for the client,
   goals that have stalled but are not yet raised, and forwarded deadlocks.
2. **Sprints:** each sprint's status, and whether the loop is paused.
3. **Goals:** state, sprint, owner and priority of every goal.
4. **Client vision:** each goal's objective, acceptance and its latest vision
   notes, with their source and time.
5. **Work items and files:** each work item, its seat and state, and the files
   it reaches in the mind map with **each file's hash** (the first 20; the rest
   are counted). Hashes change when the file does, so the report shows what a
   work item was made against.

A work item's files are recorded when the item is made: when work is assigned
with a scope (`work_assign`, or autopilot's allocation). Bug issues and items
pulled from GitHub get their files when they carry a scope too; pulling from
GitHub is not built yet.
