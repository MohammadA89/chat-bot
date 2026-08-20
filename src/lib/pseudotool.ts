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
  'اعلام کردن اینکه «فایل را می‌خوانیم» یا «این دستور لازم است» هیچ کاری انجام نمی‌دهد؛ فقط خودِ فراخوانی ابزار کار می‌کند. ' +
  'اگر واقعاً نمی‌توانی ابزار را فراخوانی کنی، در یک جمله همین را بگو و هیچ payload نمونه‌ای نساز.'

/** Shown to the user when the model still refuses to make a real tool call. */
export const PSEUDO_TOOL_FAILURE =
  'این مدل فراخوانی واقعی ابزار را انجام نمی‌دهد؛ به‌جای اجرای ابزار، متن یا JSON نمونه تولید کرد. ' +
  'هیچ فایلی خوانده یا تغییر داده نشد. یک مدل با پشتیبانی از function calling انتخاب کنید و دوباره تلاش کنید.'

/**
 * A JSON block that carries *only* tool arguments, with no tool named anywhere:
 *
 *     خواندن فایل README.md
 *     ```json
 *     { "path": "README.md" }
 *     ```
 *
 * The tool name lives in the Persian prose around it, so name-anchored
 * detection walks straight past. What gives it away is the object itself:
 * every key is a tool parameter and there is nothing else in it.
 */
export function detectBareToolArgs(text: string): boolean {
  if (!text.includes('{')) return false

  for (const match of text.matchAll(/{[^{}]*}/g)) {
    const keys = [...match[0].matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/g)].map((k) => k[1])
    if (keys.length === 0 || keys.length > 5) continue
    if (keys.every((key) => ARG_KEYS.includes(key))) return true
  }
  return false
}

/** Verbs a model uses when it commits to an action it is about to take. */
const INTENT =
  /(بخوان|می[‌ ]?خوان|میخوان|بخوانیم|ویرایش کن|اعمال کن|اجرا کن|اضافه کن|نیاز داریم|باید |ابتدا |برای شروع)/

/** Anything that reads as a file this turn was supposed to open. */
const FILE_TOKEN =
  /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|json|md|ya?ml|html|py|go|rs|java|sh|txt)\b/i

/**
 * The quietest version of the same failure: the model announces the tool call
 * in prose — "برای شروع، فایل README.md را می‌خوانیم" — and then simply stops,
 * having called nothing. It reads like a first step; it is the whole turn.
 *
 * Only considered when the turn ran no tool at all, and only for a short reply:
 * a long answer that did the work does not need pushing.
 */
export function detectAnnouncedInaction(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 1500) return false
  return INTENT.test(trimmed) && FILE_TOKEN.test(trimmed)
}

/* -------------------------------------------------------------------------- */
/*                       proposals that were never applied                     */
/* -------------------------------------------------------------------------- */

/**
 * The other half of the same failure: the model *can* call tools — it just read
 * three files — and then answers with a "here are the changes to make" block
 * instead of calling `workspace_edit`. The user sees a diff-looking answer and
 * reasonably believes the file changed. Nothing did.
 */
const EDIT_INTENT =
  /(تغییر|جایگزین|اضافه|اصلاح|ویرایش|به[\u200c ]?روزرسان|بروزرسان|پیشنهاد|replace|update|change|add)/i

/** Tools whose success means a real file was actually touched. */
export const WRITE_TOOLS = [
  'workspace_create',
  'workspace_write',
  'workspace_edit',
  'workspace_delete',
  'workspace_rename',
]

/**
 * Returns the path the answer proposes changing but never changed, or `null`.
 *
 * It only fires on files this very turn opened, so an answer that merely quotes
 * some code cannot be mistaken for a shirked edit: the model looked at the real
 * file, framed a change to it, and stopped short of making it.
 */
export function detectUnappliedEdit(text: string, touchedPaths: string[]): string | null {
  if (!text.trim() || touchedPaths.length === 0) return null
  if (!text.includes('```')) return null
  if (!EDIT_INTENT.test(text)) return null

  for (const path of touchedPaths) {
    if (text.includes(path)) return path
    const base = path.split(/[\\/]/).pop() ?? ''
    if (base.length > 3 && text.includes(base)) return path
  }
  return null
}

/** The nudge handed to a model that described an edit instead of applying it. */
export function unappliedEditCorrection(path: string): string {
  return (
    `تو ابزار ویرایش فایل واقعی را در اختیار داری و «${path}» را همین حالا خوانده‌ای، ` +
    'اما به‌جای اعمال تغییر فقط آن را توصیف کردی؛ بنابراین هیچ فایلی عوض نشد و پاسخ قبلی‌ات نادیده گرفته می‌شود. ' +
    'حالا تغییر را واقعاً با workspace_edit اعمال کن و oldText را عیناً از همان محتوایی بردار که خواندی. ' +
    'اگر تغییر لازم نیست یا کاربر فقط توضیح خواسته، در یک جمله همین را بگو.'
  )
}
