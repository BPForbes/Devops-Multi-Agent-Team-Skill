# QA triage item

Copy to `devops-skill/thoughts/non-final/triage-agent-<hex>.md`. The
resend payload it carries is [handoff-payloads.md](handoff-payloads.md) (`kind` `triage`). Same
Handoff + **Q&A** as the review thread. Copy agent hashes into Push
JSON `qa`. Register an `item-…` hash + notes. `"files"` may be `{}`.
Do not `git add`. After QA PASS, move to `final/`.

When QA is **blocked**, **sends back**, or is **not pleased**, QA
opens this file. The department's Researcher **joins the Coder
who picks the item up** and stays until Reviewers take the rewrite
([department-pods.md](department-pods.md)). Not a serial
research-then-coder queue.

```markdown
# Triage: agent-<hex>[-<n>]

**Item:** item-<6 hex> · **Notes:** <one line>
**State:** active | closed
**Opened by:** agent-<hex> (job qa)
**Discovered during:** <command, `/repro`, VM, SOC 2 review, CI>
**Branch:** <current checkout>
**Review thread:** `devops-skill/thoughts/non-final/review-agent-<hex>.md`

## What went wrong / Expected / Actual
- …

## Environment
- VM / host; commands; exit code

## Active loop
- [ ] Researcher (agent-<hex>) joins Coder (agent-<hex>) who picked this up (paired, not serial)
- [ ] Coder rewrite + Push JSON
- [ ] Reviewers compared JSON to the side-branch vs `<integration-base>`
- [ ] Security (after Satisfied)
- [ ] QA re-check on the VM

## Q&A
| Id | From | To | Ask | Answer | Status |
|----|------|----|-----|--------|--------|
| t1 | <qa-id> | <coder-id> | … | | open |

## Handoff
- From: <qa-id> / To: <coder-id> / Authors: <coder-id> / Pass-along /
  Sent back because: <quality / bug standard, or "n/a">
```
