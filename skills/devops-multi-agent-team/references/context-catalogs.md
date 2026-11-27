# Context catalogs: the part of the mind map a seat needs

A seat does not carry the whole mind map. When Orchestration assigns work
with a scope, the server cuts the slice of the map that work needs, shapes it
for the seat's job, and delivers it to the seat's inbox as a typed envelope.
The seat works from that catalog, and gives each entry back when it no longer
needs it.

Rules: `scripts/devops-catalog.mjs`. Ledger: `.devops/catalogs.json` (local,
like the board). Envelopes: `docs/schemas/envelopes.schema.json`
(`context.catalog`, `context.update`, `context.release`, `context.request`).

## Module records and the index

Every module in the map has a **record hash** (`modules.<name>.hash` in
`mindmap.json`), built from its files' content hashes. It changes when any
file of the module changes, and only then. `catalog_index` lists module →
hash for quick lookup, or answers one module or one hash.

## The transformer

Starting from the modules the work names, the transformer walks `dependsOn`
and `usedBy` for `depth` steps (default 1, at most 3). A module the work names
gets the **full** entry for the seat's job; a neighbour gets its record only,
as a **reference**. Every entry carries the record: module, hash, files,
dependsOn, usedBy, libraries.

| Job | Full entry adds |
|-----|-----------------|
| coder | symbols with signatures and `path:line`, tests |
| reviewer | exports, callers outside the module, tests |
| qa | tests, callers |
| researcher | docs that describe the module, exports |
| business-analyst | docs that describe the module |
| any other | the record only |

A scope names modules directly, or files and symbols, which resolve to their
modules. Names the map does not know come back in `unknown`.

## Delivery

`work_assign` takes an optional `scope` (`modules`, `files`, `symbols`) and
`depth`. The server builds the slice from the saved map (or builds the map if
none is saved), records which modules the seat holds at which hash, and puts a
`context.catalog` envelope in `devops://inbox/<agent>` under `context`. A
subscribed seat is pushed the change, so the server is the one forwarding the
data. The catalog's `goal` carries the goal's title as the Business Analyst
wrote it on the board, so the seat reads the client's vision next to the code.

## Release: when an entry is no longer needed

When the seat's code for a module is satisfying, it calls `catalog_release`
(`agent`, `work`, `module`). The server:

1. **Rehashes** the module against the current tree.
2. **Updates the whole mind map**: rebuilds it and saves it under
   `.devops/mindmap/`.
3. **Tells the other holders**: every other seat that holds the module at an
   older hash gets a `context.update` envelope, "an update is available"
   (`old_hash`, `new_hash`, `changed_by`, `recommended: true`). The map is
   saved before the notice goes out, so a seat that pulls finds the new data
   already there.
4. **Drops the entry** from the releasing seat. A catalog whose modules are all
   released leaves the inbox.

A release with no change to the module notifies no one.

A notified seat calls `catalog_pull` (`agent`, `module`) to take the new entry.
Its holding moves to the new hash, the entry in its catalog is replaced, and
the notice is cleared. Pulling is recommended, not forced.

## Staying on course: the team lead

A seat that needs a module its catalog does not include calls
`catalog_request` (`agent`, `work`, `module`). It is granted at once when the
work already reaches that module. Otherwise it is **held for the team lead**,
who sees it in `needs_attention` (`catalogRequests`) and decides with
`catalog_decide`. An approved module is delivered as a catalog of that one
module. A refusal needs a reason. Only a member holding the manager role on
that team's board may decide, and only for seats on that team.

## Who does what

| Seat | Part |
|------|------|
| **Server** | Builds slices, keeps the ledger, forwards catalogs and update notices to inboxes. |
| **Orchestration** | Names the scope when it assigns work. |
| **Every seat** | Works from its catalog; releases an entry when done with it; pulls when told an update is available; asks before reaching outside its catalog. |
| **Team lead** | Decides held requests, so team members do not divert from the work. |
| **Business Analyst** | Owns the goal wording each catalog carries: the client's vision. |
