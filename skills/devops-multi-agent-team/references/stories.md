# Stories

A **story** is a written change proposal at the level of the code: what exists
now (OLD), what it becomes (NEW), why, and how it relates to other stories. It
is a specification, not the implementation. Stories are how a large change is
cut into pieces that can be reviewed, ordered and, later, built, and how two
projects (for example a server and its client) agree on the pieces that cross
between them.

The format: one file per story, a catalog
index, typed links, verbatim OLD blocks pinned to a baseline commit, NEW blocks
that say honestly whether they were compiled, and a Why section with decisions
and corrections.

## Where stories live

| Path | What | Git |
|------|------|-----|
| `.devops/stories/catalog.json` | the index: id, title, status, links, files, patterns, decisions, issue number | committed |
| `.devops/stories/<ID>.md` | one story ([story-template.md](story-template.md)) | committed |
| `.devops/stories/guidance.md` | generated: order, ready work, patterns, decisions, graph | committed |
| `devops-skill/thoughts/non-final/` | the drafts, reviews and remarks while a story is worked | ignored |

The catalog names its project code (`SRV`, `CLI`) and baseline branch and commit.
Ids are `<CODE>-<number>`. A project links to another project's stories by
their ids; to see both at once, load both catalogs (`story_graph` with
`dests`).

## Statuses and links

| Status | Meaning |
|--------|---------|
| `PROPOSED` | written, not decided |
| `DECIDED` | the owner chose among the open questions |
| `REVISED` | re-baselined; the premise holds but the details changed |
| `IN-PROGRESS` | being implemented |
| `DONE` | implemented on the baseline |
| `SUPERSEDED` | replaced (needs `supersededBy`) |
| `DROPPED` | withdrawn, with the reason in the Why |

Add a short reason in parentheses after the status, as is usual in a catalog.

Links are typed and always kept on both sides: `depends-on` (and its inverse
`needed by`), `absorbs` (SRV-20 absorbs SRV-24), `supersedes`, `refines`,
`shares-contract` (two stories change one interface). `story_link` writes both
sides and refuses a cycle; `story_graph` finds anything that drifted.

## The flow, by seat

1. **Research (primary).** Researchers decide how the stories are organized,
   before anyone writes OLD or NEW.
   - Read what already exists: the docs, the open issues and stories, the
     catalog, the module mind map (`module_map`) and the reuse map
     ([research-and-reuse.md](research-and-reuse.md)).
   - Cut the change into stories: one cohesive change each, small enough to
     review, with its own tests. Split when a story touches two layers or two
     owners; merge when two cannot be reviewed apart.
   - Write each story's **Already on the baseline** list, so a story never
     proposes what exists.
   - Draw the relations: dependencies, who needs it, what it absorbs or
     supersedes, which stories share a contract, and the stories on the other
     project's side. Check the draft with `story_graph` (no cycles, dependency
     order, what is ready).
   - Deliver an **organization brief**: the story list, the Mermaid graph, the
     draft catalog entries (`story_new`, plan), open decisions for the owner.
2. **Coders write OLD, then NEW.** For each story, in dependency order:
   - **OLD first.** Re-read the code from the baseline and copy the lines
     verbatim, with `path`, line range and the baseline commit. Run
     `story_check`; every block must be `verbatim`. If the premise is false,
     say so in the Verdict and mark the story `REVISED`.
   - **NEW second.** Write the proposal against the OLD, reusing what the
     research found. Label it `proposal, not compiled`, or `compiled` only if it
     was. A story changes no product code.
   - Fill in **Why** (decisions, corrections with evidence, assumptions to
     confirm), **Guidance**, **Not verified** and **Tests**. Follow
     [comment-standards.md](comment-standards.md) in every NEW block.
3. **Reviewers review the concepts.** Not typos first: is the story the right
   size; does the premise hold; is NEW consistent with the reuse map and the
   contract rules (append-only wire formats, ABI headers); are the links right
   and the order sensible; are the open decisions real questions with an owner;
   what did the story assume without checking. Remarks go on the virtual PR as
   line remarks and Q&A rows, never into the story as notes
   ([review-thread-template.md](review-thread-template.md)).
4. **QA, then Security, for final approval.**
   - **QA** first: `story_check` passes for every story (OLD verbatim, NEW
     labelled, sections present, no template placeholder left), `story_graph`
     has no problems, inverse links agree, statuses are consistent, and every
     "Not verified" is honest. QA records a pre-approval.
   - **Security** next: for each story, what trust boundary, secret, access
     rule, wire format or dependency does it change, and is that change safe
     as proposed ([soc2-review.md](soc2-review.md))? A story that weakens a
     check is a blocker even though it is only a proposal.
   - **QA records the final `Publish gate: PASS`** after Security is Clear, so
     QA remains the only role that may OK a push.
5. **Link and guide.** The Orchestrator regenerates `guidance.md`
   (`story_guidance`) and commits the stories with the catalog.

## Guidance for future work

Every story's **Guidance** section records a reusable **pattern** (a short
kebab-case tag), **applies when**, and **do not repeat**. The catalog carries
the pattern tags and the recorded decisions. `guidance.md` indexes them so the
next Researcher can start from "which earlier story solved this shape?" instead
of from nothing:

- before proposing a new story, search `guidance.md` and the catalog for the
  pattern, then `reuse_search` the code;
- a decision already recorded (for example "labels are case sensitive") is
  reused, not reopened, unless new evidence is cited;
- when a story is SUPERSEDED or DROPPED, its Why keeps the reason, so the same
  idea is not proposed again unchanged.

## Rules that keep stories honest

- Every OLD block is **verbatim from the baseline commit**; a drifted block is
  re-read, not patched by hand. A story whose baseline moved is re-baselined,
  and its Verdict says what changed.
- A NEW block is a proposal until it compiles; say which.
- A story never claims `DONE` until it is implemented on the baseline and the
  dependencies it names are `DONE`.
- Deviations from an issue or catalog entry are listed with the reason.
- A story that crosses projects names the story on the other side and which
  contract (header, wire format, ABI version) they share; both stories change in
  the same round.
- Stories contain no secrets and no personal data, and reference code by path
  and symbol.
