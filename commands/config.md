---
name: config
description: Show or change the project standards in .devops/standards.json - line lengths, function limits, magic numbers, lint rules and excludes, linter commands. Every change is checked before it is written.
---

# /config `[show | get PATH | set PATH VALUE | unset PATH | add PATH VALUE | remove PATH VALUE | rule RULE error|off]`

Also: `settings`, `standards`, `change the line length`, `turn off a lint rule`.

Reads and changes `.devops/standards.json`; the package `standards.json` holds the defaults
([lint-rules.md](../skills/devops-multi-agent-team/references/lint-rules.md)).

1. Reading: `config_get` (MCP), or `node scripts/devops-config.mjs show|get PATH [--language ID]`.
   Say which values come from the project and which are defaults.
2. Changing: only what the person asked for, in their words. Call `config_set` with `apply=false`,
   show the old and new value, and apply after they agree. Or run
   `node scripts/devops-config.mjs set|unset|add|remove|rule ...`.
3. A change the validator refuses is not written; show the reason and stop.
4. Never loosen a setting (raise a limit, turn a rule off, add an exclude) to make a gate pass.
   Only the person changes that, directly with `/devops config ...` or by asking here.

Examples:

```text
/config get defaults.lineLength.code
/config set defaults.lineLength.code 120
/config set defaults.function.maxLines 40
/config add defaults.magicLiterals.allowed 100
/config add lint.exclude vendor/**
/config rule sec-insecure-url off
/config set linters.python.command "ruff check ."
/config unset defaults.lineLength.code
```
