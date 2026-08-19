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
    if (!body.stream) {
      return json(res, 200, {
        id: 'cmpl-mock',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 180, total_tokens: 222 },
      })
    }
    const frames = chunks(REPLY).map((c) =>
      sse({ id: 'cmpl-mock', model, choices: [{ index: 0, delta: { content: c } }] }),
    )
    frames.push(sse({ id: 'cmpl-mock', model, choices: [], usage: { prompt_tokens: 42, completion_tokens: 180 } }))
    frames.push('data: [DONE]\n\n')
    return streamFrames(res, frames)
  }

  if (path === '/messages' && req.method === 'POST') {
    const body = await readBody(req)
    const model = body.model ?? 'mock-pro'
    if (!body.stream) {
      return json(res, 200, {
        id: 'msg-mock',
        model,
        content: [{ type: 'text', text: REPLY }],
        usage: { input_tokens: 42, output_tokens: 180 },
      })
    }
    const frames = [
      sse({ type: 'message_start', message: { id: 'msg-mock', model, usage: { input_tokens: 42, output_tokens: 0 } } }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      ...chunks(REPLY).map((c) =>
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
