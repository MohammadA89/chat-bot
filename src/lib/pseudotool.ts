/**
 * Detection of *pretend* tool calls.
 *
 * Weak OpenAI-compatible models sometimes answer a "read this file" request by
 * printing the tool name and a JSON payload into the message body instead of
 * emitting a real `tool_calls` / `tool_use` block. The result reads like work
 * was done while nothing was read, written or run.
 *
 * This module only *recognises* that shape. It deliberately never returns the
 * parsed arguments: free JSON produced by a model must never become a file or
 * shell operation — only a structured, schema-checked provider call may.
 */

/** Argument names that make a JSON blob look like a real tool payload. */
const ARG_KEYS = [
  'path',
  'pattern',
  'query',
  'command',
  'oldText',
  'newText',
  'content',
  'from',
  'to',
  'message',
  'title',
  'facts',
  'paths',
  'number',
  'body',
  'line',
  'depth',
  'include',
]

/** How far past a tool name a payload may sit and still count as its call. */
const LOOKAHEAD = 240

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `chunk` looks like an arguments object rather than prose. */
function looksLikeArgs(chunk: string): boolean {
  const open = chunk.indexOf('{')
  if (open === -1) return false
  const body = chunk.slice(open)
  return ARG_KEYS.some((key) => new RegExp(`["']${key}["']\\s*:`).test(body))
}

/**
 * Returns the name of the tool the text pretends to call, or `null`.
 *
 * Two shapes are recognised: a bare invocation (`workspace_read {"path": …}`,
 * `workspace_read(…)`) and an envelope that names the tool in a field
 * (`{"name": "workspace_read", "arguments": {…}}`).
 */
export function detectPseudoToolCall(text: string, toolNames: string[]): string | null {
  if (!text.trim() || toolNames.length === 0) return null

  for (const name of toolNames) {
    const pattern = new RegExp(escape(name), 'g')
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const after = text.slice(match.index + name.length, match.index + name.length + LOOKAHEAD)
      // `workspace_read {"path": "…"}` / `workspace_read(…)` / `: workspace_read` then args.
      if (looksLikeArgs(after)) return name

      // `{"name": "workspace_read", "arguments": {…}}` — the payload precedes
      // nothing useful, so look at the whole surrounding object instead.
      const before = text.slice(Math.max(0, match.index - LOOKAHEAD), match.index)
      const named = /["'](?:name|tool|tool_name|function)["']\s*:\s*["']$/.test(before)
      if (named && /["'](?:arguments|input|parameters|args)["']\s*:/.test(after)) return name
    }
  }

  return null
}

/** The correction handed back to a model that printed a tool call as text. */
export const PSEUDO_TOOL_CORRECTION =
  'پاسخ قبلی‌ات یک فراخوانی ابزار به‌شکل متن یا JSON بود و بنابراین اجرا نشد و نادیده گرفته می‌شود. ' +
  'ابزارها فقط از طریق سازوکار رسمی tool call همین API اجرا می‌شوند. ' +
  'حالا همان ابزار را واقعاً صدا بزن و هیچ متنی ننویس. ' +
  'اگر واقعاً نمی‌توانی ابزار را فراخوانی کنی، در یک جمله همین را بگو و هیچ payload نمونه‌ای نساز.'

/** Shown to the user when the model still refuses to make a real tool call. */
export const PSEUDO_TOOL_FAILURE =
  'این مدل فراخوانی واقعی ابزار را انجام نمی‌دهد؛ به‌جای اجرای ابزار، متن یا JSON نمونه تولید کرد. ' +
  'هیچ فایلی خوانده یا تغییر داده نشد. یک مدل با پشتیبانی از function calling انتخاب کنید و دوباره تلاش کنید.'
