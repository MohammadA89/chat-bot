/**
 * A tiny mock of both supported protocols, for developing the UI without a
 * real provider. Serves OpenAI-compatible routes and Anthropic-compatible
 * routes from the same port, with permissive CORS.
 *
 *   node scripts/mock-api.mjs            # http://localhost:8787/v1
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.PORT ?? 8787)

const MODELS = [
  { id: 'mock-pro', display_name: 'Mock Pro', owned_by: 'mock', created: 1735689600 },
  { id: 'mock-lite', display_name: 'Mock Lite', owned_by: 'mock', created: 1727740800 },
  { id: 'mock-reasoning', display_name: 'Mock Reasoning', owned_by: 'mock', created: 1719792000 },
  // Workspace-capable and deliberately broken models, used by scripts/agent-tests.mjs.
  { id: 'mock-workspace', display_name: 'Mock Workspace', owned_by: 'mock', created: 1719792000 },
  { id: 'mock-editor', display_name: 'Mock Editor', owned_by: 'mock', created: 1719792000 },
  { id: 'mock-pseudo', display_name: 'Mock Pseudo Tools', owned_by: 'mock', created: 1719792000 },
  { id: 'mock-proposer', display_name: 'Mock Proposer', owned_by: 'mock', created: 1719792000 },
  { id: 'mock-stubborn', display_name: 'Mock Stubborn Proposer', owned_by: 'mock', created: 1719792000 },
  { id: 'mock-no-tools', display_name: 'Mock Without Tools', owned_by: 'mock', created: 1719792000 },
  { id: 'mock-rejects-tools', display_name: 'Mock Rejecting Tools', owned_by: 'mock', created: 1719792000 },
]

const REPLY = `### پاسخ نمونه

این یک پاسخ آزمایشی از سرور ماک است تا رندر **مارک‌داون** بررسی شود.

- فهرست نشانه‌دار
- مورد دوم با \`inline code\`

| ستون | مقدار |
| --- | --- |
| اول | ۱۲۰ |
| دوم | ۳۴۰ |

\`\`\`python
def greet(name: str) -> str:
    return f"سلام {name}"
\`\`\`

و یک رابطه‌ی ریاضی: $e^{i\\pi} + 1 = 0$
`

/**
 * A DeepSeek-R1 style reply: the chain of thought is inlined in the answer
 * text inside <think> tags rather than sent in a separate field.
 */
const THINKING = `<think>
خب، کاربر سلام کرده است. پاسخ باید کوتاه و ساختارمند باشد.
اول نکته‌های کلیدی را فهرست می‌کنم، بعد یک مثال کد می‌آورم.
</think>

`

const replyFor = (model) => (model === 'mock-reasoning' ? THINKING + REPLY : REPLY)

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
}

function json(res, status, body) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

/** Emits SSE frames slowly enough to exercise the client's stream handling. */
function streamFrames(res, frames) {
  cors(res)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  let i = 0
  const timer = setInterval(() => {
    if (i >= frames.length) {
      clearInterval(timer)
      res.end()
      return
    }
    res.write(frames[i++])
  }, 18)
  res.on('close', () => clearInterval(timer))
}

const sse = (data) => `data: ${JSON.stringify(data)}\n\n`
const chunks = (text) => text.match(/[\s\S]{1,24}/g) ?? []

/**
 * A reply that *looks* like a tool call but is only text — the failure mode the
 * harness has to recognise and refuse to act on.
 */
const PSEUDO_REPLY = `برای خواندن فایل باید ابزار زیر را صدا بزنیم:

\`\`\`json
{ "name": "workspace_read", "arguments": { "path": "README.md" } }
\`\`\`

بعد از آن می‌توانیم با \`workspace_edit\` بخش نصب را کامل‌تر کنیم.`

const PROPOSAL_REPLY = [
  'برای این کار باید تغییرات زیر را در README.md اعمال کنید.',
  '',
  '### تغییرات پیشنهادی',
  'تغییر این بخش از کد:',
  '',
  '```text',
  'خط دوم',
  '```',
  '',
  'به:',
  '',
  '```text',
  'خط دوم به‌روزشده',
  '```',
].join('\n')

const TOOL_ARGS = JSON.stringify({
  facts: ['کاربر رابط فارسی و راست‌به‌چپ می‌خواهد.', 'پروژه با React و Vite ساخته می‌شود.'],
})

/** Tool results already in the conversation, in either protocol's shape. */
function toolResultsSoFar(body) {
  const results = []
  for (const m of body.messages ?? []) {
    if (m.role === 'tool') results.push(String(m.content ?? ''))
    else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block?.type === 'tool_result') results.push(String(block.content ?? ''))
      }
    }
  }
  return results
}

function offeredTools(body) {
  return (body.tools ?? []).map((t) => t.function?.name ?? t.name)
}

/**
 * Decides what the mock answers with. Each mock model stands for one real-world
 * provider behaviour, so the harness can be exercised end to end:
 *
 * - `mock-workspace` reads a file, then answers from the tool output.
 * - `mock-editor` reads, then edits.
 * - `mock-pseudo` prints a tool call as text and never makes a real one.
 * - `mock-no-tools` ignores the tools it was offered.
 * - `mock-rejects-tools` refuses any request that carries tools (handled earlier).
 * - everything else keeps the original `remember` round-trip.
 */
function planReply(body, model) {
  const names = offeredTools(body)
  const results = toolResultsSoFar(body)

  if (!names.length || model === 'mock-no-tools') return { text: replyFor(model) }
  if (model === 'mock-pseudo') return { text: PSEUDO_REPLY }
  if (names.includes('probe_ping')) {
    return { calls: [{ name: 'probe_ping', args: JSON.stringify({ token: 'pong' }) }] }
  }

  if (model === 'mock-workspace') {
    if (results.length === 0) {
      return { calls: [{ name: 'workspace_read', args: JSON.stringify({ path: 'README.md' }) }] }
    }
    return { text: `محتوای واقعی فایل: ${results[results.length - 1].slice(0, 160)}` }
  }

  // Reads the file, then describes the edit instead of making it. The
  // stubborn one keeps doing so even after the harness pushes back.
  if (model === 'mock-proposer' || model === 'mock-stubborn') {
    if (results.length === 0) {
      return { calls: [{ name: 'workspace_read', args: JSON.stringify({ path: 'README.md' }) }] }
    }
    // The harness's own correction, not the system prompt, is the signal here.
    const nudged = (body.messages ?? []).some((m) =>
      typeof m.content === 'string' && m.content.includes('به‌جای اعمال تغییر'),
    )
    if (nudged && model === 'mock-proposer') {
      return {
        calls: [{
          name: 'workspace_edit',
          args: JSON.stringify({ path: 'README.md', oldText: 'خط دوم', newText: 'خط دوم به‌روزشده' }),
        }],
      }
    }
    if (results.length > 1) return { text: 'فایل README.md به‌روزرسانی شد.' }
    return { text: PROPOSAL_REPLY }
  }

  if (model === 'mock-editor') {
    if (results.length === 0) {
      return { calls: [{ name: 'workspace_read', args: JSON.stringify({ path: 'README.md' }) }] }
    }
    if (results.length === 1) {
      return {
        calls: [{
          name: 'workspace_edit',
          args: JSON.stringify({ path: 'README.md', oldText: 'خط دوم', newText: 'خط دوم به‌روزشده' }),
        }],
      }
    }
    return { text: `نتیجه‌ی ویرایش: ${results[results.length - 1].slice(0, 160)}` }
  }

  if (results.length === 0 && names.includes('remember')) {
    return { calls: [{ name: 'remember', args: TOOL_ARGS }] }
  }
  return { text: replyFor(model) }
}

const handler = async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname.replace(/^\/v1/, '')

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    return res.end()
  }

  const authorized =
    req.headers.authorization?.startsWith('Bearer ') || Boolean(req.headers['x-api-key'])
  if (!authorized) {
    return json(res, 401, { error: { message: 'Missing API key.' } })
  }

  if (path === '/models' && req.method === 'GET') {
    return json(res, 200, { object: 'list', data: MODELS })
  }

  if (path === '/chat/completions' && req.method === 'POST') {
    const body = await readBody(req)
    const model = body.model ?? 'mock-pro'
    if (model === 'mock-rejects-tools' && body.tools?.length) {
      return json(res, 400, { error: { message: 'This model does not support tools.' } })
    }
    const plan = planReply(body, model)

    if (plan.calls) {
      const calls = plan.calls.map((c, i) => ({
        id: `call_mock_${i + 1}`,
        type: 'function',
        function: { name: c.name, arguments: c.args },
      }))
      if (!body.stream) {
        return json(res, 200, {
          id: 'cmpl-mock',
          model,
          choices: [
            { index: 0, message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: 'tool_calls' },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        })
      }
      const toolFrames = []
      calls.forEach((call, index) => {
        toolFrames.push(sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] } }] }))
        for (const piece of chunks(call.function.arguments)) {
          toolFrames.push(sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: piece } }] } }] }))
        }
      })
      toolFrames.push(sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }))
      toolFrames.push('data: [DONE]\n\n')
      return streamFrames(res, toolFrames)
    }

    const reply = plan.text
    if (!body.stream) {
      return json(res, 200, {
        id: 'cmpl-mock',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 180, total_tokens: 222 },
      })
    }
    const frames = chunks(reply).map((c) =>
      sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: { content: c } }] }),
    )
    frames.push(sse({ id: 'cmpl-mock', model, choices: [], usage: { prompt_tokens: 42, completion_tokens: 180 } }))
    frames.push('data: [DONE]\n\n')
    return streamFrames(res, frames)
  }

  if (path === '/messages' && req.method === 'POST') {
    const body = await readBody(req)
    const model = body.model ?? 'mock-pro'
    if (model === 'mock-rejects-tools' && body.tools?.length) {
      return json(res, 400, { error: { message: 'This model does not support tools.' } })
    }
    const plan = planReply(body, model)

    if (plan.calls) {
      if (!body.stream) {
        return json(res, 200, {
          id: 'msg-mock',
          model,
          stop_reason: 'tool_use',
          content: plan.calls.map((c, i) => ({
            type: 'tool_use',
            id: `toolu_mock_${i + 1}`,
            name: c.name,
            input: JSON.parse(c.args),
          })),
          usage: { input_tokens: 40, output_tokens: 20 },
        })
      }
      const toolFrames = [
        sse({ type: 'message_start', message: { id: 'msg-mock', model, usage: { input_tokens: 40, output_tokens: 0 } } }),
      ]
      plan.calls.forEach((call, index) => {
        toolFrames.push(sse({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_mock_${index + 1}`, name: call.name, input: {} } }))
        for (const piece of chunks(call.args)) {
          toolFrames.push(sse({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: piece } }))
        }
        toolFrames.push(sse({ type: 'content_block_stop', index }))
      })
      toolFrames.push(sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }))
      toolFrames.push(sse({ type: 'message_stop' }))
      return streamFrames(res, toolFrames)
    }

    const reply = plan.text
    if (!body.stream) {
      return json(res, 200, {
        id: 'msg-mock',
        model,
        content: [{ type: 'text', text: reply }],
        usage: { input_tokens: 42, output_tokens: 180 },
      })
    }
    const frames = [
      sse({ type: 'message_start', message: { id: 'msg-mock', model, usage: { input_tokens: 42, output_tokens: 0 } } }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      ...chunks(reply).map((c) =>
        sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }),
      ),
      sse({ type: 'content_block_stop', index: 0 }),
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 180 } }),
      sse({ type: 'message_stop' }),
    ]
    return streamFrames(res, frames)
  }

  return json(res, 404, { error: { message: `Unknown route: ${url.pathname}` } })
}

/** A fresh, unbound server — the tests start one on an ephemeral port. */
export function createMockServer() {
  return createServer(handler)
}

// Only listen when run directly, so importing this file for tests is cheap.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createMockServer().listen(PORT, () => {
    console.log(`Mock API listening on http://localhost:${PORT}/v1`)
  })
}
