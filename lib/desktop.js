/**
 * Host-side executor for the agent-desktop CLI.
 *
 * The plugin runs inside the DeepSeek Harness Host process, not through the
 * sandboxed Bash tool, so the CLI keeps its full process visibility: the
 * application inventory (`list-apps`, every `--app` filter, `launch`) and the
 * default state root (~/.agent-desktop) both work.
 *
 * This module only uses Node built-ins, which keeps it unit-testable outside
 * the Harness (see test/runner.test.mjs).
 */
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 10 * 60_000
const MAX_STDOUT_BYTES = 16 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024
const SPAWN_GRACE_MS = 3_000

/** @param {unknown} value */
function message(value) {
  if (value instanceof Error) return value.message
  return String(value)
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
  const number = typeof value === 'string' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) return fallback
  return Math.min(Math.round(number), MAX_TIMEOUT_MS)
}

/** Candidate absolute paths for a bare executable name. */
function pathCandidates(name) {
  const directories = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((entry) => entry !== '')
  const userDirectories = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  return [...new Set([...directories, ...userDirectories])].map((directory) => join(directory, name))
}

/**
 * @param {{ stdout?: { text: string } | undefined }} collected
 * @returns {{ text: string, lossy: boolean, spillPath?: string }}
 */
function readCollected(reader) {
  if (!reader || typeof reader.readFrom !== 'function') return { text: '', lossy: false }
  try {
    const read = reader.readFrom(0)
    return {
      text: typeof read?.text === 'string' ? read.text : '',
      lossy: read?.lossy === true,
      ...(typeof read?.spillPath === 'string' ? { spillPath: read.spillPath } : {}),
    }
  } catch {
    return { text: '', lossy: false }
  }
}

/** Parse the single JSON envelope printed by every agent-desktop command. */
export function parseEnvelope(stdout) {
  const text = stdout.trim()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    // Fall back to the last JSON-looking line: the CLI may print diagnostics
    // on stdout instead of stderr in rare failure paths.
  }
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {
      // keep scanning
    }
  }
  return undefined
}

/**
 * @param {string} code
 * @param {string} text
 * @param {string} [suggestion]
 * @param {string} [command]
 */
function failure(code, text, suggestion, command) {
  return {
    version: 'plugin',
    ok: false,
    ...(command ? { command } : {}),
    error: {
      code,
      message: text,
      ...(suggestion ? { suggestion } : {}),
    },
  }
}

/**
 * Create the CLI runner used by every desktop_* tool.
 *
 * @param {{
 *   resolveExecutable?: (command: string, env?: Record<string, string>) => Promise<string>,
 *   spawn: (spec: unknown) => {
 *     collected?: { stdout?: { readFrom(from: number): { text: string, lossy: boolean, spillPath?: string } }, stderr?: { readFrom(from: number): { text: string, lossy: boolean, spillPath?: string } } },
 *     done: Promise<{ exitCode: number | null, signal: string | null }>,
 *     terminate(): void,
 *   },
 * } | undefined} subprocess - the Harness `ctx.subprocess` service (or a test double)
 * @param {{ binaryPath?: string, stateHome?: string, timeoutMs?: number }} [config]
 */
export function createRunner(subprocess, config = {}) {
  const binaryPath =
    typeof config.binaryPath === 'string' && config.binaryPath.trim() !== ''
      ? config.binaryPath.trim()
      : 'agent-desktop'
  const stateHome = typeof config.stateHome === 'string' ? config.stateHome.trim() : ''
  const defaultTimeoutMs = positiveInt(config.timeoutMs, DEFAULT_TIMEOUT_MS)
  /** @type {string | undefined} */
  let resolvedBinary

  async function resolveBinary() {
    if (resolvedBinary !== undefined) return resolvedBinary
    if (binaryPath.includes('/') || binaryPath.includes('\\')) {
      await access(binaryPath, constants.X_OK)
      resolvedBinary = binaryPath
      return resolvedBinary
    }
    if (subprocess && typeof subprocess.resolveExecutable === 'function') {
      try {
        const resolved = await subprocess.resolveExecutable(binaryPath)
        if (typeof resolved === 'string' && resolved !== '') {
          resolvedBinary = resolved
          return resolvedBinary
        }
      } catch {
        // fall through to the explicit candidates below
      }
    }
    for (const candidate of pathCandidates(binaryPath)) {
      try {
        await access(candidate, constants.X_OK)
        resolvedBinary = candidate
        return resolvedBinary
      } catch {
        // try the next candidate
      }
    }
    throw new Error(`the "${binaryPath}" executable was not found on this machine`)
  }

  function environment() {
    /** @type {Record<string, string>} */
    const env = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value
    }
    if (stateHome !== '') env.AGENT_DESKTOP_HOME = stateHome
    return env
  }

  /**
   * Run one agent-desktop command and return its JSON envelope. Command
   * failures are returned as envelopes, never thrown, so the model can branch
   * on `error.code` and `error.disposition` as the CLI intends.
   *
   * @param {{ command: string, args?: readonly string[], timeoutMs?: number, signal?: AbortSignal }} request
   * @returns {Promise<unknown>}
   */
  async function run(request) {
    const command = String(request.command ?? '').trim()
    if (command === '') return failure('INVALID_ARGS', 'a command is required', undefined, command)

    let binary
    try {
      binary = await resolveBinary()
    } catch (error) {
      return failure(
        'CLI_NOT_FOUND',
        `${message(error)}. Install it with "npm install -g agent-desktop" or set the plugin config binaryPath.`,
        'Run `npm install -g agent-desktop` (macOS, Windows and Linux) and retry, or point the plugin config at an absolute binary path.',
        command,
      )
    }

    const args = Array.isArray(request.args) ? request.args.map((entry) => String(entry)) : []
    const timeoutMs = positiveInt(request.timeoutMs, defaultTimeoutMs)
    const signal = request.signal
    if (signal?.aborted) return failure('ABORTED', 'the tool call was cancelled before the command started', undefined, command)

    const controller = new AbortController()
    let timedOut = false
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    /** @type {Awaited<ReturnType<NonNullable<typeof subprocess>['spawn']>> | undefined} */
    let handle
    try {
      handle = subprocess.spawn({
        argv: [binary, command, ...args],
        cwd: homedir(),
        env: environment(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: MAX_STDOUT_BYTES, spill: { maxBytes: MAX_STDOUT_BYTES * 2 } },
          stderr: { maxBytes: MAX_STDERR_BYTES },
        },
        graceMs: SPAWN_GRACE_MS,
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      return failure('SPAWN_FAILED', message(error), 'Check the binary path and that the Harness can execute it.', command)
    }

    let outcome
    /** @type {unknown} */
    let failureError
    try {
      outcome = await handle.done
    } catch (error) {
      failureError = error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    const stdout = readCollected(handle.collected?.stdout)
    const stderr = readCollected(handle.collected?.stderr)

    if (timedOut) {
      return failure(
        'TIMEOUT',
        `agent-desktop ${command} did not finish within ${timeoutMs} ms.`,
        'Retry with a larger timeout_ms, or narrow the command (snapshot --interactive-only/--compact, or a --window-id target).',
        command,
      )
    }
    if (signal?.aborted) return failure('ABORTED', 'the tool call was cancelled', undefined, command)
    if (failureError !== undefined) {
      return failure('SPAWN_FAILED', message(failureError), 'Retry once; if it persists, check the CLI with `agent-desktop status`.', command)
    }

    const envelope = parseEnvelope(stdout.text)
    if (envelope !== undefined) {
      if (stdout.lossy) {
        Object.defineProperty(envelope, '_stdoutTruncated', {
          value: true,
          enumerable: false,
          configurable: true,
        })
      }
      return envelope
    }
    if (stderr.text.trim() !== '') {
      return failure('COMMAND_FAILED', stderr.text.trim().slice(0, 4_000), 'Inspect the CLI output and retry with --verbose.', command)
    }
    return failure(
      'UNPARSEABLE_OUTPUT',
      `agent-desktop ${command} exited with code ${outcome?.exitCode ?? 'unknown'} without a JSON envelope.`,
      'Run the command through desktop_run with args ["--help"] to check its syntax, or install/update the CLI.',
      command,
    )
  }

  return { run, resolveBinary, binaryPath, defaultTimeoutMs }
}
