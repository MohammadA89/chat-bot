/**
 * Regression tests for the agent loop: the model → tools → model round trip,
 * on both protocols, streaming and not, against the mock provider.
 *
 * They exist because of the failure this repo hit in practice — a model that
 * *prints* `workspace_read` instead of calling it, while the answer reads as if
 * a file had been read. The tests below pin down that a real tool call runs the
 * real tool, and that a printed one runs nothing at all.
 *
 *   npm test
 *
 * The app's source is TypeScript, so it is loaded through Vite's SSR pipeline
 * rather than by Node directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { createMockServer } from './mock-api.mjs'

/* ------------------------------- environment ------------------------------ */

const mock = createMockServer()
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const BASE = `http://127.0.0.1:${mock.address().port}/v1`

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const harness = await vite.ssrLoadModule('/src/lib/harness.ts')
const api = await vite.ssrLoadModule('/src/lib/api.ts')
const pseudotool = await vite.ssrLoadModule('/src/lib/pseudotool.ts')

test.after(async () => {
  await vite.close()
  mock.close()
})

/* --------------------------------- fixtures ------------------------------- */

const README = 'خط اول\nخط دوم\nخط سوم\n'

const SETTINGS = {
  systemPrompt: 'تو یک دستیار هستی.',
  temperature: 0,
  maxTokens: 512,
  streaming: true,
  theme: 'dark',
  sendOnEnter: true,
  toolsEnabled: true,
  autoMemory: false,
  autoSummarize: false,
  contextBudget: 12000,
  approvalMode: 'ask',
  workspacePanel: true,
}

const WORKSPACE = {
  id: 'ws1',
  name: 'demo',
  root: '/tmp/demo',
  editors: [],
  git: { available: true, branch: 'main' },
  github: { available: false },
}

const STATUS = {
  connected: true,
  workspaces: [WORKSPACE],
  capabilities: { read: true, write: true, shell: false, githubWrite: false, watch: false },
}

const config = (provider) => ({ provider, baseUrl: BASE, apiKey: 'test-key' })

/**
 * A stand-in for the sidecar. It records every call, so a test can assert not
 * just what the model said but what actually touched the "filesystem".
 */
function fakeBridge(overrides = {}) {
  const calls = []
  const files = { 'README.md': README }

  const bridge = {
    status: overrides.status ?? STATUS,
    workspace: WORKSPACE,
    mode: overrides.mode ?? 'ask',
    calls,
    files,
    approve: overrides.approve ?? (async () => true),
    async call(method, params = {}) {
      calls.push({ method, params })
      switch (method) {
        case 'workspace.list':
          return { entries: [{ path: 'README.md', type: 'file' }] }
        case 'workspace.read':
          if (files[params.path] === undefined) throw new Error('فایل پیدا نشد.')
          return { path: params.path, content: files[params.path], totalLines: 3 }
        case 'workspace.preview':
          return { diff: `-${params.oldText}\n+${params.newText}` }
        case 'workspace.edit': {
          files[params.path] = files[params.path].replace(params.oldText, params.newText)
          return { path: params.path, applied: true, diff: `-${params.oldText}\n+${params.newText}` }
        }
        default:
          return { ok: true }
      }
    },
  }
  return bridge
}

function makeEnv(bridge) {
  return {
    getProject: () => null,
    setProject: () => {},
    renameConversation: () => {},
    searchChats: () => [],
    ...(bridge ? { bridge } : {}),
  }
}

/** Runs one turn and collects everything the UI would have seen. */
async function runTurn({ provider, model, stream, bridge, text, toolSupport, workspaceBlocked }) {
  let answer = ''
  const toolRuns = []
  const supportEvents = []

  const result = await harness.runTurn({
    config: config(provider),
    model,
    settings: { ...SETTINGS, streaming: stream },
    conversation: { id: 'c1', title: '', messages: [], model, createdAt: 0, updatedAt: 0 },
    project: null,
    history: [{ id: 'm1', role: 'user', content: text, createdAt: Date.now() }],
    signal: new AbortController().signal,
    env: makeEnv(bridge),
    toolSupport,
    workspaceBlocked,
    onDelta: (chunk) => {
      if (chunk.resetText) answer = ''
      if (chunk.text) answer += chunk.text
    },
    onToolRun: (run) => toolRuns.push(run),
    onToolSupport: (support, reason) => supportEvents.push({ support, reason }),
  })

  return { ...result, answer, toolRuns, supportEvents }
}

const MATRIX = [
  { provider: 'openai', stream: false },
  { provider: 'openai', stream: true },
  { provider: 'anthropic', stream: false },
  { provider: 'anthropic', stream: true },
]

/* ------------------------------- real tool use ----------------------------- */

for (const { provider, stream } of MATRIX) {
  const label = `${provider}/${stream ? 'streaming' : 'non-streaming'}`

  test(`${label}: a real tool call runs workspace_read and grounds the answer`, async () => {
    const bridge = fakeBridge()
    const turn = await runTurn({
      provider,
      model: 'mock-workspace',
      stream,
      bridge,
      text: 'فایل README را بخوان',
    })

    const read = turn.toolRuns.filter((run) => run.name === 'workspace_read')
    assert.equal(read.length, 1, 'exactly one workspace_read should have run')
    assert.equal(read[0].ok, true)
    assert.equal(read[0].input.path, 'README.md')
    assert.ok(
      bridge.calls.some((call) => call.method === 'workspace.read'),
      'the bridge must have been asked for the real file',
    )
    assert.ok(turn.answer.includes('خط اول'), 'the answer must quote the real file content')
    assert.equal(turn.toolCallingFailed, undefined)
  })

  test(`${label}: an edit is previewed as a real diff and applied after approval`, async () => {
    const asked = []
    const bridge = fakeBridge({
      approve: async (request) => {
        asked.push(request)
        return true
      },
    })
    const turn = await runTurn({
      provider,
      model: 'mock-editor',
      stream,
      bridge,
      text: 'README را کامل‌تر کن',
    })

    assert.ok(turn.toolRuns.some((run) => run.name === 'workspace_read'), 'it must read before editing')
    const edit = turn.toolRuns.find((run) => run.name === 'workspace_edit')
    assert.ok(edit, 'workspace_edit should have run')
    assert.equal(edit.ok, true)

    assert.equal(asked.length, 1, 'ask mode must raise exactly one approval')
    assert.equal(asked[0].kind, 'write')
    assert.equal(asked[0].previewKind, 'diff')
    assert.ok(asked[0].preview.includes('خط دوم'), 'the preview must carry the real diff')
    assert.equal(bridge.files['README.md'].includes('خط دوم به‌روزشده'), true)
  })
}

/* ----------------------------- refusal paths ------------------------------ */

test('a denied approval leaves the file untouched', async () => {
  const bridge = fakeBridge({ approve: async () => false })
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-editor',
    stream: false,
    bridge,
    text: 'README را ویرایش کن',
  })

  const edit = turn.toolRuns.find((run) => run.name === 'workspace_edit')
  assert.equal(edit.ok, false)
  assert.equal(bridge.files['README.md'], README, 'the file must be unchanged')
  assert.equal(bridge.calls.some((call) => call.method === 'workspace.edit'), false)
})

test('plan mode refuses the write without ever asking', async () => {
  const asked = []
  const bridge = fakeBridge({
    mode: 'plan',
    approve: async (request) => {
      asked.push(request)
      return true
    },
  })
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-editor',
    stream: false,
    bridge,
    text: 'README را ویرایش کن',
  })

  const edit = turn.toolRuns.find((run) => run.name === 'workspace_edit')
  assert.equal(edit.ok, false)
  assert.equal(asked.length, 0, 'plan mode must not raise an approval dialog')
  assert.equal(bridge.files['README.md'], README)
})

test('with write disabled an edit is refused with the real reason', async () => {
  const bridge = fakeBridge({
    status: { ...STATUS, capabilities: { ...STATUS.capabilities, write: false } },
  })
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-editor',
    stream: false,
    bridge,
    text: 'README را ویرایش کن',
  })

  assert.equal(bridge.files['README.md'], README, 'the file must be unchanged')
  assert.equal(bridge.calls.some((call) => call.method === 'workspace.edit'), false)

  // The write tools are not offered at all, but a model can still name one —
  // the capability, not the advertised list, is what refuses it.
  const edit = turn.toolRuns.find((run) => run.name === 'workspace_edit')
  assert.equal(edit.ok, false)
  assert.ok(edit.output.includes('نوشتن در پل محلی خاموش است'))
})

/* --------------------------- pseudo tool calls ----------------------------- */

for (const { provider, stream } of MATRIX) {
  const label = `${provider}/${stream ? 'streaming' : 'non-streaming'}`

  test(`${label}: a printed tool call runs nothing and reports the real obstacle`, async () => {
    const bridge = fakeBridge()
    const turn = await runTurn({
      provider,
      model: 'mock-pseudo',
      stream,
      bridge,
      text: 'فایل README را بخوان',
    })

    assert.equal(turn.toolRuns.length, 0, 'no tool may run from printed JSON')
    assert.equal(
      bridge.calls.some((call) => call.method.startsWith('workspace.') && call.method !== 'workspace.list'),
      false,
      'the fake tool call must never reach the bridge',
    )
    assert.equal(turn.toolCallingFailed, true)
    assert.ok(turn.answer.includes('فراخوانی واقعی ابزار'), 'the user is told what actually blocked')
    assert.ok(
      !turn.answer.includes('workspace_read'),
      'the discarded pseudo-call must not survive in the answer',
    )
    assert.ok(
      turn.supportEvents.some((event) => event.support === 'unsupported'),
      'the model is recorded as unable to call tools',
    )
  })
}

test('a working model is recorded as tool-capable by the turn itself', async () => {
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-workspace',
    stream: false,
    bridge: fakeBridge(),
    text: 'فایل README را بخوان',
  })
  assert.ok(turn.supportEvents.some((event) => event.support === 'supported'))
})

test('a model already known to be incompatible is offered no tools at all', async () => {
  const bridge = fakeBridge()
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-workspace',
    stream: false,
    bridge,
    text: 'فایل README را بخوان',
    toolSupport: 'unsupported',
  })
  assert.equal(turn.toolRuns.length, 0)
  assert.equal(bridge.calls.length, 0, 'not even the folder map is fetched')
})

/* ----------------------------- capability probe ---------------------------- */

for (const provider of ['openai', 'anthropic']) {
  test(`${provider}: the probe recognises a tool-capable model`, async () => {
    const result = await api.probeToolSupport(config(provider), 'mock-workspace')
    assert.equal(result.support, 'supported')
  })

  test(`${provider}: the probe rejects a model that only answers in text`, async () => {
    const result = await api.probeToolSupport(config(provider), 'mock-no-tools')
    assert.equal(result.support, 'unsupported')
    assert.ok(result.reason.length > 0)
  })

  test(`${provider}: the probe rejects an endpoint that refuses tools outright`, async () => {
    const result = await api.probeToolSupport(config(provider), 'mock-rejects-tools')
    assert.equal(result.support, 'unsupported')
  })

  test(`${provider}: a model that prints tool calls fails the probe`, async () => {
    const result = await api.probeToolSupport(config(provider), 'mock-pseudo')
    assert.equal(result.support, 'unsupported')
  })
}

/* -------------------------- pseudo-call detection -------------------------- */

const NAMES = ['workspace_read', 'workspace_edit', 'terminal_run']

test('detects a fenced tool envelope', () => {
  const text = '```json\n{ "name": "workspace_read", "arguments": { "path": "README.md" } }\n```'
  assert.equal(pseudotool.detectPseudoToolCall(text, NAMES), 'workspace_read')
})

test('detects a bare invocation with arguments', () => {
  assert.equal(
    pseudotool.detectPseudoToolCall('workspace_edit({"path": "a.ts", "oldText": "x"})', NAMES),
    'workspace_edit',
  )
})

test('leaves ordinary prose about the tools alone', () => {
  const text = 'برای خواندن فایل‌ها از workspace_read استفاده می‌کنم و بعد نتیجه را می‌گویم.'
  assert.equal(pseudotool.detectPseudoToolCall(text, NAMES), null)
})

test('leaves unrelated JSON alone', () => {
  const text = 'خروجی build چنین است:\n```json\n{ "path": "dist/index.js" }\n```'
  assert.equal(pseudotool.detectPseudoToolCall(text, NAMES), null)
})

/* --------------------------- unreachable workspace ------------------------- */

test('an unreachable workspace is stated in the prompt instead of improvised around', () => {
  const prompt = harness.buildSystemPrompt({
    settings: SETTINGS,
    project: null,
    model: 'mock-pro',
    toolsEnabled: true,
    workspaceBlocked: 'پل محلی Workspace در دسترس نیست و اتصال برقرار نشد.',
  })
  assert.ok(prompt.includes('Workspace در دسترس نیست'))
  assert.ok(prompt.includes('پل محلی Workspace در دسترس نیست'))
})

test('an incompatible model is not told it has workspace tools', () => {
  const prompt = harness.buildSystemPrompt({
    settings: SETTINGS,
    project: null,
    model: 'mock-no-tools',
    toolsEnabled: true,
    bridge: STATUS,
    workspace: WORKSPACE,
    toolSupport: 'unsupported',
  })
  assert.ok(!prompt.includes('محیط برنامه‌نویسی واقعی'))
  assert.ok(prompt.includes('فراخوانی ساختاریافته‌ی ابزار را انجام نمی‌دهد'))
})

/* --------------------- edits described but never applied ------------------- */

for (const { provider, stream } of MATRIX) {
  const label = `${provider}/${stream ? 'streaming' : 'non-streaming'}`

  test(`${label}: a described edit is pushed through to a real workspace_edit`, async () => {
    const bridge = fakeBridge()
    const turn = await runTurn({
      provider,
      model: 'mock-proposer',
      stream,
      bridge,
      text: 'این بخش را به سمت چپ منتقل کن',
    })

    const edit = turn.toolRuns.find((run) => run.name === 'workspace_edit')
    assert.ok(edit, 'the described edit must end up as a real call')
    assert.equal(edit.ok, true)
    assert.equal(bridge.files['README.md'].includes('خط دوم به‌روزشده'), true)
    assert.ok(
      !turn.answer.includes('تغییرات پیشنهادی'),
      'the discarded proposal must not survive in the answer',
    )
  })
}

test('a model that keeps proposing is nudged only once', async () => {
  const bridge = fakeBridge()
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-stubborn',
    stream: false,
    bridge,
    text: 'این بخش را به سمت چپ منتقل کن',
  })

  assert.equal(turn.toolRuns.filter((run) => run.name === 'workspace_edit').length, 0)
  assert.equal(bridge.files['README.md'], README)
  // One read, one nudged round, then its answer is accepted — no infinite loop.
  assert.ok(turn.steps <= 4, `expected a bounded number of rounds, got ${turn.steps}`)
})

test('plan mode never nudges: proposing is exactly the job there', async () => {
  const bridge = fakeBridge({ mode: 'plan' })
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-stubborn',
    stream: false,
    bridge,
    text: 'این بخش را به سمت چپ منتقل کن',
  })

  assert.ok(turn.answer.includes('تغییرات پیشنهادی'), 'the proposal is the answer in plan mode')
  assert.equal(bridge.files['README.md'], README)
})

test('read-only bridges never nudge either', async () => {
  const bridge = fakeBridge({
    status: { ...STATUS, capabilities: { ...STATUS.capabilities, write: false } },
  })
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-stubborn',
    stream: false,
    bridge,
    text: 'این بخش را به سمت چپ منتقل کن',
  })

  assert.ok(turn.answer.includes('تغییرات پیشنهادی'))
  assert.equal(bridge.files['README.md'], README)
})

test('an answer that merely quotes an untouched file is left alone', () => {
  const text = 'برای تغییر رنگ می‌توانی این کد را اضافه کنی:\n```css\n.a { color: red }\n```'
  assert.equal(pseudotool.detectUnappliedEdit(text, []), null)
  assert.equal(pseudotool.detectUnappliedEdit(text, ['src/other.ts']), null)
})

test('a proposal about a file this turn opened is caught', () => {
  const text = 'تغییر این بخش از src/components/Composer.tsx:\n```tsx\n<div />\n```'
  assert.equal(
    pseudotool.detectUnappliedEdit(text, ['src/components/Composer.tsx']),
    'src/components/Composer.tsx',
  )
})

test('prose with no code block is not a shirked edit', () => {
  const text = 'این فایل مسئول ارسال پیام است و تغییری لازم ندارد.'
  assert.equal(pseudotool.detectUnappliedEdit(text, ['src/components/Composer.tsx']), null)
})

/* ------------------- announced but never actually called ------------------- */

for (const { provider, stream } of MATRIX) {
  const label = `${provider}/${stream ? 'streaming' : 'non-streaming'}`

  test(`${label}: an announced-but-uncalled read is pushed into a real call`, async () => {
    const bridge = fakeBridge()
    const turn = await runTurn({
      provider,
      model: 'mock-announcer',
      stream,
      bridge,
      text: 'میخوام فایل README رو کامل‌تر کنیم',
    })

    const read = turn.toolRuns.find((run) => run.name === 'workspace_read')
    assert.ok(read, 'the announced read must actually happen')
    assert.equal(read.ok, true)
    assert.ok(
      bridge.calls.some((call) => call.method === 'workspace.read'),
      'the bridge must have been asked for the real file',
    )
    assert.ok(
      !turn.answer.includes('نیاز داریم'),
      'the discarded announcement must not survive in the answer',
    )
  })
}

test('a bare arguments object with no tool named is still a fake call', () => {
  assert.equal(pseudotool.detectBareToolArgs('```json\n{ "path": "README.md" }\n```'), true)
  assert.equal(
    pseudotool.detectBareToolArgs('{ "command": "npm test", "cwd": "." }'),
    false,
    'cwd is not a tool argument name, so this is not a payload',
  )
})

test('ordinary JSON in an answer is not a fake call', () => {
  assert.equal(pseudotool.detectBareToolArgs('{ "name": "chat-bot", "version": "1.0.0" }'), false)
  assert.equal(pseudotool.detectBareToolArgs('خروجی build چیزی برنگرداند.'), false)
})

test('announced inaction needs both an intent and a file', () => {
  assert.equal(
    pseudotool.detectAnnouncedInaction('برای شروع، فایل README.md را می‌خوانیم.'),
    true,
  )
  assert.equal(pseudotool.detectAnnouncedInaction('برای شروع باید تصمیم بگیریم.'), false)
  assert.equal(pseudotool.detectAnnouncedInaction('این پروژه از vite.config.ts استفاده می‌کند.'), false)
})

test('a long answer that did the work is never mistaken for an announcement', () => {
  const long = 'باید فایل README.md را ببینیم. ' + 'توضیح مفصل. '.repeat(200)
  assert.ok(long.length > 1500)
  assert.equal(pseudotool.detectAnnouncedInaction(long), false)
})

test('an announcement after a tool already ran is left alone', async () => {
  // `mock-workspace` reads first and then answers; that answer mentions the
  // file and must not be second-guessed just because a path appears in it.
  const bridge = fakeBridge()
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-workspace',
    stream: false,
    bridge,
    text: 'فایل README را بخوان',
  })
  assert.equal(turn.toolRuns.filter((run) => run.name === 'workspace_read').length, 1)
  assert.equal(turn.toolCallingFailed, undefined)
})

/* --------------------------- forcing the call ------------------------------ */

for (const { provider, stream } of MATRIX) {
  const label = `${provider}/${stream ? 'streaming' : 'non-streaming'}`

  test(`${label}: a model deaf to the correction is forced into a real edit`, async () => {
    const bridge = fakeBridge()
    const turn = await runTurn({
      provider,
      model: 'mock-deaf',
      stream,
      bridge,
      text: 'README را کامل‌تر کن',
    })

    const edit = turn.toolRuns.find((run) => run.name === 'workspace_edit')
    assert.ok(edit, 'the retry must require a tool call, not merely ask for one')
    assert.equal(edit.ok, true)
    assert.equal(bridge.files['README.md'].includes('خط دوم به‌روزشده'), true)
  })
}

test('the correction round is the only one that forces a tool call', async () => {
  const bodies = []
  const spy = createServer(async (req, res) => {
    const raw = await new Promise((resolve) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => resolve(body))
    })
    if (req.url.includes('/chat/completions')) bodies.push(JSON.parse(raw || '{}'))
    const proxied = await fetch(`${BASE}${req.url.replace(/^\/v1/, '')}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: raw,
    })
    res.writeHead(proxied.status, { 'Content-Type': 'application/json' })
    res.end(await proxied.text())
  })
  await new Promise((resolve) => spy.listen(0, '127.0.0.1', resolve))

  try {
    await harness.runTurn({
      config: { provider: 'openai', baseUrl: `http://127.0.0.1:${spy.address().port}/v1`, apiKey: 'k' },
      model: 'mock-deaf',
      settings: { ...SETTINGS, streaming: false },
      conversation: { id: 'c1', title: '', messages: [], model: 'mock-deaf', createdAt: 0, updatedAt: 0 },
      project: null,
      history: [{ id: 'm1', role: 'user', content: 'README را کامل‌تر کن', createdAt: Date.now() }],
      signal: new AbortController().signal,
      env: makeEnv(fakeBridge()),
      onDelta: () => {},
      onToolRun: () => {},
    })
  } finally {
    spy.close()
  }

  assert.ok(bodies.length >= 3, `expected several rounds, got ${bodies.length}`)
  assert.equal(bodies[0].tool_choice, 'auto', 'the first round must leave the choice open')
  assert.ok(
    bodies.some((body) => body.tool_choice === 'required'),
    'the correction round must require a call',
  )
  assert.equal(
    bodies.filter((body) => body.tool_choice === 'required').length,
    1,
    'forcing is a correction, not the normal mode',
  )
})

test('a model that ignores forcing too is reported, not pretended about', async () => {
  const bridge = fakeBridge()
  const turn = await runTurn({
    provider: 'openai',
    model: 'mock-pseudo',
    stream: false,
    bridge,
    text: 'فایل README را بخوان',
  })
  assert.equal(turn.toolCallingFailed, true)
  assert.equal(turn.toolRuns.length, 0)
})

/* ------------------------- connection verification ------------------------- */

for (const provider of ['openai', 'anthropic']) {
  test(`${provider}: a key that lists models but is rejected for chat fails the check`, async () => {
    const open = { ...config(provider), apiKey: 'stale-key' }
    const rejected = await api.verifyChatAccess(open, 'mock-pro')
    assert.ok(rejected, 'an open catalogue must not pass as a working connection')
    assert.equal(rejected.status, 401)
  })

  test(`${provider}: a working key passes the check`, async () => {
    assert.equal(await api.verifyChatAccess(config(provider), 'mock-pro'), null)
  })
}

test('a model-specific failure does not block the connection', async () => {
  // 404 means "not that model", not "not your key" — connecting must still work.
  assert.equal(await api.verifyChatAccess(config('openai'), 'no-such-model'), null)
})

/* --------------------------- unreachable endpoint -------------------------- */

/** A port nothing is listening on, so `fetch` fails at the network layer. */
async function deadPort() {
  const probe = createServer(() => {})
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test('a dead localhost endpoint names the IPv6 trap, not just CORS', async () => {
  const port = await deadPort()
  const failure = await api
    .listModels({ provider: 'openai', baseUrl: `http://localhost:${port}/v1`, apiKey: 'k' })
    .then(() => null, (error) => error)

  assert.ok(failure, 'an unreachable endpoint must fail')
  assert.ok(failure.message.includes('اتصال به سرور برقرار نشد'))
  assert.ok(failure.message.includes('127.0.0.1'), 'the IPv4 fallback must be suggested')
  assert.ok(failure.message.includes('::1'), 'the real cause must be named')
})

test('a dead remote endpoint keeps the plain message', async () => {
  const port = await deadPort()
  const failure = await api
    .listModels({ provider: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' })
    .then(() => null, (error) => error)

  assert.ok(failure)
  assert.ok(failure.message.includes('اتصال به سرور برقرار نشد'))
  assert.ok(!failure.message.includes('::1'), 'the hint is only for a localhost base URL')
})
