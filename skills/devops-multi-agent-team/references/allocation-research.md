# Allocation research and the sprint board

Read this file. Do not paste it into agent prompts.

There are no fixed team sizes. Before anyone codes, the Orchestrator
finds out what the task needs with a short research step, plans the
teams and seats from what it found, spins up the board, and hands the
work to the team leads, who start with Sprint Planning.

## 1. The allocation research (always first)

The Orchestrator spawns at least one allocation researcher (two when the
mind map shows the task crosses three modules or more). The researcher
reads, writes no code, and returns the task split into **streams**:
pieces of work that can be built and judged on their own. For each
stream it records what it measured:

| Field | What it is |
|-------|-----------|
| `name` | a short name for the stream |
| `files` | how many files the change touches (`mindmap_query`, `reuse_search`) |
| `modules`, `languages` | how many modules or languages it spans (`module_map`) |
| `risks` | `auth`, `security`, `gate`, `payments`, `data-migration`, `public-api`, `infra`, `concurrency` |
| `unknowns` | the cause or the repro is not known yet |
| `newSurface` | it adds a module, a service or a public surface |
| `dependsOn` | the streams it needs first |

A simple bug is one stream with one or two files. The research is short
for a short task: it ends when every stream has these fields.

## 2. The plan (`allocation_plan`)

`allocation_plan` (or `node scripts/devops-allocation.mjs plan
RESEARCH.json`) turns the research into teams and seats. Each count
comes with its reason:

- **Teams.** Streams that depend on each other, directly or through
  others, share one authoring team; independent streams get their own.
  No team judges work it wrote. There is always a judging team, `J1`,
  that authors nothing: with one authoring team it reviews, QAs and
  security-checks that team's work; with more, each authoring team
  reviews the next one's items as their diffs land, and `J1` gives the
  final QA PASS and Security CLEAR on the combined tree, which every
  team wrote.
- **Points per stream.** Files (1 is 0 points, up to 5 is 1, up to 15 is
  2, up to 40 is 3, more is 4), each extra module or language (at most
  2), each risk (at most 2), unknowns (1) and a new surface (1).
- **Researchers.** One per stream with unknowns, a new surface or 3
  points or more; none for a plain one-file fix.
- **Coders.** One per stream, two when the team's streams reach 6
  points.
- **Reviewers.** One per coder, so each item is reviewed as its diff
  lands.
- **QA.** One, plus one per stream whose cause is not known yet (on
  `J1` with several teams, summed and capped).
- **Security.** One, plus one per stream that touches auth, security,
  the gate or payments (on `J1` with several teams, summed and capped).
- No job goes past 3 seats on one team (the ceiling in
  [department-pods.md](department-pods.md)).

Show the plan in the allocation Handoff. If the person changes it,
change the research (split or merge streams) and plan again; never cut
a judging seat.

## 3. Spin up the board (`board_spin_up`)

Once the plan stands, the Orchestrator mints a goal hash per stream and a
team hash and lead (the team's manager seat) per team, then calls
`board_spin_up` with the research. It:

1. opens the sprint (`weeks`, 1 to 4);
2. puts each stream on the backlog as a goal;
3. records the allocation on the board (`devops://meetings/<sprint>`);
4. schedules each authoring team's Sprint Planning with its lead.

That scheduled Sprint Planning is the hand-off to the team lead. Only an
unbound server (Orchestration) may spin up the board, and only the lead
the allocation names may run a team's meetings. The lead opens the
team's own board (`team_board_open`) and holds the planning
([scrum-meetings.md](scrum-meetings.md)).

## 4. Work in parallel, not in a line

The roles are async pods. Each item moves on its own, and every step that
does not need another's result starts at once:

- teams work their streams at the same time, each in its own detached
  worktrees ([side-work.md](side-work.md));
- inside a team, research, the repro (the failing check) and the security
  baseline start together;
- an item goes to review as soon as its diff lands, not when every item
  is coded;
- QA prepares (sandbox, test plan, CI) and Security scans the candidate
  tree during review;
- lint, the comment audit and the tests run side by side.

What stays in order, because each step checks the one before it:

1. the Reviewer's Satisfied on the diff;
2. QA PASS on the final `HEAD^{tree}`;
3. Security CLEAR on that same tree, after QA (a change after either
   voids both, and both are redone);
4. the person types `/devops push-ok` on that tree.

`allocation_plan` returns this as `parallel.together` and
`parallel.inOrder`.
