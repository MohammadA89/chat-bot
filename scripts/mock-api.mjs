/**
 * A tiny mock of both supported protocols, for developing the UI without a
 * real provider. Serves OpenAI-compatible routes and Anthropic-compatible
 * routes from the same port, with permissive CORS.
 *
 *   node scripts/mock-api.mjs            # http://localhost:8787/v1
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)

const MODELS = [
  { id: 'mock-pro', display_name: 'Mock Pro', owned_by: 'mock', created: 1735689600 },
  { id: 'mock-lite', display_name: 'Mock Lite', owned_by: 'mock', created: 1727740800 },
  { id: 'mock-reasoning', display_name: 'Mock Reasoning', owned_by: 'mock', created: 1719792000 },
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
 * The mock plays along with the harness: the first request that carries tools
 * answers with a tool call, and once the result comes back it writes the reply.
 * That exercises the whole loop without a real provider.
 */
function wantsToolCall(body) {
  if (!body.tools?.length) return false
  const already = (body.messages ?? []).some(
    (m) =>
      m.role === 'tool' ||
      (Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result')),
  )
  if (already) return false
  const names = body.tools.map((t) => t.function?.name ?? t.name)
  return names.includes('remember')
}

const TOOL_ARGS = JSON.stringify({
  facts: ['کاربر رابط فارسی و راست‌به‌چپ می‌خواهد.', 'پروژه با React و Vite ساخته می‌شود.'],
})

const server = createServer(async (req, res) => {
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
    const reply = replyFor(model)

    if (wantsToolCall(body)) {
      const call = { id: 'call_mock_1', type: 'function', function: { name: 'remember', arguments: TOOL_ARGS } }
      if (!body.stream) {
        return json(res, 200, {
          id: 'cmpl-mock',
          model,
          choices: [
            { index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        })
      }
      const toolFrames = [
        sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: 'remember', arguments: '' } }] } }] }),
        ...chunks(TOOL_ARGS).map((piece) =>
          sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] } }] }),
        ),
        sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]
      return streamFrames(res, toolFrames)
    }

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
    const reply = replyFor(model)

    if (wantsToolCall(body)) {
      const input = JSON.parse(TOOL_ARGS)
      if (!body.stream) {
        return json(res, 200, {
          id: 'msg-mock',
          model,
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'toolu_mock_1', name: 'remember', input }],
          usage: { input_tokens: 40, output_tokens: 20 },
        })
      }
      const toolFrames = [
        sse({ type: 'message_start', message: { id: 'msg-mock', model, usage: { input_tokens: 40, output_tokens: 0 } } }),
        sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_mock_1', name: 'remember', input: {} } }),
        ...chunks(TOOL_ARGS).map((piece) =>
          sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: piece } }),
        ),
        sse({ type: 'content_block_stop', index: 0 }),
        sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }),
        sse({ type: 'message_stop' }),
      ]
      return streamFrames(res, toolFrames)
    }

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
})

server.listen(PORT, () => {
  console.log(`Mock API listening on http://localhost:${PORT}/v1`)
})
