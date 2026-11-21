# Goal hashes and pod assignment

A **goal** is one unit of work the loop is trying to finish. Every goal
gets a **goal hash**, every seat working on a goal carries that hash,
and every goal is assigned to one **team (pod)** so that no pod judges
its own work. The **goal memory** file is the single record of all of
it, and goal hashes travel with the code in virtual git.

Read this file. Do not paste it into agent prompts.

## Goal hash

- Format: `goal-` followed by six lowercase hex characters
  (`goal-3c9e41`). Same width as `team-`, `agent-` and `item-` hashes;
  `scripts/devops-goals.mjs` mints and checks them.
- Minted once per goal and **never reused for a different goal**.
- A goal hash names the work, not the person. The agent hash names the
  seat, the team hash names the pod.

## Auto-assignment during allocation

`/devops allocate` (see [department-pods.md](department-pods.md),
Orchestrator duties) turns the parent goal into goals:

1. For each **team member** in the loop (each seat from the team
   sizing) the Orchestrator takes the goal **metric** (the measurable
   outcome in the parent goal, for example "the lint gate passes on
   the branch") and writes one acceptance line per seat for its job.
2. Each acceptance line becomes a goal, and the goal gets its hash
   from the memory file (rules below). The seat's `goal-agent-<hex>.md`
   lists that goal hash.
3. The goal is then **assigned to a team**: `team` is the pod that
   owns the work, and `judged_by` lists the teams that may review,
   security-check and QA it. `judged_by` never contains `team`.

## Carrying the hash while working

While a subagent works on a goal it carries that goal hash to show
what it is working on:

- its prompt names the goal hash and its agent hash
  (for example `goal-3c9e41` · `agent-0b0b0b`);
- its review thread and Handoff begin with `Goal: goal-3c9e41`;
- its Push JSON has a `goal` field with the same value;
- every commit it makes in its detached worktree carries the trailer
  `Goal: goal-3c9e41` (see Virtual git below).

A seat works on one goal at a time. If its goal changes, it switches
hash at the next line boundary (see Goal changes) and records the
switch in the Handoff.

## Pod assignment prevents self-review

Review, security and QA rules in
[department-pods.md](department-pods.md) and
[role-identity.md](role-identity.md) apply to goals as well:

- A seat may judge a goal only when its **team hash** is in the goal's
  `judged_by` and is not an author's team of that goal.
- The check is `devops-ids independence` over the goal's authors (agent
  and team hashes), as now. The goal's `judged_by` narrows the teams
  that may judge; the independence check still applies to each seat.
- Reassigning a goal to another pod updates `team` and `judged_by` in
  memory and appends the change to the goal's `history`. It never
  deletes the old pod from `history`.

## Goal memory file

One file tracks every goal, seat and pod on the PR:

`devops-skill/thoughts/non-final/goal-memory.json`

It is written by the Orchestrator only (agents read it; a seat's own
row is appended by the Orchestrator at allocation or on a goal change).
It is gitignored with the rest of `non-final/`.

```json
{
  "version": 1,
  "goals": {
    "goal-3c9e41": {
      "text": "The lint gate passes on the branch",
      "metric": "lint_check reports 0 blocking findings",
      "team": "team-1a2b3c",
      "judged_by": ["team-4d5e6f"],
      "status": "active",
      "agents": ["agent-0a0a0a", "agent-0b0b0b"],
      "history": [
        { "at": "2026-11-20T10:00:00Z", "event": "minted", "team": "team-1a2b3c" }
      ]
    }
  },
  "teams": { "team-1a2b3c": { "dept": "backend", "goals": ["goal-3c9e41"] } },
  "agents": {
    "agent-0a0a0a": { "team": "team-1a2b3c", "initial_job": "coder", "current_job": "coder", "goals": ["goal-3c9e41"] }
  },
  "superseded": {}
}
```

- `goals` is the record of every goal ever minted on the PR. Goals
  are never deleted; a finished goal gets `status: "done"`.
- `teams` and `agents` are indexes so the Orchestrator can find a
  pod's goals or a seat's goals without scanning.
- `superseded` maps an old goal hash to the new one, so a stale hash
  in an old commit still resolves.

The agent and team rows here mirror `seat-registry.md`; that file
stays the place for job history. The memory file adds goals.

## Goal changes

When a goal's text or metric changes, the Orchestrator gives the work
a **new** goal hash, chosen in this order:

1. **Same goal as before.** If the new goal text (after trimming and
   collapsing whitespace, lowercasing) equals the text of a goal already
   in `goals`, reuse that hash. This covers a goal another pod worked
   on earlier in the loop: the hash comes back, and its history gets a
   `reused` event.
2. **New goal.** Otherwise mint a fresh `goal-` hash and record a
   `minted` event.
3. In both cases, if the old hash still has work on it, its row gets
   `status: "superseded"`, a `superseded` entry points to the new hash,
   and the seats that held the old hash switch at their next line
   boundary.

A goal change never edits a hash's meaning in place. The old commits
keep their old `Goal:` trailer; that is how the history shows what was
asked for at the time.

## Virtual git

Goal hashes travel in the virtual PR
([virtual-git.md](virtual-git.md)), never in the real branch's history
until the push is authorized:

- **Commit trailer.** Each commit in a seat's detached worktree ends
  with `Goal: goal-<hex>` (one trailer per goal the commit serves).
- **Push JSON.** The `goal` field (and `goals` when a commit serves
  several) on every hunk record, so reviewers can see which goal a
  change belongs to without reading the diff.
- **Replay.** When the Orchestrator replays keep-commits onto the real
  branch ([virtual-git.md](virtual-git.md), Lifecycle step 6), the
  `Goal:` trailers are kept as the last lines of the message. This is
  a choice: they let a later reader trace a change to its goal. A
  project that does not want them can strip them at replay; the
  memory file still has the mapping.
- **Integration.** A cherry-pick of an item carries its goal hashes
  into `merge-order` lines on `team-board.md` (`goals` after the item
  hash). Board rows stay informational.

## Checks

`scripts/devops-goals.mjs` holds the rules, with no file access:

- `addGoal` mints a unique goal hash, or reuses the hash of a goal with
  the same text, and rejects a `judged_by` that contains the pod itself;
- `assignGoal` moves a goal to another pod and keeps its history;
- `supersedeGoal` gives a changed goal a new hash and points the old one at it;
- `goalTrailers` reads the `Goal:` trailers of a commit message.

A seat that finds a goal hash it does not know in memory treats it as
unassigned and asks the Orchestrator; it does not judge that work.
