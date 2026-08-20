/**
 * Some reasoning models (DeepSeek-R1 and its distills, QwQ, …) don't expose
 * their chain of thought through a dedicated field — they inline it in the
 * answer inside `<think>…</think>`. This module pulls that block back out,
 * incrementally, so it can be shown as collapsible reasoning instead of
 * leaking into the message body.
 */

const TAGS = ['think', 'thinking', 'reason', 'reasoning'] as const

const OPEN_TAGS = TAGS.map((t) => `<${t}>`)
const CLOSE_TAGS = TAGS.map((t) => `</${t}>`)
const ALL_TAGS = [...OPEN_TAGS, ...CLOSE_TAGS]
const MAX_TAG = Math.max(...ALL_TAGS.map((t) => t.length))

export interface ThinkChunk {
  /** Visible answer text. */
  text?: string
  /** Chain-of-thought text. */
  reasoning?: string
  /**
   * The model closed a thinking block it never opened — everything emitted as
   * `text` so far belongs to the reasoning panel. Consumers move it across.
   */
  reclassifyAsReasoning?: boolean
  /**
   * Everything streamed as `text` so far must be thrown away. The harness
   * raises it when a round turns out to be a printed-out tool call rather than
   * an answer, so the discarded text never reaches the transcript.
   */
  resetText?: boolean
}

/** Index of the earliest tag from `tags` in `s`, or -1. */
function findTag(s: string, tags: readonly string[]): { index: number; tag: string } | null {
  let best: { index: number; tag: string } | null = null
  const lower = s.toLowerCase()
  for (const tag of tags) {
    const i = lower.indexOf(tag)
    if (i !== -1 && (best === null || i < best.index)) best = { index: i, tag }
  }
  return best
}

/**
 * Length of the trailing run that might still grow into a tag (`…<thin`), so it
 * is held back rather than flushed as text mid-tag.
 */
function pendingTagLength(s: string): number {
  const from = Math.max(0, s.length - MAX_TAG + 1)
  const start = s.indexOf('<', from)
  if (start === -1) return 0
  const tail = s.slice(start).toLowerCase()
  return ALL_TAGS.some((tag) => tag.startsWith(tail)) ? s.length - start : 0
}

/**
 * Stateful splitter for a token stream. Feed it every text delta; it returns
 * the pieces to forward. Tags are only honoured around the first thinking
 * block — once it closes, later `<think>` text (a code sample, say) is left
 * alone.
 */
export function createThinkingSplitter() {
  let buffer = ''
  let inside = false
  let done = false
  let emittedText = false

  /** Wraps answer text, dropping the blank lines a thinking block leaves behind. */
  function answer(str: string): ThinkChunk | null {
    let out = emittedText ? str : str.replace(/^\s+/, '')
    if (!out) return null
    emittedText = true
    return { text: out }
  }

  function push(chunk: string): ThinkChunk[] {
    if (!chunk) return []
    buffer += chunk
    const out: ThinkChunk[] = []
    const emit = (c: ThinkChunk | null) => {
      if (c) out.push(c)
    }
    const drain = () => {
      if (buffer) emit(answer(buffer))
      buffer = ''
    }

    if (done) {
      drain()
      return out
    }

    for (;;) {
      if (inside) {
        const close = findTag(buffer, CLOSE_TAGS)
        if (close) {
          if (close.index > 0) emit({ reasoning: buffer.slice(0, close.index) })
          buffer = buffer.slice(close.index + close.tag.length)
          inside = false
          done = true
          drain()
          return out
        }
        const hold = pendingTagLength(buffer)
        const flushable = buffer.slice(0, buffer.length - hold)
        if (flushable) emit({ reasoning: flushable })
        buffer = buffer.slice(buffer.length - hold)
        return out
      }

      // Outside a block: an opening tag only counts while nothing but
      // whitespace has been said, so a `<think>` inside an answer stays put.
      const open = emittedText ? null : findTag(buffer, OPEN_TAGS)
      const close = findTag(buffer, CLOSE_TAGS)

      if (open && (!close || open.index <= close.index)) {
        const before = buffer.slice(0, open.index)
        if (before.trim()) {
          // Real content came first — this isn't a leading thinking block.
          done = true
          drain()
          return out
        }
        buffer = buffer.slice(open.index + open.tag.length)
        inside = true
        continue
      }

      if (close) {
        // Orphan `</think>`: the provider dropped the opening tag, so what we
        // already streamed as the answer was really the model thinking.
        const before = buffer.slice(0, close.index)
        out.push({ text: before, reclassifyAsReasoning: true })
        buffer = buffer.slice(close.index + close.tag.length)
        done = true
        emittedText = false // the answer starts fresh after the block
        drain()
        return out
      }

      const hold = pendingTagLength(buffer)
      const flushable = buffer.slice(0, buffer.length - hold)
      if (flushable) emit(answer(flushable))
      buffer = buffer.slice(buffer.length - hold)
      return out
    }
  }

  /** Drains whatever is still buffered when the stream ends. */
  function flush(): ThinkChunk[] {
    if (!buffer) return []
    const rest = buffer
    buffer = ''
    // An unclosed block means generation stopped while still thinking.
    if (inside) return [{ reasoning: rest }]
    const c = answer(rest)
    return c ? [c] : []
  }

  return { push, flush }
}

/** One-shot split for a complete string (non-streamed replies, stored text). */
export function splitThinking(content: string): { text: string; reasoning: string } {
  const splitter = createThinkingSplitter()
  let text = ''
  let reasoning = ''
  for (const chunk of [...splitter.push(content), ...splitter.flush()]) {
    if (chunk.text) text += chunk.text
    if (chunk.reasoning) reasoning += chunk.reasoning
    if (chunk.reclassifyAsReasoning) {
      reasoning += text
      text = ''
    }
  }
  return { text: text.replace(/^\s+/, ''), reasoning: reasoning.trim() }
}

/** True when `content` still carries an inline thinking block. */
export function hasInlineThinking(content: string): boolean {
  const lower = content.toLowerCase()
  return CLOSE_TAGS.some((tag) => lower.includes(tag))
}
