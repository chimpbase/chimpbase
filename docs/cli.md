# chimpctl

`chimpctl` is the customer CLI for [Chimpbase Cloud](https://chimpbase.dev). It wraps the cloud API so you can deploy, view logs, manage env vars and secrets, attach domains, scale, and roll back — all from your terminal.

It is an ahead-of-time compiled single binary (built with `bun build --compile`), so there is no runtime dependency on Bun or Node after install.

Source: [github.com/chimpbase/chimpctl](https://github.com/chimpbase/chimpctl).

## Install

::: code-group

```bash [script]
curl -fsSL https://chimpbase.dev/install.sh | sh
```

```bash [bun]
bun add -g chimpctl
```

```bash [npm]
npm i -g chimpctl
```

:::

Or grab a pinned binary from the [GitHub Releases](https://github.com/chimpbase/chimpctl/releases) page (linux-x64, linux-arm64, darwin-x64, darwin-arm64).

## Quickstart

```bash
chimpctl login            # GitHub device flow → API key
chimpctl init             # scaffold chimpbase.config.ts
chimpctl deploy           # bundle current dir, upload, deploy
chimpctl logs --follow    # tail logs
chimpctl open             # open the dashboard in your browser
```

## Commands

The v0 skeleton only wires `help` and `version`. The rest land as the `chimpbase/cloud` backend's API stabilizes:

| Command                          | What it does                                             |
|----------------------------------|----------------------------------------------------------|
| `chimpctl help`                  | Show help (also `--help`, `-h`).                         |
| `chimpctl version`               | Show CLI version (also `--version`, `-v`).               |
| `chimpctl login` / `logout`      | GitHub device flow, stores an API key locally.           |
| `chimpctl whoami`                | Print the currently authenticated user.                  |
| `chimpctl init`                  | Scaffold `chimpbase.config.ts` in the current directory. |
| `chimpctl deploy`                | Bundle, upload, deploy the current project.              |
| `chimpctl logs [--follow]`       | Stream service logs.                                     |
| `chimpctl env set|get|list|unset`| Manage environment variables.                            |
| `chimpctl secrets set|rotate|list`| Manage app secrets (envelope-encrypted server-side).     |
| `chimpctl domains add|remove|list`| Attach / detach custom domains.                          |
| `chimpctl scale <svc> <replicas>`| Scale a service.                                         |
| `chimpctl rollback <deployment>` | Roll back to a previous deployment.                      |
| `chimpctl status`                | Summary of services and recent deploys.                  |
| `chimpctl projects list|create|rm`| Manage projects.                                         |
| `chimpctl open`                  | Open the dashboard in the default browser.               |

## Configuration

Per-project config lives in `chimpbase.config.ts` at the project root (created by `chimpctl init`). Per-user config — API keys, default project — lives at `~/.config/chimpbase/` (mode `0600`).

## See also

- Architecture of Chimpbase Cloud: [CLOUD_ARCHITECTURE.md in the workspace root](https://github.com/chimpbase/chimpbase) (private repo for now).
- Self-hosting the orchestrator without Chimpbase Cloud: see [`@chimpbase/deployer`](https://github.com/chimpbase/deployer).
