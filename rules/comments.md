# Comments and documentation

- **Never add a comment because code was added.** If the code is
  self-explanatory, add none. The default for a change is no new comments.
- Prefer self-documenting code: descriptive names and clean structure first.
  Rename or extract before you comment.
- Explain intent (why, constraints, workarounds), never mechanics. Do not
  restate what the code does.
- When you change code, update or delete its comments in the same change.
  A stale comment is a defect.
- Delete commented-out code; version control keeps history.
- Never leave a question, remark or note to a person inside a comment. That
  belongs in the PR (Q&A, line remarks), and the comment is deleted once
  answered.
- Function behavior that is not obvious, and the lasting reason behind a bug
  fix or workaround, go in a comment. The story of the change goes in the
  commit or the PR.
- Use the language's standard doc format (Javadoc/JSDoc/TSDoc, PEP 257
  docstrings, XML docs, rustdoc, ...) only where the contract is not obvious
  from the name and signature (units, errors, side effects, lifetime,
  security assumptions), or where the project publishes generated API docs.
  A comment that repeats the signature is noise; delete it. The profile
  (`.devops/project.md`) names the format.
- Use `TODO:`, `FIXME:` and `NOTE:` (all caps) for incomplete work, known
  bugs or workarounds, and subtle or security-sensitive spots.
- Write comments as complete sentences: capital letter, full stop, wrapped
  before 80 columns. Link the source of any borrowed algorithm or protocol.
- Review feedback uses Conventional Comments: `<label> [decorations]: <subject>`,
  for example `issue (blocking): ...` or `suggestion (non-blocking): ...`.

Run the comment audit before handing off (`comment_audit` or
`scripts/devops-comments.mjs audit --staged`) and list every comment you keep in
the Push JSON `comments` with the reason the code cannot say it.

Full standard: `references/comment-standards.md` in the devops-multi-agent-team skill.
