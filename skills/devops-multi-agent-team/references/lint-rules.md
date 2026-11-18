# Lint gate

The lint gate is the first check a Reviewer runs. One blocking finding is a
hard **DENY**: the review stops, and the whole list goes back to the Coder,
every finding with its rule and its fix. The Reviewer does not pick a few.

## Two parts

1. **Built-in rules** (`lint_check`, or `node scripts/devops-lint.mjs check`):
   run on the lines the change adds. They cover every comment rule
   ([comment-standards.md](comment-standards.md)), code line length, function
   size, unused symbols, security patterns, outdated APIs and debug leftovers.
   Limits come from `.devops/standards.json`.
2. **Open-source linters** (`lint_commands`): ruff, ESLint, golangci-lint,
   clippy, shellcheck, hadolint and others per language, plus semgrep
   (security), gitleaks (secrets) and osv-scanner (vulnerable or outdated
   dependencies) for every project. The Coder runs each command in the sandbox
   (`sandbox_plan`) and records `{ "command", "exit" }` in the Push JSON
   `lint.tools`. A command missing from that list (`linter-not-run`) or a
   non-zero exit (`linter-failed`) is blocking. The MCP server never runs them.

## Who does what

- **Coder**: before handoff, run `lint_check` and every `lint_commands` command
  in the sandbox; fix every finding; record the results in the Push JSON `lint`.
- **Reviewer**: run `lint_check` with the Push JSON (`push`) on the side branch.
  DENY on any blocking finding. Send back the full list as line remarks, each
  with the rule and the fix from the table below. Review nothing else until the
  gate passes.
- **Cleaner**: same gate after every step.

## Configuration

`.devops/standards.json`:

```json
{
  "schemaVersion": 1,
  "lint": {
    "rules": { "sec-insecure-url": "off" },
    "exclude": ["vendor/**", "tests/fixtures/**"]
  },
  "linters": {
    "python": { "tool": "ruff", "command": "ruff check ." }
  }
}
```

- `lint.rules`: `"error"` (the default for every rule) or `"off"`. Turning a
  rule off is a project decision, made by the human, not by a Coder to pass the
  gate.
- `lint.exclude`: path globs the built-in rules skip (`*` within a directory,
  `**` across directories).
- `linters`: per language id, or `all` for every project, one entry or a list:
  `tool`, `command`, and optionally `configFile` and `options`.

## How the built-in rules decide

- They read only added lines, so existing code is not reported until it changes.
- Pattern rules (security, outdated, debug) are line patterns. A string that
  only looks like a pattern can trip one; the fix is to restructure the line,
  or to have the human exclude the path.
- `unused-symbol` looks for any other mention of the name in the repository.
  Exported names (`export`, `pub`, capitalised Go names), test files and names
  starting with `_` are skipped.
- Size rules report a function only where the change touches it.

## Rules

### Comments

| Rule | Fix |
|------|-----|
| `restates-code` | Delete the comment, or rename or extract so the code says it. |
| `commented-out-code` | Delete the code; version control keeps it. |
| `process-note` | Move the note to the commit message or the PR; keep only a lasting reason. |
| `question` | Move the question to the PR Q&A and delete the comment. |
| `doc-repeats-signature` | Delete the doc line, or state what the name cannot (units, range). |
| `marker` | Write TODO(#issue) or FIXME(#issue) in capitals and list it in the Handoff. |
| `long-line` | Wrap the comment within lineLength.comment. |
| `sentence` | Start with a capital letter and end with a full stop. |
| `long-prose` | Cut it to the one reason the code cannot show; move the rest to the docs. |
| `density` | Delete comments the code already says; keep only reasons and contracts. |
| `unlisted` | List the comment in the Push JSON `comments` with its reason, or delete it. |
| `divider` | Delete the divider line. |
| `narrates-code` | Delete the step-by-step narration; keep only the reason or design choice. |
| `narrative` | State the fact or the reason in one plain sentence. |
| `docs-candidate` | Move the concept to the interface file or the existing docs; keep a pointer. |
| `unlisted-doc` | List the doc edit in the Push JSON `docs`, or drop it. |
| `new-doc` | Update the existing doc, or name the new system in the Push JSON `docs` `new`. |
| `repeats-interface` | Delete the copy in the source; the interface file says it once. |
| `marker-space` | Put one space after the comment marker. |
| `inline-gap` | Put at least two spaces before an inline comment (PEP 8). |
| `trailing` | Move the comment to its own line above the code. |
| `hash-only` | Use # for comments. |
| `jsdoc-types` | Remove the {type} from the JSDoc tag; the signature declares it. |
| `go-doc-name` | Start the doc comment with the declared name. |
| `rust-safety` | Add `// SAFETY:` above the unsafe block saying why the invariants hold. |

### Style

| Rule | Fix |
|------|-----|
| `long-code-line` | Break the line within lineLength.code: extract a variable or wrap arguments. |

### Size

| Rule | Fix |
|------|-----|
| `function-length` | Extract cohesive blocks into well-named helpers until under function.maxLines. |
| `nesting` | Use early returns or extract the inner block into a helper. |
| `too-many-params` | Group related parameters into one value or options object. |
| `flag-argument` | Split into two functions named for what each does. |
| `magic-number` | Replace the repeated literal with a named constant. |

### Unused code

| Rule | Fix |
|------|-----|
| `unused-symbol` | Delete it, or use it. If it is public API, export it explicitly. |

### Security

| Rule | Fix |
|------|-----|
| `sec-eval` | Do not evaluate strings as code; parse the data or dispatch through a table. |
| `sec-shell` | Pass an argument list without a shell (execFile, subprocess.run([...])). |
| `sec-deserialize` | Use a safe format (JSON) or a safe loader (yaml.safe_load). |
| `sec-tls-off` | Keep certificate checks on; trust a CA bundle instead of disabling them. |
| `sec-secret` | Remove the secret, rotate it, and read it from the environment or a vault. |
| `sec-weak-hash` | Use SHA-256 or better; for passwords use bcrypt, scrypt or Argon2. |
| `sec-xss` | Set textContent or use the framework escaping; sanitize HTML you must render. |
| `sec-sql-concat` | Use parameterized queries (placeholders) instead of building SQL strings. |
| `sec-c-unsafe` | Use a bounded call: fgets, strncpy/strlcpy, snprintf. |
| `sec-insecure-url` | Use https://, or move the URL to configuration. |

### Outdated code

| Rule | Fix |
|------|-----|
| `outdated` | Use the current API named in the finding. |

### Debug leftovers

| Rule | Fix |
|------|-----|
| `debug-leftover` | Remove the debugging statement before handoff. |

### Open-source linters

| Rule | Fix |
|------|-----|
| `linter-not-run` | Run the open-source linter in the sandbox and record it in the Push JSON `lint`. |
| `linter-failed` | Fix every issue the linter reports and run it again until it exits 0. |

