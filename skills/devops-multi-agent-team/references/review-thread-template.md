# Review thread template

Copy to `devops-skill/thoughts/non-final/review-<seat-id>.md`.
Local only; do not commit. After QA PASS, move to `final/`.
See [thoughts-layout.md](thoughts-layout.md).

```markdown
# Review: <topic>

**Branch:** <shared checkout; do not invent a real git branch>
**Side-branch:** `side/<dept>-<topic>` (`side-<dept>.md`)
**Authors:** <coder-id>[, <researcher-id>]   **Reviewers:** <reviewer-id>[, ...]
**Status:** In review | Changes requested | Satisfied — ready for security | Closed
**Push policy:** Only QA may give the OK to push (review-bot feedback fixes: qa-publish-policy.md).

## Research brief
### Local docs / Online media / Recommendations
- … · | URL | Takeaway |

## Push JSON
- Latest: `devops-skill/thoughts/non-final/push-<seat-id>.json`
- The Coder (`seat`) writes this **before the first review**. Reviewers compare
  it to the side-branch tree vs `<integration-base>`.

## Change summary (Coder)
- Files / Intent / Notify (Handoff + Push JSON path)

## Review round N (Reviewers)
### Request changes
Use Conventional Comments: `<label> [decorations]: <subject>`; blocking items
are `issue (blocking)`. Comments and reimplementation findings are blocking.
- [ ] `path` — `issue (blocking): finding` (cite research/doc/URL; label the reviewer id)
### Questions / Suggestions (non-blocking)
- …
### Reviewer sign-off
| Reviewer | Verdict | Notes |
|----------|---------|-------|
| <reviewer-id> | Changes requested / Satisfied | … |

## Line remarks (virtual PR)
Reviewers leave remarks on specific lines here, never in the code. Over-commented
lines, comments that restate code, and anything `comment_audit` finds that holds
go in this table as Conventional Comments. The Coder deletes the comment or
replies with the reason it stays; the Reviewer sets the status.
| Where (`path:line`) | From | Remark (`label (decoration): subject`) | Status |
|---------------------|------|-----------------------------------------|--------|
| src/a.ts:12 | <reviewer-id> | issue (blocking): restates the code; delete it or rename `tmp`. | open / fixed / declined (reason) |

## Q&A (Coder ↔ Reviewer)
Questions and notes between Coder and Reviewer live here and in Push JSON `qa`,
not in comments in the code.
| Id | From | To | Ask | Answer | Status |
|----|------|----|-----|--------|--------|
| q1 | <reviewer-id> | <coder-id> | … | | open |
| q2 | <coder-id> | <reviewer-id> | … | | open |

## Coder response (round N)
- Replies + what changed; q-ids closed

## Handoff
- From / To / Pass-along / Sent back because / Ask

## Security (after Satisfied; not for review-bot feedback fixes without an exception, see qa-publish-policy.md)
- Seat: <security-id> · Verdict: Clear / Blocked

## QA handoff
- Seat: <qa-id> · Commands; build and tests; SOC 2 verdict; clean diff (`git diff --stat <base>...HEAD`); publish gate
  PASS / BLOCKED; VM send-back; triage ids; thoughts to finalize
```
