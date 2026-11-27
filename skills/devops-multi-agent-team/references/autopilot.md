# Autopilot: allocate the first sprint from a list of tasks

Read this file. Do not paste it into seat prompts.

Autopilot sizes and staffs the first sprint from the tasks themselves. The
mind map measures each task, the plan gives one team per module, the
Business Analyst guides the draft until every seat is allocated, and one call
then opens the sprint, the team boards and the work. Rules:
`scripts/devops-autopilot.mjs`. Draft: `.devops/autopilot.json` (local).

It reuses the allocation planner ([allocation-research.md](allocation-research.md)):
each task becomes one stream, so every rule there holds. No team judges its
own work, review comes from another team, and the final QA and Security run
on teams that author nothing.

## 1. Draft (`autopilot_draft`, Orchestration)

Give the tasks (`title`, and as you have them `description`, `scope`,
`objective`, `acceptance`, `priority`, `risks`, `unknowns`, `newSurface`) and
the Business Analyst's agent hash (`ba`). For each task the draft records:

| Measure | From |
|---------|------|
| scope | the files, modules or symbols it names, or, when it names none, the files, modules and exported symbols its wording names |
| files, modules, languages | the mind map, over that scope |
| risks | the ones given, plus risk words in the task and its paths (login, token, payment, migration, deploy, lock, ...) |
| owner | its module when it touches one; none when it spans several |

The draft lists the **questions** the BA answers before allocation: a task
the map cannot place (`scope`), and a task that spans modules (`owner`, with
the module it changes most as a suggestion).

## 2. The plan: one team per module

Tasks owned by the same module share one authoring team. On that team:

- **Lead:** the first seat. It holds the manager role and works as a coder.
- **Coders:** one per task, up to 3 (the department-pods ceiling). The BA can
  lower a module's cap.
- **Researchers:** one per task with unknowns, a new surface or 3 points or
  more.
- **Reviewers:** a team reviews another team's work (with one authoring team,
  `R1` does), one review seat per coder of the team it reviews.

`Q1` gives the final QA and `S1` the final Security. Each is a team that
authors nothing, and its lead holds manager plus its job.

## 3. Steer (`autopilot_steer`, the Business Analyst)

Only the draft's BA steers, and only until allocation. Per task
(`decisions`), the BA can:

- choose the owning module of a task that spans modules;
- give a new `scope`, which is measured again;
- set the client's `objective`, `acceptance` criteria and `priority`;
- flag `risks`, `unknowns` or a `newSurface`;
- `defer` the task.

The BA can also cap a module's coders (`caps`). Every call re-plans and
returns the questions left. The team lead works the load out with the BA: a
lower cap keeps a small team from being stretched across too many tasks.

## 4. Allocate (`autopilot_allocate`, the Business Analyst)

Refused while a question is open. In one step it:

1. mints a team hash, a lead and every seat per planned team;
2. opens the sprint, puts each task on it as a goal titled after the task,
   with the client's objective, acceptance and priority and the team as its
   owner, and schedules each team's Sprint Planning (`board_spin_up` does the
   same for a hand-made plan);
3. opens every team's board, each seat with its roles;
4. hands each team's goals to its coders in priority order, never past a
   seat's open-work limit (3). Goals past the team's capacity stay on the
   backlog for the lead and the BA (`overflow`). Researchers take the tasks
   that need research first;
5. delivers each piece of work its context catalog from the mind map
   ([context-catalogs.md](context-catalogs.md)).

The BA's guidance ends there: the draft is `allocated`.

## 5. Launch

The reply's **launch list** names every seat with:

- its team and module, and its roles;
- the subagent that plays its job (`devops-multi-agent-team:devops-coder`, ...);
- the settings that bind it (`DEVOPS_SEAT`, `DEVOPS_TEAM`);
- the work it was given.

It also gives each **lead's brief**, the client's specification for every
goal its team builds, and the BA. The Orchestrator spawns one subagent per
seat from that list, with its settings and its brief or work, and the leads
hold Sprint Planning. The server does not start subagents itself.
`autopilot_status` shows the draft, its questions, its plan and, once
allocated, the launch list.
