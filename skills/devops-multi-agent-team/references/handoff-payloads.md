# Handoff payloads

Every hand-off between seats is a **JSON payload** sent through
**Orchestration**. Orchestration is only the medium: it checks the
payload, routes it to the receiving seat, and records it. No seat
talks to another seat directly for a hand-off. The payload is the
record of who asked for what, for which goal, and which pod.

Read this file. Do not paste it into agent prompts.

## Kinds

| `kind` | From (signs) | To | Pod rule |
|--------|--------------|----|----------|
| `triage` | QA | Coder who picks it up | the Coder's pod differs from QA's pod |
| `research-to-coder` | Researcher | Coder | same pod (research joins its Coder) |
| `coder-to-review` | Coder | Reviewer | the reviewer's pod differs |
| `review-to-qa` | Reviewer | QA | QA's pod differs |
| `qa-to-security` | QA | Security | Security's pod differs |
| `security-signoff` | Security | Orchestration | `result` is `clear` or `blocked` |

## Fields

Every payload has these fields, in this order:

```json
{
  "kind": "triage",
  "item": "item-3c9e41",
  "goal": "goal-7f0a12",
  "signed_by": "agent-0c0c0c",
  "from": { "job": "qa", "agent": "agent-0c0c0c", "team": "team-4d5e6f" },
  "to": { "job": "coder", "agent": "", "team": "team-1a2b3c" },
  "reason": "The lint gate still fails on the new branch",
  "created": "2026-11-20T10:00:00Z"
}
```

- `kind`: one of the kinds above.
- `item`: the item hash (`item-<6 hex>`).
- `goal`: the goal hash (`goal-<6 hex>`) the item serves
  ([goal-hashes.md](goal-hashes.md)).
- `signed_by`: the sending seat's agent hash. It must equal `from.agent`.
  For a triage this is the QA seat's hash.
- `from`: the sending job, agent hash and team hash.
- `to`: the receiving job, plus its agent hash and team hash. The agent
  hash is **empty** until the receiving seat is chosen. A triage
  usually goes out with `to.agent` empty, because the Coder who picks
  it up is not known yet; Orchestration fills it in and records it.
- `reason`: one line saying why the item came back. **Required on a
  triage**, empty elsewhere.
- `created`: UTC timestamp.
- `result` (only `security-signoff`): `clear` or `blocked`.

## Triage resend

1. QA finds the item is blocked, sent back or not right, and writes the
   triage payload with a one-line `reason`, signed with QA's agent
   hash, and the goal and team hashes filled in. `to.agent` is empty.
2. QA sends the payload to Orchestration. That message is QA's notice
   that a triage has been made and needs to be fulfilled.
3. Orchestration checks the payload (`scripts/devops-handoff.mjs`,
   `validateHandoff`), chooses the Coder who picks the item up, writes
   that agent hash into `to.agent`, and routes the payload to that Coder.
4. The Coder's rewrite and Push JSON follow the normal rules
   ([push-json.md](push-json.md)). The Researcher of the department
   joins that Coder at once ([department-pods.md](department-pods.md)).

## Other hand-offs

The same shape carries each hand-off in the loop. Orchestration checks
it, routes it, and records it in the goal memory file
([goal-hashes.md](goal-hashes.md)):

- research → coder: `research-to-coder`, when a brief is ready;
- coder → review: `coder-to-review`, with the Push JSON;
- review → QA: `review-to-qa`, once the review is Satisfied;
- QA → security: `qa-to-security`, once QA records PASS;
- security sign-off: `security-signoff`, with `clear` or `blocked`.

## Checks

`scripts/devops-handoff.mjs` provides `makeHandoff(kind, fields)` and
`validateHandoff(payload)`. Validation refuses a bad item, goal, agent or
team hash, a `signed_by` that is not the sender, a reason missing from a
triage, a receiving team equal to the sending team on a judging
hand-off, and a sign-off other than `clear` or `blocked`.
