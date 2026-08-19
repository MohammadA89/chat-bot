/**
 * The harness: everything between the user's message and the provider call.
 *
 * It assembles the system prompt (project instructions, long-term memory,
 * project files, rolling summary), keeps the prompt inside a token budget by
 * folding old turns into a summary, runs the tool-calling loop, and afterwards
 * distils durable facts out of the exchange back into project memory.
 */
import { complete, sendChat, toWireMessages, type ToolCall, type WireMessage } from './api'
import { harnessTools, runTool, factLabel, type ToolEnv } from './tools'
import type {
  ApiConfig,
  ApprovalMode,
  BridgeStatus,
  Conversation,
  Message,
  Project,
  Settings,
  ToolRun,
  Usage,
} from '../types'
import type { ThinkChunk } from './thinking'
import { uid } from './utils'

/** Hard stop for the tool loop, so a confused model can't spin forever. */
export const MAX_TOOL_STEPS = 6

/** Characters of a project file inlined into the prompt before it is trimmed. */
const FILE_INLINE_LIMIT = 2400

/** Rough token estimate. Persian text packs fewer characters per token. */
export function estimate(text: string): number {
  return Math.ceil(text.length / 3.2)
}

/* -------------------------------------------------------------------------- */
/*                              system prompt                                  */
/* -------------------------------------------------------------------------- */

function projectSection(project: Project): string {
  const parts: string[] = [`# پروژه‌ی جاری: ${project.name}`]

  if (project.description.trim()) parts.push(project.description.trim())

  if (project.instructions.trim()) {
    parts.push(`## دستورالعمل‌های پروژه\n${project.instructions.trim()}`)
  }

  if (project.facts.length > 0) {
    const lines = project.facts.map((f, i) => `- [${factLabel(i)}] ${f.text}`)
    parts.push(
      `## حافظه‌ی بلندمدت پروژه\nاین‌ها را از گفتگوهای قبلی می‌دانی. اگر موردی نادرست شد با ابزار forget حذفش کن.\n${lines.join('\n')}`,
    )
  }

  if (project.files.length > 0) {
    const blocks = project.files.map((f) => {
      const clipped = f.content.length > FILE_INLINE_LIMIT
      const body = clipped
        ? `${f.content.slice(0, FILE_INLINE_LIMIT)}\n… (بریده شد — برای متن کامل از ابزار read_project_file استفاده کن)`
        : f.content
      return `### ${f.name}\n${body}`
    })
    parts.push(`## فایل‌های پروژه\n${blocks.join('\n\n')}`)
  }

  return parts.join('\n\n')
}

/**
 * Describes the real machine to the model: what it may touch, which editor is
 * on the other side, and how it is expected to work through a change.
 */
function workspaceSection(bridge: BridgeStatus, mode: ApprovalMode): string {
  const editors = (bridge.editors ?? []).filter((editor) => editor.cliAvailable || editor.workspaceMarker)
  const editorNames = editors.length ? editors.map((editor) => editor.name).join(' و ') : 'VS Code یا Cursor'

  const lines = [
    '# محیط برنامه‌نویسی واقعی',
    `Workspace «${bridge.workspace.name}» در مسیر ${bridge.workspace.root} همین حالا در ${editorNames} کاربر باز است.`,
    'ابزارهای workspace مستقیماً روی همین فایل‌ها کار می‌کنند؛ هر تغییری بلافاصله در ادیتور کاربر دیده می‌شود.',
    bridge.git.available
      ? `Git فعال است؛ شاخه‌ی جاری ${bridge.git.branch ?? 'نامشخص'}${bridge.git.ahead ? ` (${bridge.git.ahead} commit جلوتر)` : ''}.`
      : 'این پوشه مخزن Git نیست، پس ابزارهای git کار نمی‌کنند.',
    bridge.github.available
      ? `GitHub با حساب ${bridge.github.login} متصل است.`
      : 'GitHub متصل نیست؛ درباره‌ی Issue و PR حدس نزن.',
  ]

  lines.push(
    '',
    '## روش کار',
    '- قبل از هر تغییر، وضعیت واقعی را ببین: با workspace_glob یا workspace_search محل کد را پیدا کن و با workspace_read فایل را کامل بخوان. هرگز روی حافظه یا حدس ویرایش نکن.',
    '- تغییرها را کوچک و هدفمند نگه دار: workspace_edit با متن دقیق، نه بازنویسی کامل فایل.',
    '- سبک، نام‌گذاری و ساختار فایل‌های موجود را تقلید کن؛ کتابخانه‌ای اضافه نکن مگر اینکه پروژه از قبل داشته باشد.',
    bridge.capabilities.shell
      ? '- بعد از تغییر کد، تست یا build مربوطه را با terminal_run اجرا کن و نتیجه‌ی واقعی را گزارش بده؛ اگر شکست خورد، خودت درستش کن.'
      : '- ترمینال در دسترس نیست، پس نگو تست را اجرا کردی؛ فقط دستور پیشنهادی را به کاربر بگو.',
    '- در پایان خلاصه‌ی کوتاهی از فایل‌های تغییرکرده بده و به مسیرشان اشاره کن.',
  )

  if (mode === 'plan') {
    lines.push(
      '',
      '## حالت فعلی: فقط مطالعه',
      'اجازه‌ی تغییر نداری. کد را بخوان، مشکل را دقیق تشخیص بده و تغییر پیشنهادی را با diff یا قطعه‌کد در پاسخ نشان بده.',
    )
  } else if (mode === 'ask') {
    lines.push(
      '',
      '## حالت فعلی: با تأیید کاربر',
      'هر تغییر فایل، دستور ترمینال یا عملیات GitHub قبل از اجرا به کاربر نشان داده می‌شود. اگر رد شد اصرار نکن؛ دلیلش را بپرس یا راه دیگری پیشنهاد بده.',
    )
  } else {
    lines.push(
      '',
      '## حالت فعلی: خودگردان',
      'تغییرها بدون پرسش اعمال می‌شوند، پس محتاط باش: چیزی را حذف یا بازنویسی نکن که کاربر نخواسته، و کار خودت را با اجرای تست بررسی کن.',
    )
  }

  return lines.join('\n')
}

export interface PromptContext {
  settings: Settings
  project: Project | null
  summary?: string
  model: string
  toolsEnabled: boolean
  bridge?: BridgeStatus
  approvalMode?: ApprovalMode
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const today = new Date().toLocaleDateString('fa-IR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const parts: string[] = [ctx.settings.systemPrompt.trim()]

  parts.push(`# محیط\nتاریخ امروز: ${today}\nمدل فعال: ${ctx.model}`)

  if (ctx.toolsEnabled) {
    parts.push(
      '# ابزارها\nابزارهایی در اختیار داری. وقتی چیزی درباره‌ی پروژه می‌فهمی که در گفتگوهای آینده هم مهم است، بدون اینکه کاربر بخواهد آن را با remember ذخیره کن. ابزارها را بی‌دلیل صدا نزن و نتیجه‌ی آن‌ها را در پاسخ نهایی به زبان طبیعی توضیح بده.',
    )
  }

  if (ctx.bridge?.connected) parts.push(workspaceSection(ctx.bridge, ctx.approvalMode ?? 'ask'))

  if (ctx.project) parts.push(projectSection(ctx.project))

  if (ctx.summary?.trim()) {
    parts.push(
      `# خلاصه‌ی بخش‌های قدیمی‌تر همین گفتگو\n${ctx.summary.trim()}\n(پیام‌های اصلی این بخش دیگر در زمینه نیستند؛ به این خلاصه تکیه کن.)`,
    )
  }

  return parts.filter(Boolean).join('\n\n')
}

/* -------------------------------------------------------------------------- */
/*                            context window                                   */
/* -------------------------------------------------------------------------- */

export interface ContextPlan {
  wire: WireMessage[]
  /** Messages left out of the window, oldest first — candidates for the summary. */
  dropped: Message[]
  usedTokens: number
}

/**
 * Keeps the newest turns that fit the budget. The last exchange is always kept,
 * even if it alone blows the budget — trimming it would break the answer.
 */
export function planContext(history: Message[], reserved: number, budget: number): ContextPlan {
  const usable = history.filter((m) => m.role !== 'system' && !m.error && m.content.trim() !== '')
  const room = Math.max(1200, budget - reserved)

  const kept: Message[] = []
  let used = 0

  for (let i = usable.length - 1; i >= 0; i--) {
    const cost = estimate(usable[i].content) + 8
    if (kept.length >= 2 && used + cost > room) break
    kept.unshift(usable[i])
    used += cost
  }

  // Anthropic rejects a conversation that opens on an assistant turn.
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift()

  const keptIds = new Set(kept.map((m) => m.id))
  return {
    wire: toWireMessages(kept),
    dropped: usable.filter((m) => !keptIds.has(m.id)),
    usedTokens: used,
  }
}

/** Folds the turns that fell out of the window into a rolling summary. */
export async function summarize(
  config: ApiConfig,
  model: string,
  previous: string | undefined,
  dropped: Message[],
  signal?: AbortSignal,
): Promise<string> {
  const transcript = dropped
    .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.content.slice(0, 1500)}`)
    .join('\n\n')

  const prompt = [
    previous ? `خلاصه‌ی قبلی:\n${previous}\n` : '',
    `بخش تازه‌ی گفتگو:\n${transcript}`,
    '',
    'یک خلاصه‌ی به‌روز از کل گفتگو بنویس که جای پیام‌های اصلی را بگیرد: تصمیم‌ها، اطلاعات مشخص (نام‌ها، اعداد، کدها)، کارهای انجام‌شده و کارهای باقی‌مانده. حداکثر ۲۰۰ کلمه، به شکل فهرست کوتاه، بدون مقدمه.',
  ].join('\n')

  return complete(config, model, 'تو خلاصه‌ساز دقیق گفتگو هستی و فقط خلاصه را برمی‌گردانی.', prompt, {
    maxTokens: 500,
    signal,
  })
}

/* -------------------------------------------------------------------------- */
/*                               the agent loop                                */
/* -------------------------------------------------------------------------- */

export interface TurnRequest {
  config: ApiConfig
  model: string
  settings: Settings
  conversation: Conversation
  project: Project | null
  history: Message[]
  signal: AbortSignal
  env: ToolEnv
  onDelta: (chunk: ThinkChunk) => void
  onToolRun: (run: ToolRun) => void
  /** Fired when old turns were folded away, so the caller can persist it. */
  onSummary?: (summary: string, coveredCount: number) => void
}

export interface TurnResult {
  usage?: Usage
  toolRuns: ToolRun[]
  steps: number
}

function mergeUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b
  if (!b) return a
  return { input: a.input + b.input, output: a.output + b.output }
}

/**
 * Runs one user turn to completion: prompt assembly, optional summarisation,
 * then model → tools → model until the model answers without calling a tool.
 */
export async function runTurn(req: TurnRequest): Promise<TurnResult> {
  const { config, model, settings, project, history, signal, env } = req

  let summary = req.conversation.summary
  const systemPrompt = () =>
    buildSystemPrompt({
      settings,
      project,
      summary,
      model,
      toolsEnabled: settings.toolsEnabled,
      bridge: env.bridge?.status,
      approvalMode: env.bridge?.mode,
    })

  // Reserve room for the assembled system prompt, then fill what is left.
  const plan = planContext(history, estimate(systemPrompt()), settings.contextBudget)

  if (settings.autoSummarize && plan.dropped.length > 0) {
    const covered = req.conversation.summarizedCount ?? 0
    if (plan.dropped.length > covered) {
      try {
        summary = await summarize(config, model, summary, plan.dropped, signal)
        req.onSummary?.(summary, plan.dropped.length)
      } catch {
        /* summarising is best-effort — the turn still runs on the trimmed window */
      }
    }
  }

  const tools = settings.toolsEnabled ? harnessTools(Boolean(project), env.bridge?.status) : undefined
  const wire: WireMessage[] = [...plan.wire]
  const toolRuns: ToolRun[] = []
  let usage: Usage | undefined
  let steps = 0

  for (; steps < MAX_TOOL_STEPS; steps++) {
    let roundText = ''

    const result = await sendChat({
      config,
      model,
      messages: wire,
      systemPrompt: systemPrompt(),
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      stream: settings.streaming,
      signal,
      tools,
      onDelta: (chunk) => {
        if (chunk.text) roundText += chunk.text
        req.onDelta(chunk)
      },
    })

    usage = mergeUsage(usage, result.usage)
    if (result.toolCalls.length === 0 || signal.aborted) break

    wire.push({ role: 'assistant', content: roundText, toolCalls: result.toolCalls })

    for (const call of result.toolCalls) {
      const run = await execute(call, env)
      toolRuns.push(run)
      req.onToolRun(run)
      wire.push({ role: 'tool', toolCallId: call.id, name: call.name, content: run.output })
    }

    // A tool answered, so the next round writes the real reply — separate it
    // from whatever preamble the model already streamed.
    if (roundText.trim()) req.onDelta({ text: '\n\n' })
  }

  return { usage, toolRuns, steps: steps + 1 }
}

async function execute(call: ToolCall, env: ToolEnv): Promise<ToolRun> {
  let input: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(call.arguments || '{}')
    if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
  } catch {
    return {
      id: call.id || uid(),
      name: call.name,
      input: {},
      output: 'ورودی ابزار JSON معتبر نبود.',
      ok: false,
      at: Date.now(),
    }
  }

  try {
    const { ok, output } = await runTool(call.name, input, env)
    return { id: call.id || uid(), name: call.name, input, output, ok, at: Date.now() }
  } catch (err) {
    return {
      id: call.id || uid(),
      name: call.name,
      input,
      output: err instanceof Error ? err.message : 'اجرای ابزار ناموفق بود.',
      ok: false,
      at: Date.now(),
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                            background distillation                          */
/* -------------------------------------------------------------------------- */

/** Pulls the first JSON object out of a model reply that may be fenced or chatty. */
function parseJsonObject(raw: string): any {
  const cleaned = raw.replace(/```json/gi, '```').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Reads one exchange and returns facts worth keeping about the project.
 * Runs after the answer is on screen, so it never delays the reply.
 */
export async function extractFacts(
  config: ApiConfig,
  model: string,
  project: Project,
  exchange: Message[],
  signal?: AbortSignal,
): Promise<string[]> {
  const transcript = exchange
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.content.slice(0, 2000)}`)
    .join('\n\n')

  const known = project.facts.map((f) => `- ${f.text}`).join('\n') || '(خالی)'

  const prompt = [
    `پروژه: ${project.name}`,
    project.description ? `توضیح: ${project.description}` : '',
    `\nحافظه‌ی فعلی:\n${known}`,
    `\nتبادل تازه:\n${transcript}`,
    '',
    'از این تبادل، فقط حقایق پایدار و مهم درباره‌ی پروژه یا ترجیحات کاربر را استخراج کن: تصمیم‌ها، محدودیت‌ها، نام‌ها، ابزارها، سبک کار.',
    'چیزهای زودگذر (سؤال‌های یک‌بارمصرف، توضیح مفاهیم عمومی، محتوای پاسخ) را نادیده بگیر و آنچه در حافظه هست را تکرار نکن.',
    'خروجی فقط JSON با این شکل باشد و هیچ متن دیگری ننویس: {"facts": ["…"]}. اگر چیزی برای ذخیره نیست، آرایه را خالی بگذار.',
  ]
    .filter(Boolean)
    .join('\n')

  const raw = await complete(
    config,
    model,
    'تو یک استخراج‌کننده‌ی حافظه هستی و فقط JSON برمی‌گردانی.',
    prompt,
    { maxTokens: 400, signal },
  )

  const parsed = parseJsonObject(raw)
  const facts = Array.isArray(parsed?.facts) ? parsed.facts : []
  return facts
    .map((f: unknown) => (typeof f === 'string' ? f.trim() : ''))
    .filter((f: string) => f.length > 3)
    .slice(0, 6)
}

/** Names a fresh conversation from its first exchange. */
export async function suggestTitle(
  config: ApiConfig,
  model: string,
  exchange: Message[],
  signal?: AbortSignal,
): Promise<string> {
  const transcript = exchange
    .slice(0, 2)
    .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.content.slice(0, 800)}`)
    .join('\n\n')

  const title = await complete(
    config,
    model,
    'تو فقط یک عنوان کوتاه برمی‌گردانی.',
    `برای این گفتگو یک عنوان فارسی حداکثر ۵ کلمه‌ای بنویس. بدون نقل‌قول، بدون نقطه، فقط خود عنوان.\n\n${transcript}`,
    { maxTokens: 40, signal },
  )

  return title.replace(/^["'«»\s]+|["'«»\s.]+$/g, '').slice(0, 60)
}
