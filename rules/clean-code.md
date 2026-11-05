# Clean code

- Names reveal intent: precise, searchable, no misleading words, no noise words
  (Info, Data, Manager, Util, Helper), no one-letter names outside tiny loops,
  no m_ prefixes. A name that needs a comment should be renamed.
- Small functions that do one thing, about 30 lines or fewer, shallow nesting,
  two or fewer parameters as the aim, no boolean flag arguments. Cut nesting with
  early returns and named helper functions.
- DRY with care: define logic once and call it; prefer existing code to a copy;
  do not merge things that only look alike, and do not abstract early.
- No magic numbers: name the constant, define it once.
- Comments only for the reason; the best comment is a better name.
- Follow the project's conventions and let the formatter and linter enforce one
  style. Simplicity and clarity over cleverness; shorter is not cleaner.
- Errors are explicit: no swallowed errors, no empty catch.
- Do not clean unrelated code in a feature change; that is a separate cleanup.

Full standard: `references/clean-code.md` in the devops-multi-agent-team skill.
