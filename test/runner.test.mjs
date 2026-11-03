/**
 * Standalone tests for the Host-side runner and the tool argument builders.
 * They need no Harness runtime: the CLI is spawned through a small double of
 * `ctx.subprocess` built on node:child_process.
 *
 *   node test/runner.test.mjs
 *
 * CLI-dependent assertions are skipped with a warning when the agent-desktop
 * executable is not installed.
 */
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { createRunner, parseEnvelope } from '../lib/desktop.js'
import { createToolDefinitions } from '../lib/tools.js'

/** Minimal SubprocessService double backed by child_process. */
function fakeSubprocess() {
  return {
    async resolveExecutable() {
      throw new Error('resolveExecutable is not available in the test double')
    },
    spawn(spec) {
      const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const buckets = {
        stdout: { chunks: [], size: 0, lossy: false },
        stderr: { chunks: [], size: 0, lossy: false },
      }
      const maxOut = spec.stdio.stdout.maxBytes
      const maxErr = spec.stdio.stderr.maxBytes
      child.stdout.on('data', (chunk) => {
        buckets.stdout.size += chunk.length
        if (buckets.stdout.size <= maxOut) buckets.stdout.chunks.push(chunk)
        else buckets.stdout.lossy = true
      })
      child.stderr.on('data', (chunk) => {
        buckets.stderr.size += chunk.length
        if (buckets.stderr.size <= maxErr) buckets.stderr.chunks.push(chunk)
        else buckets.stderr.lossy = true
      })
      const done = new Promise((resolve) => {
        child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
      })
      spec.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
      const reader = (bucket) => ({
        readFrom() {
          return {
            text: Buffer.concat(bucket.chunks).toString('utf8'),
            nextOffset: bucket.size,
            lossy: bucket.lossy,
          }
        },
      })
      return {
        collected: { stdout: reader(buckets.stdout), stderr: reader(buckets.stderr) },
        done,
        terminate() {
          child.kill('SIGTERM')
        },
      }
    },
  }
}

const results = []
async function test(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
    console.log(`ok   ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
  }
}

await test('parseEnvelope parses one JSON line', () => {
  assert.deepEqual(parseEnvelope('{"ok":true}\n'), { ok: true })
})

await test('parseEnvelope falls back to the last JSON line', () => {
  assert.deepEqual(parseEnvelope('noise\n{"ok":false,"error":{"code":"X"}}\n'), {
    ok: false,
    error: { code: 'X' },
  })
})

await test('parseEnvelope returns undefined for non-JSON output', () => {
  assert.equal(parseEnvelope('not json at all'), undefined)
})

await test('missing binary reports CLI_NOT_FOUND', async () => {
  const runner = createRunner(fakeSubprocess(), { binaryPath: 'agent-desktop-not-installed-123' })
  const envelope = await runner.run({ command: 'status' })
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, 'CLI_NOT_FOUND')
})

await test('timeout aborts a long command', async () => {
  const runner = createRunner(fakeSubprocess(), { binaryPath: 'agent-desktop' })
  const envelope = await runner.run({ command: 'wait', args: ['--ms', '5000'], timeoutMs: 60 })
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, 'TIMEOUT')
})

const cli = createRunner(fakeSubprocess(), { binaryPath: 'agent-desktop' })
const status = await cli.run({ command: 'status' })

if (status.ok !== true && status.error?.code === 'CLI_NOT_FOUND') {
  console.log('SKIP CLI-dependent tests: agent-desktop is not installed')
} else {
  await test('status returns a JSON envelope', () => {
    assert.equal(status.ok, true)
    assert.equal(status.command, 'status')
    assert.equal(typeof status.data.platform, 'string')
    assert.equal(status.data.version, '1.1.0')
  })

  await test('list-windows returns window objects', async () => {
    const envelope = await cli.run({ command: 'list-windows' })
    assert.equal(envelope.ok, true)
    assert.ok(Array.isArray(envelope.data))
  })

  await test('unknown command returns a JSON error envelope', async () => {
    const envelope = await cli.run({ command: 'definitely-not-a-command' })
    assert.equal(envelope.ok, false)
    assert.equal(typeof envelope.error.code, 'string')
  })
}

await test('tool builders map arguments onto CLI flags', async () => {
  const calls = []
  const stubRunner = {
    run(request) {
      calls.push(request)
      return Promise.resolve({ ok: true })
    },
  }
  const tools = Object.fromEntries(
    createToolDefinitions(stubRunner, { timeoutMs: 1000 }).map((tool) => [tool.name, tool]),
  )
  await tools.desktop_snapshot.execute({ interactive_only: true, compact: true, app: 'Finder' }, {})
  await tools.desktop_snapshot.execute({}, {})
  await tools.desktop_click.execute({ ref: '@s1:e2', kind: 'right-click' }, {})
  await tools.desktop_type.execute({ ref: '@s1:e3', text: 'hello' }, {})
  await tools.desktop_press.execute({ combo: 'cmd+s', app: 'Notes' }, {})
  await tools.desktop_scroll.execute({ ref: '@s1:e4', direction: 'down', amount: 5 }, {})
  await tools.desktop_screenshot.execute({ path: '/tmp/a.png', screen: 0 }, {})
  await tools.desktop_find.execute({ role: 'button', name: 'OK' }, {})
  await tools.desktop_run.execute({ command: 'launch', args: ['--app', 'Safari'] }, {})

  assert.deepEqual(calls[0], {
    command: 'snapshot',
    args: ['--app', 'Finder', '-i', '--compact'],
    timeoutMs: undefined,
    signal: undefined,
  })
  assert.deepEqual(calls[1].args, ['--surface', 'focused'])
  assert.equal(calls[2].command, 'right-click')
  assert.deepEqual(calls[2].args, ['@s1:e2'])
  assert.deepEqual(calls[3].args, ['@s1:e3', 'hello'])
  assert.deepEqual(calls[4].args, ['cmd+s', '--app', 'Notes'])
  assert.deepEqual(calls[5].args, ['@s1:e4', '--direction', 'down', '--amount', '5'])
  assert.deepEqual(calls[6].args, ['/tmp/a.png', '--screen', '0'])
  assert.deepEqual(calls[7].args, ['--role', 'button', '--name', 'OK'])
  assert.deepEqual(calls[8].args, ['--app', 'Safari'])
})

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} tests passed`)
if (failed.length > 0) process.exitCode = 1
