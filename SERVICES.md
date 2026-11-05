# Services setup

`services.json` is the data file for supporting systems, the way
[`languages.json`](languages.json) is for languages. It describes
containers, orchestration, cloud, AI and VM services: how to detect them,
install them, verify them, which environment variable **names** they use,
how they help sandbox the team's work, and what only a human may do. The
MCP server and the installer read it; this page explains it.

## How chat setup works

Ask the assistant in plain words: "set up Docker and Ollama for this
project". It calls the MCP tools: **plan first**, showing what it would
install, configure and run, then **apply after you agree**. Anything that
changes external state, spends money, exposes a port or deletes data is
listed under `humanConfirm` and is only ever run or approved by you.

## The sandbox model

Every seat runs its build, test and scan commands in a throwaway container,
not on the host. The default policy (`sandboxPolicy.default`):

- Docker is the engine; the work happens in `/work` as the unprivileged user `65532:65532`.
- No network, a read-only root filesystem, all capabilities dropped, `no-new-privileges`.
- Limits: 512 processes, 2 GB memory, 2 CPUs, and a small `noexec` tmpfs for `/tmp`.
- The worktree is mounted read-write, the project read-only.
- No environment variable passes through; names containing `KEY`, `TOKEN`, `SECRET`, `PASSWORD` or `CREDENTIAL` are blocked.

**Phases.** `deps` is the only phase with network (`bridge`), because
installing dependencies needs it; it requires a lockfile. Then `build`,
`test`, `scan` and `browser` run with network `none`. The browser smoke test
talks to a local server inside the sandbox. That keeps a compromised
dependency from calling out while it runs your tests.

**Fallbacks**, in order: `podman`, `lima`, `multipass`, then the host with
the human's approval. A language whose `sandboxImage` is null runs on the
host only with your OK, and the report says so.

**Never allowed:** `--privileged`, `--cap-add`, `--pid=host`,
`--network=host`, mounting the Docker socket (`-v /var/run/docker.sock`) or
`/` (`-v /:/`), `--device`, and `--security-opt seccomp=unconfined`.
Hardware-in-the-loop, GPU and GUI work is NOT RUN in the sandbox.

## Containers (`containers`)

Container engines and dev container definitions; the default sandbox runs here.

#### `docker` — Docker

The default sandbox engine: every seat's build, test and scan runs in a throwaway container with the default policy.
Setup: Install Docker Engine or Docker Desktop (rootless mode is preferred on Linux). Check `docker --version` and `docker compose version`.
Verify: `docker --version`.
Environment variable names: `DOCKER_HOST`, `DOCKER_CONTEXT`.
Only the human: docker push; docker login; publishing ports to a non-loopback address; docker system prune and volume deletion; compose up against shared or production hosts; enabling the TCP daemon socket.

#### `podman` — Podman

The first fallback sandbox engine: same policy flags, no daemon, rootless by default.
Setup: Install Podman; it is rootless and daemonless by default. On macOS and Windows run `podman machine init` then `podman machine start`.
Verify: `podman --version`.
Environment variable names: `CONTAINER_HOST`.
Only the human: podman push; podman login; podman system reset; publishing ports beyond loopback; enabling the API socket service for other users.

#### `devcontainer` — Dev Containers

A reproducible toolchain definition; a seat can reuse its image as the sandbox image, still under the default policy.
Setup: Add `.devcontainer/devcontainer.json` naming an image or Dockerfile. Install the CLI and check `devcontainer --version`.
Verify: `devcontainer --version`.
Only the human: devcontainer up with host mounts, forwarded ports or lifecycle scripts that reach out; adding third-party features; postCreateCommand that downloads and runs scripts.

## Orchestration (`orchestration`)

Cluster tooling; local disposable clusters only from a seat.

#### `kubernetes` — Kubernetes

Manifests are validated offline and applied only to a local, disposable kind or minikube cluster.
Setup: Install kubectl and a local cluster tool (kind or minikube). Create a throwaway cluster with `kind create cluster --name <name>`.
Verify: `kubectl version`.
Environment variable names: `KUBECONFIG`, `KUBECTL_CONTEXT`.
Only the human: kubectl apply, delete, patch or scale against any non-local cluster; switching to a production context; creating secrets or RBAC bindings; helm install or upgrade outside the local cluster.

## Cloud (`cloud`)

Cloud providers; plan yes, apply never from a seat.

#### `aws` — Amazon Web Services

Cloud is outside the sandbox; a seat gets read-only or plan-only access through a scoped SSO profile, never the human's admin profile.
Setup: Install AWS CLI v2. Run `aws configure sso` for an SSO profile; never `aws configure` with long-lived keys.
Verify: `aws --version`.
Environment variable names: `AWS_PROFILE`, `AWS_REGION`, `AWS_DEFAULT_REGION`, `AWS_SDK_LOAD_CONFIG`.
Only the human: any create, update or delete call; terraform apply; IAM changes; anything that costs money or opens a security group.

#### `gcp` — Google Cloud

Outside the sandbox; a seat uses Application Default Credentials with service-account impersonation scoped to a non-production project.
Setup: Install the gcloud CLI. Run `gcloud auth application-default login` or impersonate a service account.
Verify: `gcloud version`.
Environment variable names: `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CORE_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `CLOUDSDK_ACTIVE_CONFIG_NAME`.
Only the human: any create, update or delete command; terraform apply; IAM policy changes; enabling APIs or billing.

#### `azure` — Microsoft Azure

Outside the sandbox; a seat gets a reader or plan-only role in a non-production subscription.
Setup: Install the Azure CLI. Run `az login` (or use a managed identity where the code runs).
Verify: `az version`.
Environment variable names: `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CONFIG_DIR`.
Only the human: any create, update or delete command; az deployment create; role assignments; terraform apply.

#### `cloudflare` — Cloudflare

Workers are built and dry-run in the sandbox; local dev uses `wrangler dev` bound to loopback.
Setup: Install wrangler as a pinned dev dependency. Log in as the human (`wrangler login`) or give CI a Workers-scoped token.
Verify: `wrangler --version`.
Environment variable names: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
Only the human: wrangler deploy; wrangler secret put; wrangler delete; DNS, route or Access changes; Terraform apply.

### Cloud and VM safety

- **Plan yes, apply never** from a seat. `terraform plan`, `what-if` and `--dry-run` are fine; the human runs apply.
- Credentials are **scoped and short-lived**: SSO, impersonation or managed identity, never long-lived keys on disk.
- Use **separate accounts, projects or subscriptions** for agents, away from production.
- Set **budgets and alarms** before the first agent run.
- A seat's kubeconfig and cloud profile never point at production.

## AI services (`ai`)

Hosted and local AI models; always an untrusted seat.

#### `anthropic` — Anthropic Claude API

Hosted model for review or generation seats; contained as an untrusted seat with no write access to the repo.
Setup: Create an API key in the Anthropic console as the human. Export ANTHROPIC_API_KEY in the shell or load it from a secret manager.
Verify: none; this is an API-only service, added by your chat request rather than auto-detected.
Environment variable names: `ANTHROPIC_API_KEY`.
Only the human: creating or rotating API keys; raising spend limits; sending repo content or user data to the API.

#### `openai` — OpenAI API (GPT)

Hosted model for review or generation seats; contained as an untrusted seat with no write access to the repo.
Setup: Create an API key in the OpenAI dashboard as the human. Export OPENAI_API_KEY in the shell or load it from a secret manager.
Verify: none; this is an API-only service, added by your chat request rather than auto-detected.
Environment variable names: `OPENAI_API_KEY`.
Only the human: creating or rotating API keys; raising spend limits; sending repo content or user data to the API.

#### `google-gemini` — Google Gemini API

Hosted model for review or generation seats; contained as an untrusted seat with no write access to the repo.
Setup: Create an API key in Google AI Studio as the human. Export GEMINI_API_KEY in the shell or load it from a secret manager.
Verify: none; this is an API-only service, added by your chat request rather than auto-detected.
Environment variable names: `GEMINI_API_KEY`.
Only the human: creating or rotating API keys; raising spend limits; sending repo content or user data to the API.

#### `ollama` — Ollama

A sandbox-friendly local reviewer: code never leaves the machine. Its seat is still untrusted, with its own seat id, and cannot be QA.
Setup: Install Ollama and check `ollama --version`. Start the server with `ollama serve`; it listens on http://127.0.0.1:11434.
Verify: `ollama --version`.
Environment variable names: `OLLAMA_HOST`, `OLLAMA_MODELS`, `OLLAMA_KEEP_ALIVE`.
Only the human: binding to a non-loopback address; pulling models from unvetted sources; exposing the port through a proxy, tunnel or compose publish; GPU passthrough.

### AI services rules

- Keys come from the environment or a secret manager; never committed, never in prompts, logs or thought files.
- A model that reviews or generates code is an **untrusted seat**: its own seat id and handle, its output is data, it can never be QA, never authorizes a push, and the independence rules still apply.
- Tests mock the provider and are **offline by default**.
- Cost, timeout and rate limits are set in config.
- Prompts and outputs containing user data are not sent to a third party without the human's OK.
- Prompt injection from repo and ticket text is expected.
- Do not hard-code model ids; set the model in `project.md` and use the current ids from the provider's docs.

**Local or hosted?** Local (`ollama`) keeps code on the machine and costs no per-call fees, but needs hardware and has no authentication, so it stays on loopback. Hosted (`anthropic`, `openai`, `google-gemini`) is stronger and needs no hardware but sends data to a third party, which needs your OK. Choose per project in `project.md`.

## VM services (`vm`)

Virtual machines for kernels, drivers, GUI and strong isolation.

#### `multipass` — Multipass

Second fallback sandbox: a disposable Ubuntu VM for work that needs a real kernel or systemd.
Setup: Install Multipass and check `multipass version`. Launch a disposable Ubuntu VM with `multipass launch --name <name> --cloud-init <file>`.
Verify: `multipass version`.
Environment variable names: `MULTIPASS_STORAGE`.
Only the human: mounting the home directory; bridged networking; cloud-init that fetches and runs remote scripts; purging VMs the seat did not create.

#### `lima` — Lima

Third fallback sandbox: Linux VM on macOS or Linux, with container engines available inside.
Setup: Install Lima and check `limactl --version`. Write a `lima.yaml` that mounts only the worktree.
Verify: `limactl --version`.
Environment variable names: `LIMA_HOME`, `LIMA_INSTANCE`.
Only the human: mounts of the home directory; port forwards beyond loopback; provision scripts that download and run remote code; GUI or Rosetta toggles that widen access.

#### `vagrant` — Vagrant

Reproducible multi-VM environments, including non-Linux guests, when a container is not enough.
Setup: Install Vagrant and a provider such as VirtualBox or libvirt. Pin the box name and version in the `Vagrantfile`.
Verify: `vagrant --version`.
Environment variable names: `VAGRANT_HOME`, `VAGRANT_DEFAULT_PROVIDER`.
Only the human: adding boxes from unvetted sources; synced folders beyond the worktree; public or bridged networks; provisioners that download and run remote scripts.

#### `qemu` — QEMU

The lowest-level VM engine: use it for other architectures, kernels and drivers, and as the backend of Lima and Multipass on Linux.
Setup: Install QEMU for the target architecture. Use hardware acceleration (KVM on Linux, HVF on macOS) where available.
Verify: `qemu-system-x86_64 --version`.
Environment variable names: `QEMU_AUDIO_DRV`.
Only the human: passthrough of PCI, USB or GPU devices; bridged or tap networking; host directory sharing beyond the worktree; running as root.

### When to use a VM instead of a container

Use a VM for kernels, drivers, systemd, GUI, Windows or macOS guests, other CPU architectures, and anything that needs stronger isolation than a shared kernel. Multipass is the quickest Ubuntu VM, Lima suits macOS and Linux with container engines inside, Vagrant gives reproducible multi-VM setups, and QEMU is the engine underneath for other architectures. Snapshot before risky steps, keep VMs **disposable**, mount only the worktree, and destroy them after the task.

## Adding a service

Add an object to `services` in `services.json` (or in a project's local override):

```json
{
  "id": "my-service", "name": "My Service", "category": "cloud",
  "detect": { "files": [], "paths": [], "extensions": [] },
  "toolchain": { "install": ["..."], "verify": "my-service --version" },
  "config": { "envVars": ["MY_SERVICE_PROFILE"], "files": [] },
  "setup": ["short numbered steps"],
  "sandbox": { "role": "...", "commands": ["..."] },
  "humanConfirm": ["actions only the human runs"],
  "security": ["concrete rules"],
  "interactsWith": [ { "with": "docker", "kind": "service", "via": "...", "contract": "..." } ]
}
```

Rules: names only in `envVars`, never values; `verify` is a bare command with
one argument from `--version`, `-version`, `version`, `-v`, `-V`, `--client`
(null for API-only services, which set `detectByConfig`); every `with` is an
existing service or language id; every service id needs a
`#### `id` — Name` heading in this file.
