# dsh-agent-desktop

English | [简体中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Host plugin that turns
[`agent-desktop`](https://github.com/vercel-labs/agent-desktop) — Vercel Labs' computer-use CLI —
into native `desktop_*` tools for the Harness agent.

`agent-desktop` reads and operates desktop applications through the OS accessibility tree: it
returns a JSON snapshot with a stable `@ref` for every element an agent can act on, the agent acts
on a ref, and snapshots again to verify. No pixel matching, no coordinates, the loop stays in the
agent. This plugin gives that loop to DSH as first-class tools.

- Plugin release: `1.0.0`
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

The plugin is a local bundle: no build step, no install scripts, no runtime dependencies. There
are two parts to install — the `agent-desktop` CLI (system-wide) and this bundle (into one Harness
profile). The registration step is identical on both OSes; only the terminal and the permission
step differ.

### Register the bundle (both OSes)

The supported route is the Harness Plugin Manager, which links the package into the active profile
and adds its bundle row:

1. Download and extract the release archive:
   - macOS:
     ```bash
     curl -L -o dsh-agent-desktop-1.0.0.zip \
       https://codeload.github.com/dogxxgod/dsh-agent-desktop/zip/refs/tags/v1.0.0
     unzip -q dsh-agent-desktop-1.0.0.zip -d ~/work
     ```
     Or open that URL in a browser and double-click the downloaded ZIP.
   - Windows (PowerShell):
     ```powershell
     Invoke-WebRequest -Uri "https://codeload.github.com/dogxxgod/dsh-agent-desktop/zip/refs/tags/v1.0.0" `
       -OutFile "$env:USERPROFILE\Downloads\dsh-agent-desktop-1.0.0.zip"
     Expand-Archive "$env:USERPROFILE\Downloads\dsh-agent-desktop-1.0.0.zip" `
       -DestinationPath "$env:USERPROFILE\work"
     ```
     Or follow the URL in a browser and extract the ZIP with Explorer.

   Either way you get a folder such as `~/work/dsh-agent-desktop-1.0.0` containing `package.json`.
2. In the Harness, open the **Plugins** page and use its install-bundle action (the label varies by
   version: *Install bundle* / *Install from folder*), then choose the extracted
   `dsh-agent-desktop-1.0.0` folder. Or simply ask the agent, which calls the same Host
   capability:
   > 用 plugin_manager 把 `/absolute/path/to/dsh-agent-desktop-1.0.0` 安装为 bundle
   The manager writes `dsh-agent-desktop` into the profile's `dsh.profile.bundles` and activates
   the `agent-desktop` host row.
3. Restart the Harness if the result says `restart-required`, then run `desktop_status`. The tool
   list must contain `desktop_*`.

### macOS (direct install)

1. **Node.js 22+** — the Harness bundles Node for itself, but a global npm install needs your own:
   `brew install node`, or the installer from <https://nodejs.org>.
2. **Install the CLI**:
   ```bash
   npm install -g agent-desktop
   agent-desktop version        # {"version":"2.6","ok":true,...}
   ```
   Bun, Yarn and pnpm ship the same package. With nvm/fnm/volta the binary lives in the active
   Node version's bin directory; `agent-desktop` resolves while that version is active.
3. **Grant macOS permissions** to the app that launches the CLI — the Harness itself:
   ```bash
   agent-desktop permissions --guide
   ```
   In **System Settings → Privacy & Security → Accessibility**, add
   `/Applications/DeepSeek Harness.app` (or `~/Applications/…`) and switch it on. Add the same app
   under **Screen Recording** if you want screenshots. If macOS lists the built binary separately,
   add that path too.
4. **Register the bundle** (section above).
5. **Verify** after the restart:
   ```bash
   agent-desktop status          # accessibility / screen_recording: granted
   ```
   and ask the agent to call `desktop_status`; both must report `ok: true`.

### Windows (direct install)

1. **Node.js LTS** — install from <https://nodejs.org> or
   `winget install OpenJS.NodeJS.LTS`, then open a **new** PowerShell window.
2. **Install the CLI**:
   ```powershell
   npm install -g agent-desktop
   agent-desktop version        # {"version":"2.6","ok":true,...}
   ```
   The npm global prefix (`%APPDATA%\npm`) is on `PATH` by default. If `agent-desktop` is still not
   found, open a new terminal, or point the plugin's `binaryPath` at the absolute `.exe` path.
3. **Permissions** — Windows needs no grant for apps at the terminal's integrity level. If you
   automate elevated windows, start the Harness at that same integrity level.
4. **Register the bundle** (section above) and restart.
5. **Verify**:
   ```powershell
   agent-desktop status
   ```
   and ask the agent to call `desktop_status`.

### Configure (optional)

To tune the plugin without editing this package, override its row in the profile's
`cordis.patch.yml` (later layers replace the whole `config`):

```yaml
- id: agent-desktop
  config:
    binaryPath: /Users/you/.local/bin/agent-desktop
    stateHome: /Users/you/.agent-desktop
    timeoutMs: 90000
    promptSection: true
```

### Update

Download the archive of the newer tag (replace `v1.0.0` in the URL, e.g.
`.../zip/refs/tags/v1.1.0`) and extract it over the same directory, or into a new directory and
register that folder instead. The bundle is installed as a link, so the new files take effect after
a Harness restart; no reinstall is needed.

### Uninstall

Remove the bundle in the Harness Plugins page (or via `plugin_manager remove_bundle`) and restart.
Optionally remove the CLI and its state:

```bash
npm uninstall -g agent-desktop
rm -rf ~/.agent-desktop ~/work/dsh-agent-desktop-1.0.0
```
```powershell
npm uninstall -g agent-desktop
Remove-Item -Recurse -Force "$env:USERPROFILE\.agent-desktop", "$env:USERPROFILE\work\dsh-agent-desktop-1.0.0"
```

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

## 中文说明

完整中文文档见 [README.zh.md](README.zh.md)。
