/**
 * dsh-agent-desktop — a DeepSeek Harness Host plugin that exposes the
 * agent-desktop CLI as native desktop_* tools plus a prompt section carrying
 * the operating rules of the upstream agent-desktop skill.
 *
 * Why a plugin instead of the plain skill: the Harness Bash tool is
 * file-sandboxed and cannot run the macOS `ps` tool, which agent-desktop uses
 * for its application inventory. Running the CLI from the Host process keeps
 * `list-apps`, `--app` targeting, `launch`/`close-app` and the default state
 * root working, while the sandbox keeps confining shell commands.
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRunner } from './lib/desktop.js'
import { PROMPT_SECTION, createToolDefinitions } from './lib/tools.js'

export const name = 'agent-desktop'

/** The Host process must be able to register tools and spawn the CLI. */
export const inject = ['tools', 'subprocess']

export const Config = z.object({
  /** Executable name resolved through PATH, or an absolute path. */
  binaryPath: z.string().default('agent-desktop'),
  /** Absolute AGENT_DESKTOP_HOME override; empty keeps the CLI default (~/.agent-desktop). */
  stateHome: z.string().default(''),
  /** Default per-command deadline in milliseconds; callers can override with timeout_ms. */
  timeoutMs: z.number().default(60_000),
  /** Inject the compact desktop-control rules into the agent system prompt. */
  promptSection: z.boolean().default(true),
})

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ binaryPath?: string, stateHome?: string, timeoutMs?: number, promptSection?: boolean }} [config]
 */
export function apply(ctx, config) {
  const resolved = {
    binaryPath: typeof config?.binaryPath === 'string' ? config.binaryPath : 'agent-desktop',
    stateHome: typeof config?.stateHome === 'string' ? config.stateHome : '',
    timeoutMs: typeof config?.timeoutMs === 'number' ? config.timeoutMs : 60_000,
    promptSection: config?.promptSection !== false,
  }

  const runner = createRunner(ctx.subprocess, resolved)
  /** @type {Array<() => void>} */
  const disposers = []

  return ctx.effect(() => {
    for (const definition of createToolDefinitions(runner, resolved)) {
      disposers.push(ctx.tools.register(defineTool(definition)))
    }

    const systemPrompt = ctx.get('systemPrompt')
    if (resolved.promptSection && systemPrompt && typeof systemPrompt.section === 'function') {
      disposers.push(
        systemPrompt.section({
          name: 'agent-desktop:instructions',
          order: 500,
          text: PROMPT_SECTION,
        }),
      )
    }

    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // An already-disposed registration must not block teardown.
        }
      }
    }
  }, 'agent-desktop: tools and prompt section')
}
