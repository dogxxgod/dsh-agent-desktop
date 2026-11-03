# dsh-agent-desktop

[English](README.md) | 简体中文

把 [Vercel Labs 的 `agent-desktop`](https://github.com/vercel-labs/agent-desktop)（通过操作系统
辅助功能树做计算机操作的 CLI）接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
的 **Host 插件**：它把「快照 → 操作 → 复核」这套桌面自动化能力注册成原生 `desktop_*` 工具，
并把原 skill 的操作规则注入系统提示词。

`agent-desktop` 通过 OS 辅助功能树读取和操作桌面应用：每次快照返回带稳定 `@ref` 的 JSON
元素树，agent 对 ref 执行动作，再快照复核——不做像素匹配、不用坐标，循环由 agent 掌控。

- 插件版本：`1.0.0`
- 兼容性：**DSH `>= 0.2.1-rc.5`**；已在 DSH `0.2.1-rc.5` + macOS 26.7.1 (arm64) 验证
- CLI 兼容：`agent-desktop` `1.1.0`（JSON envelope `version: 2.6`）

---

## 为什么做成插件，而不是只装 skill

上游项目自带一个 agent skill（`SKILL.md`）。DSH 可以直接安装它：DSH 的文件系统 skill provider
会扫描 `~/.dsh/skills` 与 `~/.agents/skills`，解析 frontmatter 里的 `name` + `description`，
并且热加载、无需重启。作为「文档」这是正确做法。

但有一个实际缺口：**Harness 的 Bash 工具带文件沙箱**。macOS 沙箱不允许执行 `/bin/ps`，而
`agent-desktop` 的应用清单（`list-apps`、所有 `--app <名称>` 过滤、`launch`、`close-app`）依赖
`ps`，在 Bash 工具里会报：

```
TIMEOUT ... A required macOS app inventory source failed: ps: Operation not permitted (os error 1)
```

本插件把 CLI 放到 **Host 主进程**执行（不经过 Bash 沙箱），Bash 命令仍保持隔离；同时把 skill
的规则（快照→操作→复核、ref 生命周期、重试 disposition、headless/headed 策略）作为系统提示词段
注入，因此不依赖单独安装 skill。skill 与插件可以共存、互为补充。

## 系统要求

1. **DeepSeek Harness `>= 0.2.1-rc.5`**，且当前 profile 暴露 `ctx.tools` 与 `ctx.subprocess`。
2. **Node.js `^22.19.0 || >=24.0.0`**。Harness 自带运行 Node，但 `npm install -g` 需要系统里
   有 Node/npm。
3. **`agent-desktop` CLI** 已安装并可用。
4. **macOS 权限**：辅助功能（Accessibility）必需；截图还需屏幕录制（Screen Recording）。
   Windows 在同一完整性级别下无需授权。

## 安装

插件是本地 bundle：无构建步骤、无安装脚本、无运行时依赖。安装分两部分——系统级的
`agent-desktop` CLI，以及注册到某个 Harness profile 的本插件。**注册步骤两个系统相同**，
只是终端命令与权限步骤不同。

### 注册 bundle（macOS / Windows 通用）

推荐通过 Harness 的插件管理器注册。它会把包 link 进当前 profile，并写入 bundle 行：

1. 下载并解压发布包。

   macOS：
   ```bash
   curl -L -o dsh-agent-desktop-1.0.0.zip \
     https://codeload.github.com/dogxxgod/dsh-agent-desktop/zip/refs/tags/v1.0.0
   unzip -q dsh-agent-desktop-1.0.0.zip -d ~/work
   ```
   也可以在浏览器打开该 URL，双击下载好的 ZIP 解压。

   Windows（PowerShell）：
   ```powershell
   Invoke-WebRequest -Uri "https://codeload.github.com/dogxxgod/dsh-agent-desktop/zip/refs/tags/v1.0.0" `
     -OutFile "$env:USERPROFILE\Downloads\dsh-agent-desktop-1.0.0.zip"
   Expand-Archive "$env:USERPROFILE\Downloads\dsh-agent-desktop-1.0.0.zip" `
     -DestinationPath "$env:USERPROFILE\work"
   ```
   也可以在浏览器打开该 URL，用资源管理器解压。

   解压后得到 `~/work/dsh-agent-desktop-1.0.0` 之类的目录，其中包含 `package.json`。

2. 打开 Harness 的**插件（Plugins）**页面，使用「安装 Bundle / 从本地目录安装」（不同版本
   按钮文案略有差异），选择解压出的 `dsh-agent-desktop-1.0.0` 目录。或者直接对 agent 说：

   > 用 plugin_manager 把 `/绝对路径/dsh-agent-desktop-1.0.0` 安装为 bundle

   管理器会把 `dsh-agent-desktop` 写入 profile 的 `dsh.profile.bundles`，并激活
   `agent-desktop` 这一行。

3. 如果结果提示 `restart-required`，重启 Harness；然后运行 `desktop_status`，工具列表里应出现
   `desktop_*`。

### macOS（直接安装）

1. **Node.js 22+**：`brew install node`，或从 <https://nodejs.org> 下载安装（Harness 自带的
   Node 仅供自身使用，`npm -g` 需要系统 Node）。
2. **安装 CLI**：
   ```bash
   npm install -g agent-desktop
   agent-desktop version        # {"version":"2.6","ok":true,...}
   ```
   Bun / Yarn / pnpm 安装的是同一个包。使用 nvm/fnm/volta 时，可执行文件位于当前 Node 版本的
   bin 目录，切换到该版本后 `agent-desktop` 才在 `PATH` 中。
3. **授予 macOS 权限**（授予「启动 CLI 的应用」，也就是 Harness 本身）：
   ```bash
   agent-desktop permissions --guide
   ```
   在**系统设置 → 隐私与安全性 → 辅助功能**中，添加
   `/Applications/DeepSeek Harness.app`（或 `~/Applications/…`）并打开开关；如需截图，在同一
   页面把该应用也加入**屏幕录制**。若 macOS 单独列出了 CLI 二进制，也一并添加。
4. **注册 bundle**（见上一节）。
5. **验证**（重启后）：
   ```bash
   agent-desktop status          # accessibility / screen_recording: granted
   ```
   再让 agent 调用 `desktop_status`，两者都应返回 `ok: true`。

### Windows（直接安装）

1. **Node.js LTS**：从 <https://nodejs.org> 安装，或执行
   `winget install OpenJS.NodeJS.LTS`，然后**新开**一个 PowerShell 窗口。
2. **安装 CLI**：
   ```powershell
   npm install -g agent-desktop
   agent-desktop version        # {"version":"2.6","ok":true,...}
   ```
   npm 全局目录（`%APPDATA%\npm`）默认在 `PATH` 中。若仍找不到 `agent-desktop`，请重开终端，或把
   插件配置里的 `binaryPath` 指向 `.exe` 的绝对路径。
3. **权限**：Windows 在同一完整性级别下无需授权；如需自动化提权窗口，请以相同完整性级别启动
   Harness。
4. **注册 bundle**（见上一节），然后重启。
5. **验证**：
   ```powershell
   agent-desktop status
   ```
   再让 agent 调用 `desktop_status`。

### 可选配置

想调整参数而不改本仓库时，在 profile 的 `cordis.patch.yml` 中覆盖该行（后层会整体替换
`config`）：

```yaml
- id: agent-desktop
  config:
    binaryPath: /Users/you/.local/bin/agent-desktop
    stateHome: /Users/you/.agent-desktop
    timeoutMs: 90000
    promptSection: true
```

### 升级

下载新版本 tag 的 ZIP（把 URL 里的 `v1.0.0` 换成新版本，如 `.../zip/refs/tags/v1.1.0`），解压覆盖
同一目录；也可以解压到新目录后重新注册该目录。bundle 以 link 方式安装，更新文件后**重启
Harness** 即生效，无需重装。

### 卸载

在 Harness 插件页面移除该 bundle（或调用 `plugin_manager remove_bundle`）并重启。可选清理 CLI
与状态目录：

```bash
npm uninstall -g agent-desktop
rm -rf ~/.agent-desktop ~/work/dsh-agent-desktop-1.0.0
```
```powershell
npm uninstall -g agent-desktop
Remove-Item -Recurse -Force "$env:USERPROFILE\.agent-desktop", "$env:USERPROFILE\work\dsh-agent-desktop-1.0.0"
```

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `binaryPath` | `agent-desktop` | 通过 `PATH` 解析的可执行文件名，或绝对路径。绝对路径会校验可执行性。 |
| `stateHome` | `""`（CLI 默认 `~/.agent-desktop`） | 设置 `AGENT_DESKTOP_HOME`：快照 refmap、会话、trace 存放位置；必须是绝对路径且仅属主可访问。 |
| `timeoutMs` | `60000` | 每条 CLI 命令的默认超时；单次调用可用 `timeout_ms` 覆盖。 |
| `promptSection` | `true` | 是否把桌面操作规则注入 agent 系统提示词。 |

CLI 还会写入插件之外的位置：截图写到调用时传入的路径，`--trace` 写到传入的路径，会话写在
state root 下。

## 工具

| 工具 | 对应 CLI | 用途 |
|---|---|---|
| `desktop_status` | `status` | 平台、权限状态、CLI 版本、state root、可用 surface。建议首先调用。 |
| `desktop_list_windows` | `list-windows` | 可见窗口及 `w-…` id、应用、标题、bounds、focused/visible。 |
| `desktop_list_apps` | `list-apps` | 运行中的 GUI 应用（名称、bundle id、pid）。 |
| `desktop_snapshot` | `snapshot` | 辅助功能树与 `@ref` id；默认前台应用。 |
| `desktop_find` | `find` | 按 role/name/text/value/description/native id 查找元素。 |
| `desktop_get` | `get` | 读取某个 ref 的属性（text、value、title、bounds、role、states）。 |
| `desktop_click` | `click` / `double-click` / `triple-click` / `right-click` | 对 ref 执行点击。 |
| `desktop_type` | `type` | 向 ref 输入文本（可选逐字符按键）。 |
| `desktop_press` | `press` | 发送按键组合，如 `return`、`escape`、`cmd+s`。 |
| `desktop_scroll` | `scroll` | 按方向/数量滚动 ref。 |
| `desktop_screenshot` | `screenshot` | 保存窗口/显示器 PNG。 |
| `desktop_run` | 任意子命令 | 逃生口，覆盖其余能力（`launch`、`clipboard-get`、`wait`、`session`、`batch`、通知、窗口管理等）。 |

每个工具返回 CLI 的单条 JSON envelope（`ok` 加 `data` 或 `error`）。命令失败**不会**被转成工具
异常：模型按 `error.code` 与 `error.disposition` 分支处理，与上游 skill 的教导一致。只有当
`error.disposition.retry` 为 `safe`（delivery 为 `not_delivered`）时才重试；已投递但未验证的
动作可能已经生效，重复前应先读取实时状态。

### 快速循环

```text
desktop_list_windows { app: "Finder" }
desktop_snapshot     { window_id: "w-204749", interactive_only: true, compact: true }
desktop_click        { ref: "@s8f3k2p9:e12" }
desktop_snapshot     { window_id: "w-204749", interactive_only: true, compact: true }   # 复核
```

对结构复杂的应用：先 `desktop_snapshot { skeleton: true }` 取浅层地图，再用
`desktop_snapshot { root: "@s8f3k2p9:e3" }` 钻取一个区域，最后加 `interactive_only: true`。

菜单、sheet、alert 属于 surface：`desktop_snapshot { surface: "menu" }`。

### 逃生口

```text
desktop_run { command: "clipboard-get" }
desktop_run { command: "launch", args: ["--app", "Safari"] }
desktop_run { command: "resize-window", args: ["w-204749", "--width", "1200", "--height", "800"] }
desktop_run { command: "session", args: ["start", "--name", "run_1"] }
desktop_run { command: "batch", args: ["--help"] }
```

`desktop_run` 原样透传参数、原样返回 envelope，因此 `agent-desktop <命令> --help` 里记录的
能力都能覆盖到。

## 工作原理

```
index.js          插件入口：Config schema、工具注册、系统提示词段
lib/desktop.js    Host 侧执行器：可执行文件解析、spawn、超时、envelope 解析
lib/tools.js      模型侧工具定义 + 系统提示词文本
cordis.patch.yml  bundle patch，插入 host 行
locale/*.json     插件管理器展示元数据（en / zh）
icon.svg          插件图标
```

`index.js` 声明 `inject = ['tools', 'subprocess']`，延迟解析可执行文件（`PATH` 或绝对路径），在
插件 context 上注册每个 CLI 能力的工具。每次调用以 collect 模式 spawn `agent-desktop`、施加超时、
在工具取消时中止，并解析 JSON envelope。spawn 失败、超时、无法解析的输出都会以带 `plugin` 版本
标记的 envelope 返回，便于模型区分插件错误与 CLI 错误。

CLI 继承 Host 进程身份，因此 macOS 上授予 `DeepSeek Harness.app` 的辅助功能权限即可覆盖这些
调用。

## 安全与隐私

- **辅助功能权限很强**：授予后 Harness 可以读取并操作 GUI 应用。只在确实需要计算机操作时授予。
- **默认无头（headless）**：ref 操作走语义辅助功能调用——不动鼠标、不抢焦点、不合成按键、不用
  剪贴板。工具暴露 `headed: true` 用于物理输入，仅在用户明确同意时使用；headed 动作可能移动
  指针。
- **隐私数据**：快照、剪贴板、截图、命令输出可能包含私密桌面内容，不要放进公开日志或上传。
  插件本身不联网，只有 CLI 在本地运行。
- **破坏性动作**：`desktop_click`/`desktop_type` 可能提交表单、删除内容或发送消息。先做只读观察
  （`desktop_status`、`desktop_get`、`desktop_find`），把不可逆动作当作需要用户确认的决策。

## 开发

```bash
node --check index.js
node --check lib/desktop.js
node --check lib/tools.js
node test/runner.test.mjs
```

测试用 `child_process` 替身模拟 `ctx.subprocess`，无需 Harness 运行时即可执行；未安装
`agent-desktop` 时，依赖 CLI 的用例会跳过。

## 兼容性与验证

- 在 macOS 26.7.1 (arm64) + DSH `0.2.1-rc.5` + `agent-desktop` `1.1.0` 的**运行中 Host 插件**上
  实测通过：`desktop_status`、`desktop_list_windows`（271 个窗口）、
  `desktop_snapshot { window_id }`（89 个 ref）、`desktop_find { window_id, role, name }`、
  `desktop_get`、`desktop_run { command: "focus" }`（语义动作，`delivered_unverified`）、
  `desktop_screenshot` 均返回 `ok: true`。
- `desktop_find { app: "DeepSeek Harness" }` 证明应用清单定向在插件侧可用：它解析到应用并返回
  `AMBIGUOUS_TARGET`，附带两个候选窗口、`safe` 重试 disposition 和 `--window-id` 建议。
  同一台机器上 `desktop_list_apps`（不带过滤的全局应用清单）两次返回 `TIMEOUT`：8s 与 25s 内
  macOS 全局应用清单未稳定，这属于 CLI 侧的清单状态，被如实包装成 envelope，不是插件故障；
  按 `--app`、`--window-id` 收窄的调用不受影响。
- 插件的 Windows/Linux 支持来自 CLI 本身（插件只负责 spawn），但目前的运行验证仅限 macOS。

## 许可证

本插件使用 MIT 许可证。`agent-desktop` 是 Vercel Labs 的独立项目（Apache-2.0）；本插件不内嵌
其代码，只调用已安装的 CLI。与 Vercel Labs、DeepSeek 均无隶属关系。
