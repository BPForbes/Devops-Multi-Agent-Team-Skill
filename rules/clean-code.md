# Clean code

- Names reveal intent: precise, searchable, no misleading words, no noise words
  (Info, Data, Manager, Util, Helper), no one-letter names outside tiny loops,
  no m_ prefixes. A name that needs a comment should be renamed.
- Small functions that do one thing, about 30 lines or fewer, shallow nesting,
  two or fewer parameters as the aim, no boolean flag arguments. Cut nesting with
  early returns and named helper functions.
- A function that needs to do more calls helper functions; the parent only orchestrates. A name with And/Or
  is two functions.
- Closed for modification, open for extension: depend on the parent type, put the extension point on it, and
  add new behavior as new children or table entries, never as another `if` on a concrete type.
- Children must be able to replace their parent (Liskov): keep every promise the parent made, never throw
  or no-op what it promises, never make callers check the type. If a child cannot, restructure the hierarchy.
- DRY with care: define logic once and call it; prefer existing code to a copy;
  do not merge things that only look alike, and do not abstract early.
- No magic numbers: name the constant, define it once.
- Comments only for the reason; the best comment is a better name.
- Follow the project's conventions and let the formatter and linter enforce one
  style. Simplicity and clarity over cleverness; shorter is not cleaner.
- Errors are explicit: no swallowed errors, no empty catch.
- Do not clean unrelated code in a feature change; that is a separate cleanup.

Full standard: `references/clean-code.md` and `references/oop-principles.md` in the devops-multi-agent-team skill.
