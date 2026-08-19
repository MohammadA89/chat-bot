import type { ApiConfig, Message, ModelInfo, Provider, Usage } from '../types'

/** Human-readable failure that already carries a Persian, user-facing message. */
export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Normalises a user-supplied base URL into a versioned API root.
 * Accepts `https://x.com`, `https://x.com/`, `https://x.com/v1` — all become
 * `https://x.com/v1`. A base that already ends in a version segment is left as is.
 */
export function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, '')
  if (!base) return ''
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  if (!/\/v\d+[a-z]*$/i.test(base)) base = `${base}/v1`
  return base
}

function authHeaders(config: ApiConfig): Record<string, string> {
  const key = config.apiKey.trim()
  if (config.provider === 'anthropic') {
    return {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      // Lets browser-based clients talk to the Anthropic API directly.
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  return { Authorization: `Bearer ${key}` }
}

/** Turns an HTTP failure into a message a Persian-speaking user can act on. */
async function toApiError(res: Response): Promise<ApiError> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      detail = json?.error?.message ?? json?.message ?? json?.error ?? text
    } catch {
      detail = text
    }
  } catch {
    /* body unreadable */
  }
  detail = String(detail || '').slice(0, 500)

  const byStatus: Record<number, string> = {
    401: 'کلید API نامعتبر است یا رد شد (۴۰۱).',
    403: 'دسترسی این کلید به سرویس مجاز نیست (۴۰۳).',
    404: 'آدرس درخواست پیدا نشد (۴۰۴) — احتمالاً Base URL یا نام مدل درست نیست.',
    429: 'محدودیت تعداد درخواست‌ها (۴۲۹). کمی صبر کنید و دوباره تلاش کنید.',
    500: 'خطای داخلی سرور (۵۰۰).',
    502: 'سرور واسط پاسخ نداد (۵۰۲).',
    503: 'سرویس در دسترس نیست (۵۰۳).',
  }
  const head = byStatus[res.status] ?? `درخواست با خطا مواجه شد (${res.status}).`
  return new ApiError(detail ? `${head}\n${detail}` : head, res.status)
}

function networkError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new ApiError('درخواست لغو شد.')
  }
  return new ApiError(
    'اتصال به سرور برقرار نشد. Base URL را بررسی کنید و مطمئن شوید سرویس اجازه‌ی دسترسی از مرورگر (CORS) را می‌دهد.',
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Models                                    */
/* -------------------------------------------------------------------------- */

function prettifyModelId(id: string): string {
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bAi\b/g, 'AI')
}

/** Fetches the model catalogue. Both protocols expose `GET {base}/models`. */
export async function listModels(config: ApiConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const base = normalizeBaseUrl(config.baseUrl)
  if (!base) throw new ApiError('Base URL وارد نشده است.')

  let res: Response
  try {
    res = await fetch(`${base}/models`, {
      method: 'GET',
      headers: { ...authHeaders(config) },
      signal,
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) throw await toApiError(res)

  const json = await res.json().catch(() => null)
  const raw: any[] = Array.isArray(json) ? json : (json?.data ?? json?.models ?? [])
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError('سرویس هیچ مدلی برنگرداند. دسترسی کلید یا Base URL را بررسی کنید.')
  }

  const models: ModelInfo[] = raw
    .map((m) => {
      const id = typeof m === 'string' ? m : (m?.id ?? m?.name ?? m?.model)
      if (!id) return null
      const info: ModelInfo = {
        id: String(id),
        label:
          typeof m === 'object' && m?.display_name
            ? String(m.display_name)
            : prettifyModelId(String(id)),
        owner: typeof m === 'object' ? (m?.owned_by ?? m?.organization ?? undefined) : undefined,
        created: typeof m === 'object' && typeof m?.created === 'number' ? m.created : undefined,
      }
      return info
    })
    .filter((m): m is ModelInfo => m !== null)

  // Newest first when the API dates them, alphabetical otherwise.
  models.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
  return models
}

/* -------------------------------------------------------------------------- */
/*                                    Chat                                     */
/* -------------------------------------------------------------------------- */

export interface ChatRequest {
  config: ApiConfig
  model: string
  messages: Message[]
  systemPrompt: string
  temperature: number
  maxTokens: number
  stream: boolean
  signal: AbortSignal
  onDelta: (chunk: { text?: string; reasoning?: string }) => void
}

export interface ChatResult {
  usage?: Usage
}

function toWireMessages(messages: Message[]) {
  return messages
    .filter((m) => m.role !== 'system' && !m.error && m.content.trim() !== '')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}

function buildBody(req: ChatRequest, provider: Provider) {
  const messages = toWireMessages(req.messages)
  const system = req.systemPrompt.trim()

  if (provider === 'anthropic') {
    return {
      model: req.model,
      messages,
      ...(system ? { system } : {}),
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: req.stream,
    }
  }
  return {
    model: req.model,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    stream: req.stream,
    ...(req.stream ? { stream_options: { include_usage: true } } : {}),
  }
}

/**
 * Reads an SSE body and yields each event's `data:` payload.
 * Buffers across chunk boundaries, so a JSON object split mid-stream is safe.
 */
async function* sseEvents(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) throw new ApiError('پاسخ استریم از سرور دریافت نشد.')
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Events are separated by a blank line.
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer)
        if (!match) break
        const rawEvent = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const data = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) yield data
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

function readUsage(u: any, provider: Provider): Usage | undefined {
  if (!u) return undefined
  if (provider === 'anthropic') {
    const input = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    return input || output ? { input, output } : undefined
  }
  const input = u.prompt_tokens ?? 0
  const output = u.completion_tokens ?? 0
  return input || output ? { input, output } : undefined
}

export async function sendChat(req: ChatRequest): Promise<ChatResult> {
  const { config, signal } = req
  const base = normalizeBaseUrl(config.baseUrl)
  const provider = config.provider
  const path = provider === 'anthropic' ? '/messages' : '/chat/completions'

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify(buildBody(req, provider)),
      signal,
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) throw await toApiError(res)

  /* ----------------------------- non-streaming ---------------------------- */
  if (!req.stream) {
    const json = await res.json().catch(() => null)
    if (provider === 'anthropic') {
      const blocks: any[] = json?.content ?? []
      const reasoning = blocks
        .filter((b) => b?.type === 'thinking')
        .map((b) => b.thinking)
        .join('')
      const text = blocks
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('')
      if (reasoning) req.onDelta({ reasoning })
      req.onDelta({ text })
      return { usage: readUsage(json?.usage, provider) }
    }
    const choice = json?.choices?.[0]?.message
    const reasoning = choice?.reasoning_content ?? choice?.reasoning
    if (reasoning) req.onDelta({ reasoning: String(reasoning) })
    req.onDelta({ text: String(choice?.content ?? '') })
    return { usage: readUsage(json?.usage, provider) }
  }

  /* -------------------------------- streaming ------------------------------ */
  let usage: Usage | undefined
  for await (const data of sseEvents(res, signal)) {
    if (data === '[DONE]') break
    let event: any
    try {
      event = JSON.parse(data)
    } catch {
      continue // keep-alive or malformed frame — skip
    }

    if (event?.error) {
      throw new ApiError(String(event.error?.message ?? event.error))
    }

    if (provider === 'anthropic') {
      switch (event.type) {
        case 'content_block_delta': {
          const d = event.delta
          if (d?.type === 'text_delta' && d.text) req.onDelta({ text: d.text })
          else if (d?.type === 'thinking_delta' && d.thinking) req.onDelta({ reasoning: d.thinking })
          break
        }
        case 'message_start':
          usage = readUsage(event.message?.usage, provider) ?? usage
          break
        case 'message_delta': {
          const u = readUsage(event.usage, provider)
          if (u) usage = { input: usage?.input ?? u.input, output: u.output || (usage?.output ?? 0) }
          break
        }
        case 'error':
          throw new ApiError(String(event.error?.message ?? 'خطای استریم از سمت سرور.'))
      }
      continue
    }

    const delta = event?.choices?.[0]?.delta
    if (delta?.content) req.onDelta({ text: String(delta.content) })
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (reasoning) req.onDelta({ reasoning: String(reasoning) })
    const u = readUsage(event?.usage, provider)
    if (u) usage = u
  }

  return { usage }
}
