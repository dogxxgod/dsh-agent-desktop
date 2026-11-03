# dsh-agent-desktop

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Host plugin that turns
[`agent-desktop`](https://github.com/vercel-labs/agent-desktop) — Vercel Labs' computer-use CLI —
into native `desktop_*` tools for the Harness agent.

`agent-desktop` reads and operates desktop applications through the OS accessibility tree: it
returns a JSON snapshot with a stable `@ref` for every element an agent can act on, the agent acts
on a ref, and snapshots again to verify. No pixel matching, no coordinates, the loop stays in the
agent. This plugin gives that loop to DSH as first-class tools.

- Plugin release: `0.1.0`
- Compatibility: **DSH `>= 0.2.1-rc.5`**, tested with `0.2.1-rc.5` on macOS 26.7.1 (arm64)
- CLI compatibility: `agent-desktop` `1.1.0` (JSON envelope `version: 2.6`)

---

## Why a plugin and not only a skill

The upstream project ships an agent skill (`SKILL.md`). DSH can install it as-is: its filesystem
skill provider scans `~/.dsh/skills` and `~/.agents/skills`, parses the YAML frontmatter
(`name` + `description`) and reloads the catalog without a restart. That is the right thing for
documentation.

There is one practical gap. The Harness **Bash tool is file-sandboxed**. On macOS the sandbox
cannot execute `/bin/ps`, and `agent-desktop` builds its application inventory with `ps` for
`list-apps`, every `--app <name>` filter, `launch` and `close-app`. Inside the Bash tool those
commands fail with:

```
TIMEOUT ... A required macOS app inventory source failed: ps: Operation not permitted (os error 1)
```

This plugin closes the gap by running the CLI from the **Host process** (no Bash sandbox), while
Bash commands stay confined. It also ships the skill's operating rules as a system-prompt section,
so the model knows the snapshot → act → verify loop, ref lifetime, retry dispositions and the
headless/headed policy without a separate skill installation.

The skill and the plugin can coexist; they complement each other.

## Requirements

1. **DeepSeek Harness `>= 0.2.1-rc.5`** in a profile that exposes `ctx.tools` and `ctx.subprocess`.
2. **Node.js `^22.19.0 || >=24.0.0`** (the Harness ships its own; nothing extra to install).
3. **The `agent-desktop` CLI** on the machine:
   ```bash
   npm install -g agent-desktop
   agent-desktop version        # {"version":"2.6","ok":true,...}
   ```
   Bun, Yarn and pnpm ship the same package. Direct release archives work too; point
   `binaryPath` at the executable if it is not on `PATH`.
4. **macOS permissions** (Windows/Linux differ, see the upstream docs):
   ```bash
   agent-desktop permissions --guide
   ```
   Grant **Accessibility** to the app that launches the Harness (`DeepSeek Harness.app`) and,
   if you want screenshots, **Screen Recording**. `desktop_status` reports both states.

## Install

The plugin is a local bundle: no build step, no install scripts, no runtime dependencies.

1. Clone this repository anywhere, for example:
   ```bash
   git clone https://github.com/dogxxgod/dsh-agent-desktop.git
   ```
2. Register it in the current Harness profile with the **Plugin Manager** (`plugin_manager`,
   `install_bundle`, target = the absolute package directory). The manifest declares the bundle
   patch; the manager links the package and inserts the host row:
   ```yaml
   - id: agent-desktop
     name: dsh-agent-desktop
     config:
       binaryPath: agent-desktop
       stateHome: ''
       timeoutMs: 60000
       promptSection: true
   ```
3. Restart the Harness if the manager reports `restart-required`, then ask the agent to run
   `desktop_status`. The tool list should contain `desktop_*`.

To tune the plugin without editing this package, override its row in your profile's
`cordis.patch.yml` (later layers replace the whole `config`):

```yaml
- id: agent-desktop
  config:
    binaryPath: /Users/you/.local/bin/agent-desktop
    stateHome: /Users/you/.agent-desktop
    timeoutMs: 90000
    promptSection: true
```

### Uninstall

Remove the bundle from the Plugin Manager (`remove_bundle`) and restart the Harness. The CLI and
`~/.agent-desktop` state stay on disk; remove them separately if you no longer need them.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `binaryPath` | `agent-desktop` | Executable name resolved through `PATH`, or an absolute path. Absolute paths are verified to be executable. |
| `stateHome` | `""` (CLI default `~/.agent-desktop`) | Sets `AGENT_DESKTOP_HOME`: snapshot refmaps, sessions and traces live here. Must be an absolute, private (owner-only) directory. |
| `timeoutMs` | `60000` | Default deadline per CLI command; each tool call can override it with `timeout_ms`. |
| `promptSection` | `true` | Inject the compact desktop-control rules into the agent system prompt. |

The CLI may write more than the plugin: screenshots use the path you pass, `--trace` uses the path
you pass, and sessions live under the state root.

## Tools

| Tool | CLI command | Purpose |
|---|---|---|
| `desktop_status` | `status` | Platform, permission states, CLI version, state root, supported surfaces. Run it first. |
| `desktop_list_windows` | `list-windows` | Visible windows with `w-…` ids, app, title, bounds, focused/visible. |
| `desktop_list_apps` | `list-apps` | Running GUI applications (name, bundle id, pid). |
| `desktop_snapshot` | `snapshot` | Accessibility tree with `@ref` ids. Defaults to the focused app. |
| `desktop_find` | `find` | Match elements by role/name/text/value/description/native id. |
| `desktop_get` | `get` | Read one property of a ref (text, value, title, bounds, role, states). |
| `desktop_click` | `click` / `double-click` / `triple-click` / `right-click` | Act on a ref. |
| `desktop_type` | `type` | Insert text into a ref (optionally per-keystroke). |
| `desktop_press` | `press` | Key combo, e.g. `return`, `escape`, `cmd+s`. |
| `desktop_scroll` | `scroll` | Scroll a ref by direction/amount. |
| `desktop_screenshot` | `screenshot` | Save a PNG of a window/display. |
| `desktop_run` | any command | Escape hatch for the remaining surface (`launch`, `clipboard-get`, `wait`, `session`, `batch`, notifications, window management …). |

Every tool returns the CLI's single JSON envelope (`ok` plus `data` or `error`). Command failures
are **not** turned into tool exceptions: the model branches on `error.code` and
`error.disposition`, exactly as the upstream skill teaches. Retry only when
`error.disposition.retry` is `safe` (delivery `not_delivered`); a delivered-but-unverified action
may have landed, so inspect live state before repeating it.

### Quick loop

```text
desktop_list_windows { app: "Finder" }
desktop_snapshot     { window_id: "w-204749", interactive_only: true, compact: true }
desktop_click        { ref: "@s8f3k2p9:e12" }
desktop_snapshot     { window_id: "w-204749", interactive_only: true, compact: true }   # verify
```

Dense apps: take `desktop_snapshot { skeleton: true }` first, then drill one region with
`desktop_snapshot { root: "@s8f3k2p9:e3" }`, then `interactive_only: true`.

Menus, sheets and alerts are surfaces: `desktop_snapshot { surface: "menu" }`.

### Escape hatch

```text
desktop_run { command: "clipboard-get" }
desktop_run { command: "launch", args: ["--app", "Safari"] }
desktop_run { command: "resize-window", args: ["w-204749", "--width", "1200", "--height", "800"] }
desktop_run { command: "session", args: ["start", "--name", "run_1"] }
desktop_run { command: "batch", args: ["--help"] }
```

`desktop_run` passes arguments verbatim and returns the envelope unchanged, so anything documented
by `agent-desktop <command> --help` is reachable.

## How it works

```
index.js          plugin entry: Config schema, tool registration, prompt section
lib/desktop.js    Host-side executor: binary resolution, spawn, timeout, envelope parsing
lib/tools.js      model-facing tool definitions + the system-prompt section text
cordis.patch.yml  bundle patch that inserts the host row
locale/*.json     Plugin Manager display metadata (en / zh)
icon.svg          plugin artwork
```

`index.js` declares `inject = ['tools', 'subprocess']`, resolves the executable lazily (PATH or
absolute), and registers one tool per CLI capability on the plugin context. Each call spawns
`agent-desktop` with a collect-mode stdout/stderr, applies a deadline, aborts on tool cancellation,
and parses the JSON envelope. Errors from spawning, timeouts and unparseable output are returned as
envelopes with a `plugin` version marker so the model can tell them apart from CLI errors.

The CLI inherits the Host process identity, which is why the macOS Accessibility grant for
`DeepSeek Harness.app` covers these calls.

## Security and privacy

- **Accessibility is powerful.** Granting it lets the Harness read and operate GUI apps. Grant it
  only if you intend to use computer-use.
- **Headless by default.** Ref actions use semantic accessibility calls: no cursor movement, no
  focus steal, no synthesized keys, no clipboard. Tools expose `headed: true`, which physically
  drives input; use it only with explicit user permission. A headed action may move the pointer.
- **Private data.** Snapshots, clipboard reads, screenshots and command output can contain private
  desktop content. Keep them out of public logs and uploads. The plugin does not send anything over
  the network; only the CLI runs locally.
- **Destructive actions.** `desktop_click`/`desktop_type` can submit forms, delete content or send
  messages. Prefer read-only observation first (`desktop_status`, `desktop_get`, `desktop_find`)
  and treat irreversible actions as user-confirmed decisions.

## Development

```bash
node --check index.js
node --check lib/desktop.js
node --check lib/tools.js
node test/runner.test.mjs
```

The test suite uses a `child_process` double of `ctx.subprocess`, so it runs outside the Harness.
CLI-dependent cases are skipped when `agent-desktop` is not installed.

```bash
# Optional: exercise the real CLI exactly as the plugin does
node -e "
import('./lib/desktop.js').then(async ({ createRunner }) => {
  const { spawn } = await import('node:child_process')
  const subprocess = { spawn: (spec) => { /* see test/runner.test.mjs */ } }
  const runner = createRunner(subprocess, { binaryPath: 'agent-desktop' })
  console.log(await runner.run({ command: 'status' }))
})
"
```

## Compatibility and verification notes

- Verified on macOS 26.7.1 (arm64) with DSH `0.2.1-rc.5` and `agent-desktop` `1.1.0` from the
  live Host plugin: `desktop_status`, `desktop_list_windows` (271 windows),
  `desktop_snapshot { window_id }` (89 refs), `desktop_find { window_id, role, name }`,
  `desktop_get`, `desktop_run { command: "focus" }` (semantic action, `delivered_unverified`) and
  `desktop_screenshot` all return `ok: true`.
- `desktop_find { app: "DeepSeek Harness" }` proves application-inventory targeting works from the
  plugin (it resolved the app and returned `AMBIGUOUS_TARGET` with both candidate windows, a `safe`
  retry disposition and a `--window-id` suggestion). On the same machine `desktop_list_apps`
  returned `TIMEOUT` twice: the global, unfiltered macOS application inventory did not stabilize
  within 8 s or 25 s, which is a CLI-side inventory condition surfaced faithfully as an envelope,
  not a plugin failure. Narrow inventory calls (`--app`, `--window-id`) are unaffected.
- Windows and Linux are supported by the CLI; this plugin is platform-neutral (it only spawns the
  CLI), but runtime verification is macOS-only so far.
- The plugin uses the Harness author-facing schema helpers (`defineTool`) and `schemastery`, both
  shipped with DSH; it declares them as peer dependencies and carries no bundled copy.

## License

MIT for this plugin. `agent-desktop` is a separate Apache-2.0 project by Vercel Labs; this plugin
does not embed its code, it only invokes the installed CLI. Not affiliated with Vercel Labs or
DeepSeek.

## 中文简版

`dsh-agent-desktop` 是把 Vercel Labs 的 `agent-desktop`（通过 macOS/Windows/Linux 辅助功能树做
计算机操作）接入 DeepSeek Harness 的 **Host 插件**：注册 `desktop_snapshot`、`desktop_click`、
`desktop_type`、`desktop_press`、`desktop_screenshot` 等工具，并注入一份“快照→操作→复核”的
规则说明。

**为什么不能只装 skill**：DSH 的 Bash 工具带文件沙箱，macOS 沙箱不允许执行 `ps`，而
`agent-desktop` 的应用清单（`list-apps`、`--app` 过滤、`launch`、`close-app`）依赖 `ps`，在
Bash 里会报 `ps: Operation not permitted`。插件把 CLI 放到 Harness 主进程执行，绕开该限制；
skill 仍可保留，二者互补。

**安装**：
1. `npm install -g agent-desktop`，再 `agent-desktop permissions --guide` 给
   `DeepSeek Harness.app` 授予辅助功能（截图还需屏幕录制）；
2. 在 Harness 的插件管理里用 `install_bundle` 指向本仓库绝对路径，重启后运行
   `desktop_status` 验证。

**配置**：`binaryPath`（默认 `agent-desktop`）、`stateHome`（默认 `~/.agent-desktop`）、
`timeoutMs`、`promptSection`。

**安全**：默认无头语义操作（不动鼠标、不抢焦点）；`headed: true` 才物理输入，需用户明确同意；
快照、剪贴板、截图可能含隐私内容，不要外传。
