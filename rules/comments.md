# Comments and documentation

- Prefer self-documenting code: descriptive names and clean structure first.
- Explain intent (why, constraints, workarounds), never mechanics. Do not
  restate what the code does.
- When you change code, update or delete its comments in the same change.
  A stale comment is a defect.
- Delete commented-out code; version control keeps history.
- Public APIs, modules, classes and complex functions get the language's
  standard doc comment (Javadoc/JSDoc/TSDoc, PEP 257 docstrings, XML docs,
  rustdoc, ...). The profile (`.devops/project.md`) names the format.
- Use `TODO:`, `FIXME:` and `NOTE:` (all caps) for incomplete work, known
  bugs or workarounds, and subtle or security-sensitive spots.
- Write comments as complete sentences: capital letter, full stop, wrapped
  before 80 columns. Link the source of any borrowed algorithm or protocol.
- Review feedback uses Conventional Comments: `<label> [decorations]: <subject>`,
  for example `issue (blocking): ...` or `suggestion (non-blocking): ...`.

Full standard: `references/comment-standards.md` in the devops-multi-agent-team skill.
