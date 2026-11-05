# Language setup

This is the language setup file for the DevOps multi-agent team skill and
the Claude mod. The skill itself is language-neutral: it knows seats,
pods, gates and handoffs. **What "build", "test", "lint" and "scan" mean
is decided here**, one language at a time, and written into each
project's `.devops/project.md`.

It exists because the three projects this was extracted from
(Bailey-Forbes-Flinstone, KeyQuorum, Homework-Central) each carried a
hand-edited copy of the skill with their own language rules baked in:
a C/ASM kernel built with `make`, a Rust crate with JS Workers and
Terraform, and a .NET API with a React front end. Those rules now live as
data in [`languages.json`](languages.json), and this page explains it.

| File | Role |
|------|------|
| `languages.json` | The data: detection, install, validation, security, style, boundaries, per language. Edit this to change a language for every project. |
| `LANGUAGES.md` | This guide. |
| `.devops/languages.local.json` (in a project) | Per-project override, merged by `id`. Add a language or change one command without forking the package. |
| `.devops/project.md` (in a project) | The result for one project. Hand-edited, committed, read by every seat first. |
| `scripts/devops-setup.mjs` | `list`, `detect`, `profile`, `install`. The mod calls `detect --json`. |

## How a project gets set up

```text
node scripts/devops-setup.mjs detect  --dest ~/my-project     # what is in it?
node scripts/devops-setup.mjs install --dest ~/my-project --target both
```

1. **Detect** looks for strong markers (`Cargo.toml`, `go.mod`, `*.csproj`,
   `tsconfig.json`, `.github/workflows`, ...) and file extensions, to depth
   five, skipping `node_modules`, `target`, `.git` and similar.
2. **Install** copies the skill, the nine agents and the commands into
   `.cursor/` and/or `.claude/`, copies `languages.json` and this file into
   `.devops/`, writes `.devops/project.md` for the detected languages,
   creates `.devops/thoughts/non-finalized/.gitkeep` and adds the
   gitignore block. It never overwrites a file that differs unless you pass
   `--force`; `--dry-run` shows what would change.
3. **You finish the profile.** The generator fills in what is knowable
   (languages, layers, departments, validation, security, style,
   boundaries). You fill in what is not: integration base, sensitive
   paths, never-stage paths, shared files, release rules, which MCPs are
   wired. That "Fill in by hand" section is what the three original
   projects wrote into their `Repo alignment` paragraphs.
4. **Install the toolchains** the profile lists. A seat that finds a tool
   missing reports `NOT RUN`; it never reports a pass.

## The five layers and how they interact

A language belongs to one or more **layers**. Departments (the pods the
skill staffs) follow layers, so a full-stack change is a cross-department
change with two Coders, independent reviewers and a shared contract.

```text
   web ──── HTTP / JSON / WebSocket / SignalR ────▶ backend ──── SQL ────▶ data
    │  ▲                                              │  ▲
    │  └── wasm module / generated .d.ts ───┐         │  └─ FFI (C ABI) ──┐
    ▼                                       │         ▼                   │
   css tokens                             systems ◀── asm (primitives) ────┘
                                              ▲
   scripting ── builds, runs, checks everything ┘      infra ── builds, scans, deploys all of it
```

| Layer | Languages | Owns | Typical failure when it is set up wrongly |
|-------|-----------|------|---------------------------------------------|
| **web** | TypeScript, JavaScript, CSS | what the person sees and the client state | passes unit tests, broken in the browser; hard-coded colors; absolute paths that break under a mount |
| **backend** | C#, Java, Kotlin, Go, Python, Rust, Node | rules, APIs, workers, persistence | a changed response shape nobody told the client about; raw SQL |
| **systems** | C, C++, Assembly, Rust, Go | memory, ABI, kernels, drivers, FFI | an ABI header changed without a version bump; a sanitizer build never run |
| **scripting** | Shell, PowerShell, Python | glue: dev stack, checks, release helpers | `.sh` and `.ps1` twins drift; unquoted expansions; a script nobody reviews because no scanner reads it |
| **infra** | Terraform, containers, CI workflows | pipelines, deploys, environments | a workflow weakened to get green; secrets in `vars`; a deploy token broader than needed |
| **data** | SQL, migrations | schema and queries | an edited migration; a destructive change with no rollback |

### Boundary rules (they apply to every pair)

1. **A boundary has one written contract.** HTTP: an OpenAPI file or shared
   DTOs. FFI: a header plus an ABI version constant. wasm: the generated
   `.d.ts` and the build script. SQL: the migration set. Wire formats and
   kind/event codes are **append-only, never renumbered**.
2. **Both sides move in one item.** Changing a contract is staffed on both
   departments, both Coders appear in `Authors:`, and the validation list is
   the union of both languages' commands.
3. **The producer is validated first.** Order for a full-stack change:
   data → backend → systems → web → scripting → infra. Do not run the
   consumer's tests against a producer that does not build.
4. **Each side keeps its own rules.** C holds policy while ASM holds
   primitives; the kernel orchestrates drivers; the lab never re-implements
   the CLI's rules; scripts do not hold business logic. A reviewer blocks a
   layer doing another layer's work.
5. **What no scanner reads, a human reads.** Assembly, shell, SQL and
   un-scanned IaC are listed in the Security seat's report as "not
   analysed", and a change to them always takes the full gate.
6. **One CodeQL language id can cover several languages.** `cpp` covers C
   and C++, `javascript-typescript` covers both, `java-kotlin` covers both.
   Run it once per id, and run every id a change touches.

### Stack recipes (how the pieces combine)

| Stack | Departments | Boundary | Validation order | Watch for |
|-------|-------------|----------|------------------|-----------|
| **React/TS + .NET API** (Homework-Central) | web, backend, data, tooling | REST + SignalR; EF migrations | `dotnet build/test` → `npm ci/lint/test/build` → smoke in browser | raw SQL; `var`/`dynamic` rule; design tokens; `.sh`/`.ps1` twins |
| **Rust core + TS lab + JS Workers + Terraform** (KeyQuorum) | systems/backend, web, infra | wasm build; Worker wrangler config; C header for FFI | `cargo fmt/clippy/test` (every feature set) → `npm run build:wasm/build/test:browser` → worker guard → `terraform validate` | features that must not combine; tests in own file; secrets only from the test helper; documented limits vs. deploy evidence |
| **C kernel + ASM + shell/Python tooling** (Flinstone) | systems, tooling, infra | calling convention; frozen contract headers; wasm lab | `make` + test targets (with sanitizers) → asm assembly per arch → script checks → CodeQL (cpp, python, actions) | asm not scanned; ABI headers append-only; versioning/lock rules; the kernel only orchestrates drivers |
| **Python service + TS SPA** | backend, web | OpenAPI | `ruff/mypy/pytest` → `npm …` | `shell=True`, pickle/yaml.load, untrusted `-I` imports |
| **Go service + containers + Terraform** | backend, infra | gRPC/OpenAPI; image | `gofmt/vet/staticcheck/test -race` → `docker build` + `trivy` → `terraform validate` | unpinned base images; `apply` is never run by a seat |
| **Java/Kotlin + Gradle** | backend | OpenAPI | `./gradlew build` | one CodeQL id for both |

## Per-language install guidance

The command lists below are authoritative in `languages.json`; this
section says what to install first, what trips people up, and what the
three source projects learned. `devops-setup profile` prints the
commands for the languages in a project.

### Systems layer

#### `c` — C
Install a compiler and the analyzers (`build-essential clang clang-tidy
cppcheck`). Build with the project's own system; do not invent a new one.
Build twice: strict warnings, and with `-fsanitize=address,undefined`.
CodeQL needs the real build command. Frozen headers (`contracts/`,
`fl/*`) are ABI: append, never renumber. If a target needs a cross
compiler or `emcc` that is missing, it is `NOT RUN`.

#### `cpp` — C++
CMake + Ninja, `clang-format` and `clang-tidy` from the repo's configs,
sanitizers (thread for concurrent code). CodeQL language `cpp` is shared
with C: run it once. Bindings (P/Invoke, pybind11) need the exported C
ABI listed as the contract.

#### `asm` — Assembly
Install `binutils` (GAS) and/or `nasm`; assemble every changed file for
each architecture the tree supports and keep the dialect the directory
already uses. **No scanner reads it**, so the Security seat reviews by hand
and says so, and the change takes the full gate. Memory primitives,
allocator internals, port I/O and low-level locks belong here; C keeps
policy.

#### `rust` — Rust
`rustup`, `rustfmt`, `clippy`, `cargo-audit`, `cargo-deny`; add
`wasm32-unknown-unknown` only when a wasm target exists. Run fmt, clippy
with `-D warnings` and tests **for every shipped feature set**, with
`--locked`. CodeQL for Rust uses build mode `none`. Tests go in their own
file beside the module and never contain a secret literal. Wire codes are
append-only; features that cannot coexist are refused in `build.rs`.

#### `go` — Go
Install the Go version in `go.mod`, plus `govulncheck` and `staticcheck`.
`gofmt`, `go vet`, `go test -race`. CodeQL builds with autobuild.

### Backend layer

#### `csharp` — C# / .NET
Install the SDK from `global.json`. Restore, `dotnet format
--verify-no-changes`, build with `--warnaserror`, test. CodeQL wraps
`dotnet build`. Raw SQL calls (`FromSqlRaw`, `ExecuteSqlRaw`,
`SqlQueryRaw`) must be parameterized; the Security seat searches for
them. The strict **explicit-types** preset (no `var`, no `dynamic`) is an
opt-in from Homework-Central, pinned in `.editorconfig` so a green build
proves it.

#### `java` — Java
Use the Gradle or Maven wrapper with a JDK matching the toolchain.
CodeQL id `java-kotlin`, build mode `none`. Look for deserialization,
JNDI, XXE and string-built SQL.

#### `kotlin` — Kotlin
Same toolchain as Java. `ktlint`/`detekt` when configured. Android needs
the SDK; report `NOT RUN` rather than guess.

#### `python` — Python
Create a virtualenv, install the dev requirements, run `ruff`,
`mypy`/`pyright`, `pytest`, `pip-audit`, `bandit`. CodeQL `python` needs no
build. Python used as a **script** (scripting layer) gets the lighter
route: `ruff` plus one smoke run.

### Web layer

#### `typescript` — TypeScript
Install the Node version in `.nvmrc`/`.node-version`, then `npm ci`
(or the repo's package manager). `lint`, `typecheck`, `test`, `build`, run
**from the package that owns them** (`frontend/`, `lab/`, `workers/` are
separate packages). Use `const`/`let`, never `var`, and run lint with
`--no-inline-config` so a disable comment cannot hide it. CodeQL id
`javascript-typescript`. A browser app is also smoke-tested by the
Verifier seat.

#### `javascript` — JavaScript
As TypeScript without the typecheck. Edge/Worker code has guard scripts
and a `wrangler.toml`: run them, and never put a credential in `[vars]`.

#### `css` — CSS / SCSS
`stylelint` and a look in light and dark themes. Colors, shadows and
timings come from design tokens; the token-only preset (Homework-Central)
forbids hard-coded values. No scanner; the review checks `url()` input.

### Scripting layer

#### `shell` — Shell
`shellcheck`, `shfmt -d`, `bash -n`, plus one real run in a throwaway
directory. `set -euo pipefail`, quote everything, pass untrusted text as an
argument, `mktemp` for temp files. CodeQL does not read shell. Backstop
scripts that grep for banned constructs are CI code and take the full gate.

#### `powershell` — PowerShell
PowerShell 7, `PSScriptAnalyzer`, Pester. Keep each `.ps1` and its `.sh`
twin in the same change.

### Data layer

#### `sql` — SQL / migrations
`sqlfluff` for style, then apply the migration to an empty and a populated
database and, if reversible, roll it back. Migrations are append-only. No
string-built SQL anywhere. A schema change is a storage-format change.

### Infra layer

#### `terraform` — Terraform / HCL
Pinned provider lockfile, `fmt -check`, `validate`, `tflint`, `checkov`.
A seat plans; the **operator applies**. No state or tfvars with secrets in
git.

#### `containers` — Containers
`hadolint`, a real `docker build`, `trivy` for the image and config, pinned
base images, non-root user. Some projects deliberately ship no container
(KeyQuorum is Cloudflare-only): do not add one without a plan.

#### `ci-workflows` — CI workflows
`actionlint`; actions pinned to a commit; least-privilege `permissions:`;
untrusted text through `env`, not inline `${{ }}`. CodeQL language
`actions`. A required check keeps one stable name. A workflow change is
never review-bot-exempt.

## Changing or adding a language

Add an entry to `languages.json` (to change it everywhere) or to
`.devops/languages.local.json` (to change it for one project). The shape:

```json
{
  "id": "ruby", "name": "Ruby", "layers": ["backend"],
  "detect": { "files": ["Gemfile"], "extensions": [".rb"] },
  "toolchain": { "install": ["rbenv install"], "verify": "ruby --version" },
  "validate": ["bundle exec rubocop", "bundle exec rspec"],
  "security": {
    "sast": { "tool": "codeql", "language": "ruby", "buildMode": "none" },
    "sca": ["bundle audit check --update"], "secrets": ["gitleaks detect --redact"],
    "unanalysed": false
  },
  "style": ["rubocop defaults"],
  "sensitiveHints": ["eval, system, YAML.load"],
  "interactsWith": [{ "with": "typescript", "via": "JSON API", "contract": "OpenAPI" }],
  "setupNotes": [], "seenIn": []
}
```

- `detect.files` entries may start with `*` to match a suffix (`*.csproj`);
  `detect.paths` are directories or files at a fixed path.
- `security.sast` is `null` for a language no tool reads; set
  `unanalysed: true` so the report names it.
- `optInStyle` rules are listed in the profile but are not default policy.
- A local entry with an existing `id` replaces the fields it names.

`node scripts/check-languages.mjs` validates the shape, the layer names,
the `interactsWith` targets and that each language has a heading above.

## What stays out of this file

Anything about **one** project: its branches, its ticket numbers, its
version-lock rules (`.ver` files, changelog generation), its protected
paths. Those go in `.devops/project.md` under "Fill in by hand", where the
three source projects kept them as their `Repo alignment` section.
