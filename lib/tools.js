/**
 * Model-facing tools for the agent-desktop CLI.
 *
 * Every definition is a plain `defineTool` option object: `parameters` is the
 * author-facing property map, `output.schema` is `{ type: 'json' }`, and
 * `execute` forwards to the Host-side runner. Keeping this module free of
 * Harness imports lets the test suite exercise it with Node alone.
 */

/** Shared output projection: the raw JSON envelope as pretty text. */
const output = {
  schema: { type: 'json' },
  render(_args, value) {
    return [{ type: 'text', text: describe(value) }]
  },
}

/** @param {unknown} value */
function describe(value) {
  try {
    if (typeof value === 'string') return value
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Push `flag value` when a value is present. */
function option(args, flag, value) {
  if (value === undefined || value === null || value === '') return
  args.push(flag, String(value))
}

/** Push a bare flag when it is exactly true. */
function toggle(args, flag, enabled) {
  if (enabled === true) args.push(flag)
}

/** Push a non-negative integer, preserving zero (e.g. display index 0). */
function nonNegativeInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

/**
 * @param {ReturnType<import('./desktop.js').createRunner>} runner
 * @param {unknown} args
 * @param {{ signal?: AbortSignal } | undefined} exec
 */
function invoke(runner, command, args, argsObject, exec) {
  return runner.run({
    command,
    args,
    timeoutMs: argsObject?.timeout_ms,
    signal: exec?.signal,
  })
}

/**
 * Build the tool definitions for one configured runner.
 *
 * @param {ReturnType<import('./desktop.js').createRunner>} runner
 * @param {{ timeoutMs?: number }} [config]
 */
export function createToolDefinitions(runner, config = {}) {
  /** @type {(value: unknown) => number | undefined} */
  const timeout = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined

  return [
    {
      name: 'desktop_status',
      description:
        'Report agent-desktop CLI health: platform, macOS Accessibility and Screen Recording state, CLI version, state root and supported surfaces. Call it once before the first desktop action and whenever an action returns PERM_DENIED or CLI_NOT_FOUND.',
      parameters: {},
      output,
      timeoutMs: 30_000,
      execute(_args, exec) {
        return invoke(runner, 'status', [], {}, exec)
      },
    },
    {
      name: 'desktop_list_windows',
      description:
        'List visible desktop windows as JSON: window id (w-…), app name, title, bounds, visible/focused and whether accessibility can read it. Pass the returned id to desktop_snapshot (window_id) to pin one exact window.',
      parameters: {
        app: {
          type: 'string',
          description: 'Filter by exact application name (case-insensitive), e.g. "Finder".',
        },
        timeout_ms: { type: 'number', description: 'Inventory deadline in milliseconds (default 60000, CLI default 5000).' },
      },
      output,
      timeoutMs: 90_000,
      execute(args, exec) {
        const argv = ['list-windows']
        option(argv, '--app', args?.app)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, 'list-windows', argv.slice(1), args, exec)
      },
    },
    {
      name: 'desktop_list_apps',
      description:
        'List running GUI applications (name, bundle id, pid). Use it to choose an exact app name for desktop_snapshot (app) or a desktop_run launch/close-app command.',
      parameters: {
        app: { type: 'string', description: 'Filter by application name.' },
        timeout_ms: { type: 'number', description: 'Inventory deadline in milliseconds (default 60000, CLI default 5000).' },
      },
      output,
      timeoutMs: 90_000,
      execute(args, exec) {
        const argv = ['list-apps']
        option(argv, '--app', args?.app)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, 'list-apps', argv.slice(1), args, exec)
      },
    },
    {
      name: 'desktop_snapshot',
      description:
        'Capture an app\'s native accessibility tree with @ref ids for every actionable element. Defaults to the focused app (--surface focused). Target a specific app name or window_id; for dense apps take skeleton=true first, then root=<ref> to drill one region. interactive_only=true keeps only actionable nodes. Refs belong to one snapshot — snapshot again after any UI change.',
      parameters: {
        app: {
          type: 'string',
          description: 'Application name to target (exact, case-insensitive). Omit together with window_id/surface to use the focused app.',
        },
        window_id: {
          type: 'string',
          description: 'Window id from desktop_list_windows (w-…). Pins one exact window and avoids app-name ambiguity.',
        },
        surface: {
          type: 'string',
          description:
            'Surface to snapshot instead of a window: window, focused, menu, menubar, sheet, popover, alert, dock, menu-bar-extras.',
        },
        root: {
          type: 'string',
          description: 'Ref from this snapshot to start traversal from (drill-down into one region).',
        },
        interactive_only: { type: 'boolean', description: 'Only actionable elements (CLI -i); smaller tree.' },
        compact: { type: 'boolean', description: 'Collapse single-child unnamed nodes (CLI --compact).' },
        skeleton: { type: 'boolean', description: 'Shallow map with children_count on cut branches (CLI --skeleton).' },
        max_depth: { type: 'number', description: 'Maximum traversal depth (CLI --max-depth, default 10).' },
        include_bounds: { type: 'boolean', description: 'Include element bounds (x, y, width, height).' },
        timeout_ms: { type: 'number', description: 'Observation deadline in milliseconds (default 60000, CLI default 3000).' },
      },
      output,
      timeoutMs: 120_000,
      execute(args, exec) {
        const argv = ['snapshot']
        if (!args?.app && !args?.window_id && !args?.surface) argv.push('--surface', 'focused')
        option(argv, '--app', args?.app)
        option(argv, '--window-id', args?.window_id)
        option(argv, '--surface', args?.surface)
        option(argv, '--root', args?.root)
        toggle(argv, '-i', args?.interactive_only)
        toggle(argv, '--compact', args?.compact)
        toggle(argv, '--skeleton', args?.skeleton)
        option(argv, '--max-depth', timeout(args?.max_depth))
        toggle(argv, '--include-bounds', args?.include_bounds)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, 'snapshot', argv.slice(1), args, exec)
      },
    },
    {
      name: 'desktop_find',
      description:
        'Search the focused app (or a given app/window) for elements by role, name, text, value, description or native id, returning matches with refs. Cheaper than a full snapshot when you know the role or label, e.g. role="button", name="新建会话".',
      parameters: {
        app: { type: 'string', description: 'Application name to target. Omit for the focused app.' },
        window_id: { type: 'string', description: 'Window id from desktop_list_windows.' },
        role: { type: 'string', description: 'Accessibility role: button, textfield, checkbox, menuitem, window …' },
        name: { type: 'string', description: 'Accessible name or label.' },
        text: { type: 'string', description: 'Text in name, value, title or description.' },
        value: { type: 'string', description: 'Current element value.' },
        description: { type: 'string', description: 'Accessible description.' },
        native_id: { type: 'string', description: 'Native automation id (AXIdentifier).' },
        exact: { type: 'boolean', description: 'Require exact (case-insensitive) name/description/value matches.' },
        timeout_ms: { type: 'number', description: 'Observation deadline in milliseconds.' },
      },
      output,
      timeoutMs: 90_000,
      execute(args, exec) {
        const argv = ['find']
        option(argv, '--app', args?.app)
        option(argv, '--window-id', args?.window_id)
        option(argv, '--role', args?.role)
        option(argv, '--name', args?.name)
        option(argv, '--text', args?.text)
        option(argv, '--value', args?.value)
        option(argv, '--description', args?.description)
        option(argv, '--native-id', args?.native_id)
        toggle(argv, '--exact', args?.exact)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, 'find', argv.slice(1), args, exec)
      },
    },
    {
      name: 'desktop_get',
      description:
        'Read one property of an element ref from the latest snapshot: text (default), value, title, bounds, role or states. Read-only confirmation, cheaper than a new snapshot when the UI has not changed.',
      parameters: {
        ref: { type: 'string', required: true, description: 'Qualified ref, e.g. "@s8f3k2p9:e12".' },
        property: {
          type: 'string',
          enum: ['text', 'value', 'title', 'bounds', 'role', 'states'],
          description: 'Property to read (default text).',
        },
        timeout_ms: { type: 'number', description: 'Resolution deadline in milliseconds.' },
      },
      output,
      timeoutMs: 30_000,
      execute(args, exec) {
        const argv = ['get', String(args?.ref ?? '')]
        option(argv, '--property', args?.property)
        return invoke(runner, 'get', argv.slice(1), args, exec)
      },
    },
    {
      name: 'desktop_click',
      description:
        'Click a ref from the latest snapshot. kind: click (default), double-click, triple-click or right-click. Headless semantic delivery by default — no cursor move and no focus steal; it fails closed when no semantic path exists. Check data.disposition.retry: retry only when it is "safe" (delivery "not_delivered"), otherwise inspect live state first.',
      parameters: {
        ref: { type: 'string', required: true, description: 'Qualified ref from the current snapshot.' },
        kind: {
          type: 'string',
          enum: ['click', 'double-click', 'triple-click', 'right-click'],
          description: 'Click variant (default click).',
        },
        headed: {
          type: 'boolean',
          description: 'Physical input that may move the cursor/take focus. Only when the user explicitly allows it.',
        },
        timeout_ms: { type: 'number', description: 'Ref resolution and actionability deadline in milliseconds (default 5000).' },
      },
      output,
      timeoutMs: 60_000,
      execute(args, exec) {
        const command = args?.kind ?? 'click'
        const argv = [String(args?.ref ?? '')]
        toggle(argv, '--headed', args?.headed)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, command, argv, args, exec)
      },
    },
    {
      name: 'desktop_type',
      description:
        'Insert text into a ref from the latest snapshot (semantic insertion, no focus steal). interval_ms > 0 sends real keystrokes one by one when a target needs key events. Treat typed text as sensitive when it contains credentials.',
      parameters: {
        ref: { type: 'string', required: true, description: 'Qualified ref of the text field or editable area.' },
        text: { type: 'string', required: true, description: 'Text to insert.' },
        interval_ms: { type: 'number', description: 'Type one keystroke every N ms (1-2000) instead of inserting at once.' },
        headed: { type: 'boolean', description: 'Physical input; only when the user explicitly allows it.' },
        timeout_ms: { type: 'number', description: 'Delivery deadline in milliseconds.' },
      },
      output,
      timeoutMs: 120_000,
      execute(args, exec) {
        const argv = [String(args?.ref ?? ''), String(args?.text ?? '')]
        option(argv, '--interval-ms', timeout(args?.interval_ms))
        toggle(argv, '--headed', args?.headed)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, 'type', argv, args, exec)
      },
    },
    {
      name: 'desktop_press',
      description:
        'Send a key combo such as "return", "escape", "cmd+s" or "shift+tab" to an app without focusing it. Dangerous shortcuts are refused unless force=true. Prefer refs over coordinates.',
      parameters: {
        combo: { type: 'string', required: true, description: 'Key combo, e.g. "return", "escape", "cmd+c", "shift+tab".' },
        app: { type: 'string', description: 'Target application name; keys go to its process without focusing it.' },
        window_id: { type: 'string', description: 'Target the app instance owning this window id.' },
        force: { type: 'boolean', description: 'Send the combo even if the adapter flags it as dangerous.' },
        headed: { type: 'boolean', description: 'Physical input; only when the user explicitly allows it.' },
        timeout_ms: { type: 'number', description: 'Delivery deadline in milliseconds.' },
      },
      output,
      timeoutMs: 60_000,
      execute(args, exec) {
        const argv = [String(args?.combo ?? '')]
        option(argv, '--app', args?.app)
        option(argv, '--window-id', args?.window_id)
        toggle(argv, '--force', args?.force)
        toggle(argv, '--headed', args?.headed)
        return invoke(runner, 'press', argv, args, exec)
      },
    },
    {
      name: 'desktop_scroll',
      description:
        'Scroll a ref by direction (up/down/left/right) and amount (default 3 units). Pick the scroll container ref from the latest snapshot; verify with a new snapshot when content is expected to appear.',
      parameters: {
        ref: { type: 'string', required: true, description: 'Qualified ref of the scrollable element.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (default down).' },
        amount: { type: 'number', description: 'Scroll units (default 3).' },
        headed: { type: 'boolean', description: 'Physical input; only when the user explicitly allows it.' },
        timeout_ms: { type: 'number', description: 'Delivery deadline in milliseconds.' },
      },
      output,
      timeoutMs: 60_000,
      execute(args, exec) {
        const argv = [String(args?.ref ?? '')]
        option(argv, '--direction', args?.direction)
        option(argv, '--amount', timeout(args?.amount))
        toggle(argv, '--headed', args?.headed)
        option(argv, '--timeout-ms', timeout(args?.timeout_ms))
        return invoke(runner, 'scroll', argv, args, exec)
      },
    },
    {
      name: 'desktop_screenshot',
      description:
        'Save a PNG screenshot of one window or display to an absolute path. Screenshots contain private desktop content — keep them local and out of uploads or logs. Requires macOS Screen Recording permission.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute output path for the PNG.' },
        app: { type: 'string', description: 'Application to capture (window by app name).' },
        window_id: { type: 'string', description: 'Capture one exact window id from desktop_list_windows.' },
        screen: { type: 'number', description: 'Capture a display by index (0 = primary, from list-displays).' },
        timeout_ms: { type: 'number', description: 'Capture deadline in milliseconds.' },
      },
      output,
      timeoutMs: 60_000,
      execute(args, exec) {
        const argv = [String(args?.path ?? '')]
        option(argv, '--app', args?.app)
        option(argv, '--window-id', args?.window_id)
        option(argv, '--screen', nonNegativeInt(args?.screen))
        return invoke(runner, 'screenshot', argv, args, exec)
      },
    },
    {
      name: 'desktop_run',
      description:
        'Escape hatch for any agent-desktop command not covered by the typed tools: launch, close-app, focus-window, resize-window, minimize/maximize/restore, clipboard-get/set/clear, wait, session, batch, trace, notifications, dock/menu surfaces. Args are passed verbatim and the JSON envelope is returned unchanged. Discover flags with command="<name>", args=["--help"].',
      parameters: {
        command: {
          type: 'string',
          required: true,
          description: 'agent-desktop subcommand, e.g. "launch", "clipboard-get", "list-displays", "wait".',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional CLI arguments in order, e.g. ["--app","Safari","-i","--compact"].',
        },
        headed: { type: 'boolean', description: 'Append --headed (physical input; user permission required).' },
        timeout_ms: { type: 'number', description: 'Command deadline in milliseconds.' },
      },
      output,
      timeoutMs: 180_000,
      execute(args, exec) {
        const argv = Array.isArray(args?.args) ? args.args.map((entry) => String(entry)) : []
        toggle(argv, '--headed', args?.headed)
        return invoke(runner, String(args?.command ?? ''), argv, args, exec)
      },
    },
  ]
}

/** System-prompt section that carries the skill's operating rules to the model. */
export const PROMPT_SECTION = `## Desktop control (agent-desktop)

The desktop_* tools drive desktop applications through the native accessibility tree using the
agent-desktop CLI. They run in the Harness Host process, not in the sandboxed Bash tool, so the
application inventory, app-name targeting and [launch] work. Use them for native apps, menus and
system dialogs; use the browser tools for web pages.

Loop: desktop_list_windows → desktop_snapshot (window_id or app) → act on a @ref → desktop_snapshot
again to verify. Prefer desktop_find when you know the role or label. For dense apps take
skeleton=true first, then root=<ref> to drill into one region, then interactive_only=true.

Refs: "@<snapshot>:eN" is valid for that snapshot only. After any UI change take a new snapshot.
STALE_REF / AMBIGUOUS_TARGET mean the element moved or is not unique — re-snapshot, never reuse the
ref. Branch on error.code, and retry only when error.disposition.retry is "safe" (delivery
"not_delivered"); a delivered-but-unverified action may have landed, so read the live state first.

Safety: actions are headless by default (no cursor movement, no focus steal, no synthesized keys)
and fail closed when no semantic path exists. Pass headed:true only when the user explicitly allows
physical input. Snapshots, clipboard reads and screenshots can contain private desktop content —
never upload, log or quote them unnecessarily. Run desktop_status first after install; PERM_DENIED
means macOS Accessibility or Screen Recording was not granted to the Harness app.
`
