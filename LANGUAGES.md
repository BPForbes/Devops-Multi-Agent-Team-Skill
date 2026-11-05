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
| `services.json`, `SERVICES.md` | The same for Docker, cloud, AI services and VMs, plus the sandbox policy. |
| `scripts/devops-setup.mjs` | `list`, `detect`, `profile`, `install`, `status`, `check`, `sandbox`. The mod calls `detect --json`. |
| `mcp/server.mjs` | The MCP server: the same operations as chat tools (`detect_project`, `install_devops_team`, `add_language`, ...). |

## How a project gets set up

Through chat with the MCP server connected ("set up the DevOps team in this
project"), or from a shell:

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

## The layers and how they interact

A **layer** is a sorting tag: it groups the list for browsing and names the
departments (pods) the skill staffs. It is **not a restriction**. C# is as
usable for a service as for a game, Python as usable for a backend as for a
script, and chat setup or `--lang` accepts any id whatever its layer. A full-stack
change is a cross-department change with two Coders, independent reviewers and a
shared contract.

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
| **web** | HTML, TypeScript, JavaScript, CSS, Dart | what the person sees and the client state | passes unit tests, broken in the browser; hard-coded colors; absolute paths that break under a mount |
| **backend** | C#, Java, Kotlin, Scala, Go, Python, Ruby, PHP, Elixir, Erlang, Rust, Node | rules, APIs, workers, persistence | a changed response shape nobody told the client about; raw SQL |
| **systems** | C, C++, Assembly, Rust, Zig, Swift, WebAssembly, Go | memory, ABI, kernels, drivers, FFI | an ABI header changed without a version bump; a sanitizer build never run |
| **scripting** | Shell, PowerShell, Python, Perl, Lua, Ruby | glue: dev stack, checks, release helpers | `.sh` and `.ps1` twins drift; unquoted expansions; a script nobody reviews because no scanner reads it |
| **infra** | Terraform, containers, CI workflows | pipelines, deploys, environments | a workflow weakened to get green; secrets in `vars`; a deploy token broader than needed |
| **data** | SQL, migrations | schema and queries | an edited migration; a destructive change with no rollback |
| **game** | C#, C++, GDScript, Lua | engine, game logic and engine scripting | engine-only steps (editor, export templates) reported as passes instead of `NOT RUN`; assets committed as binaries without a size budget |
| **science** | Python, R, Julia, Haskell, OCaml, Clojure, F#, Fortran | numerical and functional-first work, notebooks | non-deterministic results compared for equality; notebooks that only run on one person's machine; an unpinned environment |

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
| **Unity (C#) + Lua tooling** | game, tooling | engine API; asset import settings | `dotnet build` of non-engine libraries → engine batchmode tests (NOT RUN in a sandbox) → `luacheck` | binary assets and `.meta` files in review; editor-only code in runtime assemblies |
| **Unreal (C++)** | game | UnrealBuildTool modules; Blueprint-callable APIs | engine-independent logic with CMake and tests → UBT build (NOT RUN in a sandbox) | module dependency cycles; hot-reload state |
| **Godot (GDScript, optional C# or C++ GDExtension)** | game | exposed node/script API; `.gdextension` | `gdformat --check`, `gdlint` → headless import → GUT/GdUnit tests | Godot version drift; exports NOT RUN |
| **Data science: Python + R + Julia** | science | files: Parquet/Arrow with a versioned schema | per-language env restore → tests → notebook render | unpinned environments; random seeds; notebooks as the only record |
| **Elixir/Phoenix + TypeScript** | backend, web | JSON/Channels/LiveView | `mix format/credo/test/sobelow` → `npm …` | atoms from input; channel message schema drift |
| **Rails + TypeScript** | backend, web | JSON API; Rails migrations | `rubocop/rspec/brakeman` → `npm …` | mass assignment; migration on a populated database |
| **Laravel/PHP + JS** | backend, web | routes and JSON; Blade/HTML templates | `composer audit` → `phpstan/phpunit` → `npm …` | unescaped output; `unserialize` |
| **Flutter/Dart + Kotlin/Swift** | web/mobile, backend | platform channels | `dart analyze/test` → native module builds (NOT RUN without SDKs) | channel name drift; device tests NOT RUN |
| **Embedded: C/Rust/asm (PlatformIO, cargo embedded)** | systems | register maps; linker script; HAL traits | host-side unit tests + simulator → cross-compile | hardware-in-the-loop is always NOT RUN in a sandbox |
| **Legacy COBOL batch + SQL + Java services** | backend | copybook record layouts; DB2/SQL tables | `cobc` build → fixed-input diff → Java tests | a record layout change is a wire-format change |

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

### Web, backend and scripting additions

#### `html` — HTML
Install: npm i -D html-validate. Validate: `npx html-validate "**/*.html"`; `run the accessibility check the project uses (axe or pa11y) in the Verifier smoke`; `check links on the built site (linkinator or the framework's own)`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `node:22-slim`. Templates in a server framework (Blade, ERB, Razor, Jinja) are reviewed as that language for injection and as HTML for structure.

#### `php` — PHP
Install: install PHP 8.3+ and Composer (https://getcomposer.org). Validate: `composer validate --strict`; `composer install --no-interaction --prefer-dist`; `vendor/bin/php-cs-fixer fix --dry-run --diff`. Scanner: psalm. Sandbox image `composer:2`. Laravel and Symfony have their own console test and lint commands; put them in the profile instead of guessing.

#### `ruby` — Ruby
Install: install Ruby with rbenv or asdf per .ruby-version. Validate: `bundle install`; `bundle exec rubocop`; `bundle exec rspec`. Scanner: codeql. Sandbox image `ruby:3.3-slim`. Rails: run db:migrate on an empty and a populated database before sign-off.

#### `dart` — Dart / Flutter
Install: install the Dart or Flutter SDK per pubspec environment (https://dart.dev, https://flutter.dev). Validate: `dart pub get`; `dart format --output=none --set-exit-if-changed .`; `dart analyze --fatal-infos`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `dart:3.5`. Flutter device and integration tests need an emulator or device: NOT RUN in the sandbox.

#### `scala` — Scala
Install: install a JDK, then Coursier: cs setup (https://get-coursier.io). Validate: `sbt compile`; `sbt scalafmtCheckAll`; `sbt test`. No scanner reads it: reviewed by hand and reported as not analysed. No sandbox image: host only, with the human's OK. No official sbt image is pinned here: build a project image from eclipse-temurin with sbt and pin its digest, or run on the host with the human's OK.

#### `perl` — Perl
Install: install Perl 5.36+ and cpanm. Validate: `perl -c <changed .pl/.pm files>`; `perlcritic --severity 3 <paths>`; `prove -lr t/`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `perl:5.40`. Legacy scripts often lack tests: add a characterization test (run on sample input, compare output) before changing one.

#### `elixir` — Elixir
Install: install Elixir/OTP via asdf or the official installer (https://elixir-lang.org/install.html). Validate: `mix deps.get`; `mix format --check-formatted`; `mix compile --warnings-as-errors`. Scanner: sobelow. Sandbox image `elixir:1.17`. Sobelow covers Phoenix apps; plain OTP libraries have no scanner, so say so in the report.

#### `erlang` — Erlang
Install: install Erlang/OTP and rebar3 (https://rebar3.org). Validate: `rebar3 compile`; `rebar3 fmt --check`; `rebar3 eunit`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `erlang:27`. Dialyzer is a type checker, not a security scanner; it does not change the unanalysed note.

### Systems additions

#### `swift` — Swift
Install: install Swift (https://swift.org/install) or Xcode on macOS. Validate: `swift build`; `swift test`; `swiftlint --strict`. Scanner: codeql. Sandbox image `swift:6.0`. CodeQL for Swift needs macOS; the Linux image builds Foundation-only packages. UIKit/SwiftUI/Xcode builds are NOT RUN in the sandbox.

#### `zig` — Zig
Install: install Zig from https://ziglang.org/download (match build.zig.zon minimum_zig_version). Validate: `zig fmt --check .`; `zig build`; `zig build test`. No scanner reads it: reviewed by hand and reported as not analysed. No sandbox image: host only, with the human's OK. Zig is pre-1.0: pin the compiler version in the profile and in CI.

#### `wasm` — WebAssembly
Install: cargo install wasm-tools wasm-pack --locked. Validate: `wasm-tools validate <module>.wasm`; `wasm-opt <in>.wasm -O2 -o <out>.wasm`; `wat2wasm <file>.wat -o /dev/null`. No scanner reads it: reviewed by hand and reported as not analysed. No sandbox image: host only, with the human's OK. This entry is a build target, not a source language: the source language's own entry decides compile, lint and scan; here you validate the binary and its surface.

### Game layer

#### `lua` — Lua
Install: install Lua 5.4 or LuaJIT and luarocks. Validate: `luacheck .`; `stylua --check .`; `busted`. No scanner reads it: reviewed by hand and reported as not analysed. No sandbox image: host only, with the human's OK. For scripts embedded in a host (game engine, Neovim, nginx) the host binary is needed to run real tests: NOT RUN unless a headless mode exists.

#### `gdscript` — GDScript (Godot)
Install: pip install "gdtoolkit==4.*". Validate: `gdformat --check <paths>`; `gdlint <paths>`; `godot --headless --path . --import`. No scanner reads it: reviewed by hand and reported as not analysed. No sandbox image: host only, with the human's OK. Exports (Windows, Android, web) need export templates and are NOT RUN in the sandbox.

### Science layer

#### `fortran` — Fortran
Install: install gfortran and fpm (https://fpm.fortran-lang.org). Validate: `fpm build`; `fpm test`; `fprettify --diff <files>`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `gcc:14`. The gcc image carries gfortran but not fpm: add fpm in a pinned project image.

#### `cobol` — COBOL
Install: install GnuCOBOL (cobc): apt-get install gnucobol, brew install gnucobol. Validate: `cobc -x -Wall -o build/prog src/*.cbl`; `run the program with a fixed input file and compare the output file byte for byte`; `cobol-check`. No scanner reads it: reviewed by hand and reported as not analysed. No sandbox image: host only, with the human's OK. GnuCOBOL is the free compiler; mainframe-only dialect features may not compile there: report NOT RUN for those, never a pass.

#### `r` — R
Install: install R (https://cran.r-project.org) and renv. Validate: `Rscript -e 'renv::restore()'`; `Rscript -e 'lintr::lint_dir()'`; `Rscript -e 'styler::style_dir(dry = "fail")'`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `rocker/r-ver:4.4`. Notebooks (.Rmd) are code: render them in CI and diff the outputs only when they are deterministic.

#### `julia` — Julia
Install: install Julia via juliaup (https://julialang.org/install). Validate: `julia --project -e 'using Pkg; Pkg.instantiate()'`; `julia --project -e 'using JuliaFormatter; format("."; verbose=true)' then git diff --exit-code`; `julia --project -e 'using Pkg; Pkg.test()'`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `julia:1.10`. Precompilation makes the first run slow; cache ~/.julia in CI, not in the sandbox image.

#### `haskell` — Haskell
Install: install GHCup (https://www.haskell.org/ghcup): ghc, cabal, hls. Validate: `cabal build all`; `cabal test all`; `ormolu --mode check $(git ls-files '*.hs')`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `haskell:9.8`. Pin GHC and the package set (stack resolver or cabal freeze file) in the profile.

#### `ocaml` — OCaml
Install: install opam (https://opam.ocaml.org), then opam switch create . --deps-only. Validate: `opam install . --deps-only --with-test`; `dune build @check`; `dune build @fmt`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `ocaml/opam:debian-ocaml-5.2`. The opam image is large: pin the tag and cache switches outside the sandbox.

#### `clojure` — Clojure / ClojureScript
Install: install the Clojure CLI (https://clojure.org/guides/install_clojure) or Leiningen. Validate: `clj-kondo --lint src test`; `clojure -M:cljfmt check`; `clojure -X:test`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `clojure:temurin-21-tools-deps`. Other Lisps (Common Lisp, Scheme, Racket) are not separate entries: use this one for REPL-driven workflow notes and add a local entry if you need their toolchains.

#### `fsharp` — F#
Install: install the .NET SDK (https://dot.net). Validate: `dotnet restore`; `dotnet fantomas --check .`; `dotnet build --warnaserror`. No scanner reads it: reviewed by hand and reported as not analysed. Sandbox image `mcr.microsoft.com/dotnet/sdk:8.0`. CodeQL does not support F#; the C# entry's scan covers only C# projects in the same solution.

## Stripped from the requested list

The request listed many languages; these are not separate entries because they are rare today, locked to one vendor platform, or covered by another entry.

| Not added | Why / where it is covered |
|-----------|---------------------------|
| ASP.NET, Unity C# | `csharp` (service and game notes) |
| Unreal C++ | `cpp` |
| Node.js | runtime of `javascript` / `typescript` |
| Objective-C | notes under `swift` |
| Groovy, BeanShell | `java` (Gradle) |
| Lisp, Scheme, Racket | notes under `clojure`; add a local entry if you need their toolchains |
| Ada, D, Nim, V, Chisel, Mercury, LODA, Ch, NGS | rare in current projects; add by chat if you need one |
| Delphi, Visual Basic, VBScript, ABAP, Apex, PL/I, SAS, RPG, ColdFusion | vendor-platform languages; add a local entry for your platform |
| Tcl, AppleScript, AutoHotkey, Raku | niche scripting; add by chat |
| GML, UnrealScript, DarkBASIC, Squirrel, Haxe | engine- or tool-specific; Lua/GDScript/C# cover the common engines |
| Agda, Prolog, MATLAB | research or proprietary; add by chat if needed |

"Add by chat" means asking the assistant to define the language through the MCP `add_language` tool, which validates the entry and writes it to `.devops/languages.local.json`.

## Sandbox images

Each entry has `sandboxImage`: an official container image (pinned by tag; pin it by digest in your project) that can run its validate commands under the sandbox policy in `services.json` (network off except for dependency install, read-only root, no capabilities, no host secrets). `null` means no suitable image: that language runs on the host only with the human's OK, and the report says so. See `SERVICES.md`.

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
the `interactsWith` targets, the services file and that each language and service has a heading in its guide.

## What stays out of this file

Anything about **one** project: its branches, its ticket numbers, its
version-lock rules (`.ver` files, changelog generation), its protected
paths. Those go in `.devops/project.md` under "Fill in by hand", where the
three source projects kept them as their `Repo alignment` section.
