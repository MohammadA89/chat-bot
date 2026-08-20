/**
 * The harness: everything between the user's message and the provider call.
 *
 * It assembles the system prompt (project instructions, long-term memory,
 * project files, rolling summary), keeps the prompt inside a token budget by
 * folding old turns into a summary, runs the tool-calling loop, and afterwards
 * distils durable facts out of the exchange back into project memory.
 */
import {
  complete,
  sendChat,
  toWireMessages,
  type ToolCall,
  type ToolSupport,
  type WireMessage,
} from './api'
import { harnessTools, runTool, factLabel, type ToolEnv } from './tools'
import { detectPseudoToolCall, PSEUDO_TOOL_CORRECTION, PSEUDO_TOOL_FAILURE } from './pseudotool'
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
  WorkspaceInfo,
} from '../types'
import type { ThinkChunk } from './thinking'
import { uid } from './utils'

/** Hard stop for the tool loop, so a confused model can't spin forever. */
export const MAX_TOOL_STEPS = 6

/**
 * How many times a printed-instead-of-called tool invocation is corrected
 * before the turn gives up and tells the user the model can't do this.
 */
export const MAX_PSEUDO_RETRIES = 1

/** Characters of a project file inlined into the prompt before it is trimmed. */
const FILE_INLINE_LIMIT = 2400

/** What one attached image costs the prompt, in the same rough token unit. */
const IMAGE_TOKENS = 800

/** Rough token estimate. Persian text packs fewer characters per token. */
export function estimate(text: string): number {
  return Math.ceil(text.length / 3.2)
}

/** Attached images are billed as tokens too, so the window must count them. */
function imageCost(message: Message): number {
  return (message.attachments?.length ?? 0) * IMAGE_TOKENS
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
function workspaceSection(
  bridge: BridgeStatus,
  workspace: WorkspaceInfo,
  mode: ApprovalMode,
  tree?: string,
): string {
  const editors = (workspace.editors ?? []).filter((editor) => editor.cliAvailable || editor.workspaceMarker)
  const editorNames = editors.length ? editors.map((editor) => editor.name).join(' و ') : 'VS Code یا Cursor'

  const lines = [
    '# محیط برنامه‌نویسی واقعی',
    `Workspace «${workspace.name}» در مسیر ${workspace.root} همین حالا در ${editorNames} کاربر باز است.`,
    'ابزارهای workspace مستقیماً روی همین فایل‌ها کار می‌کنند؛ هر تغییری بلافاصله در ادیتور کاربر دیده می‌شود.',
    workspace.git.available
      ? `Git فعال است؛ شاخه‌ی جاری ${workspace.git.branch ?? 'نامشخص'}${workspace.git.ahead ? ` (${workspace.git.ahead} commit جلوتر)` : ''}.`
      : 'این پوشه مخزن Git نیست، پس ابزارهای git کار نمی‌کنند.',
    workspace.github.available
      ? `GitHub با حساب ${workspace.github.login} متصل است.`
      : 'GitHub متصل نیست؛ درباره‌ی Issue و PR حدس نزن.',
  ]

  if (tree) {
    lines.push(
      '',
      '## ساختار پوشه',
      'این فقط یک نقشه‌ی ناوبری برای پیدا کردن مسیرهاست، نه فهرست کامل و نه محتوای فایل‌ها.',
      'دیدن نام یک فایل در این نقشه به‌هیچ‌وجه یعنی خواندن آن نیست؛ برای هر ادعایی درباره‌ی محتوا اول workspace_read را اجرا کن.',
      tree,
    )
  }

  lines.push(
    '',
    '## روش کار',
    '- قبل از هر تغییر، وضعیت واقعی را ببین: با workspace_glob یا workspace_search محل کد را پیدا کن و با workspace_read فایل را کامل بخوان. هرگز روی حافظه یا حدس ویرایش نکن.',
    '- تغییرها را کوچک و هدفمند نگه دار: workspace_edit با متن دقیق، نه بازنویسی کامل فایل.',
    '- oldText باید عیناً از خروجی همان workspace_read گرفته شود؛ نام بخش یا ساختار فایل را حدس نزن.',
    '- سبک، نام‌گذاری و ساختار فایل‌های موجود را تقلید کن؛ کتابخانه‌ای اضافه نکن مگر اینکه پروژه از قبل داشته باشد.',
    bridge.capabilities.shell
      ? '- بعد از تغییر کد، تست یا build مربوطه را با terminal_run اجرا کن و نتیجه‌ی واقعی را گزارش بده؛ اگر شکست خورد، خودت درستش کن.'
      : '- ترمینال در دسترس نیست، پس نگو تست را اجرا کردی؛ فقط دستور پیشنهادی را به کاربر بگو.',
    '- در پایان خلاصه‌ی کوتاهی از فایل‌های تغییرکرده بده و به مسیرشان اشاره کن.',
  )

  if (!bridge.capabilities.write) {
    lines.push(
      '',
      '## نوشتن غیرفعال است',
      'پل محلی بدون اجازه‌ی نوشتن اجرا شده، پس هیچ ابزار تغییر فایل در اختیار نداری.',
      'اگر کاربر ویرایش خواست، در یک جمله بگو نوشتن در پل محلی خاموش است و تغییر پیشنهادی را به‌شکل diff یا قطعه‌کد نشان بده.',
    )
  }

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

/** How many workspace paths the folder map may list before it is cut short. */
const TREE_ENTRY_LIMIT = 120

/**
 * A shallow map of the workspace, fetched once per turn so the model opens on
 * something real instead of guessing at paths. Best-effort: a bridge that is
 * gone or slow just means no map, never a failed turn.
 */
async function fetchWorkspaceTree(env: ToolEnv): Promise<string | undefined> {
  if (!env.bridge) return undefined

  try {
    const { entries } = await env.bridge.call<{ entries: Array<{ path: string; type: string }> }>(
      'workspace.list',
      { path: '.', depth: 2 },
    )
    if (!entries.length) return undefined

    const shown = entries.slice(0, TREE_ENTRY_LIMIT)
    const lines = shown.map((entry) => `${entry.path}${entry.type === 'directory' ? '/' : ''}`)
    if (entries.length > shown.length) lines.push(`… و ${entries.length - shown.length} مورد دیگر`)
    return lines.join('\n')
  } catch {
    return undefined
  }
}

export interface PromptContext {
  settings: Settings
  project: Project | null
  summary?: string
  model: string
  toolsEnabled: boolean
  bridge?: BridgeStatus
  /** The root this turn is aimed at; without one the workspace section is skipped. */
  workspace?: WorkspaceInfo | null
  /** Shallow folder listing, so the model starts with a map instead of guesses. */
  workspaceTree?: string
  approvalMode?: ApprovalMode
  /** What the capability probe learned about this model's tool calling. */
  toolSupport?: ToolSupport
  /**
   * Why the workspace is out of reach this turn (bridge down, project folder
   * not served, …). Stated plainly so the model reports the real obstacle
   * instead of inventing a file it cannot open.
   */
  workspaceBlocked?: string
}

/**
 * The non-negotiable part of the tool contract. It exists because a printed
 * tool call is indistinguishable from real work to the user: the model must
 * either invoke the tool through the API or say plainly that it cannot.
 */
const TOOL_RULES = [
  '# ابزارها',
  'ابزارها فقط از راه سازوکار رسمی tool call همین API اجرا می‌شوند و نتیجه‌شان به تو برمی‌گردد.',
  '',
  '## قواعد قطعی',
  '- برای اجرای ابزار، خودِ ابزار را فراخوانی کن. هرگز نام ابزار، JSON ورودی یا payload نمونه را داخل متن پاسخ یا بلوک کد ننویس؛ چنین متنی اجرا نمی‌شود و فقط کاربر را گمراه می‌کند.',
  '- تا وقتی خروجی واقعی ابزار را ندیده‌ای، ادعا نکن فایلی را خوانده‌ای، تغییر داده‌ای یا دستوری را اجرا کرده‌ای.',
  '- اگر ابزار لازم در دسترس نیست یا فراخوانی آن شکست خورد، در یک جمله‌ی کوتاه همان مانع واقعی را بگو و کار انجام‌نشده را انجام‌شده جلوه نده.',
  '- ابزارها را بی‌دلیل صدا نزن؛ برای پاسخ به سؤال‌های عمومی نیازی به ابزار نیست.',
  '',
  '## سبک پاسخ',
  '- پاسخ نهایی نتیجه‌محور است: چه چیزی فهمیدی و چه چیزی تغییر کرد.',
  '- روند داخلی، برنامه‌ی گام‌به‌گام، فهرست ابزارهای موجود، آموزش استفاده از ابزار و خلاصه‌ی تکراری ننویس. فعالیت ابزارها جای دیگری به کاربر نشان داده می‌شود.',
  '- وقتی چیزی درباره‌ی پروژه می‌فهمی که در گفتگوهای بعدی هم مهم است، بدون درخواست کاربر آن را با remember ذخیره کن.',
].join('\n')

const TOOL_RULES_UNSUPPORTED = [
  '# ابزارها',
  'بررسی سازگاری نشان داد این مدل فراخوانی ساختاریافته‌ی ابزار را انجام نمی‌دهد، پس عملاً به فایل‌ها، ترمینال و GitHub دسترسی نداری.',
  '- وانمود نکن ابزاری داری. JSON یا payload نمونه نساز.',
  '- اگر کاربر کاری خواست که به ابزار نیاز دارد، در یک جمله بگو این مدل امکان اجرای ابزار ندارد و پیشنهاد بده مدل دیگری انتخاب کند.',
  '- در بقیه‌ی موارد مثل یک دستیار معمولی و مفید پاسخ بده.',
].join('\n')

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
    parts.push(ctx.toolSupport === 'unsupported' ? TOOL_RULES_UNSUPPORTED : TOOL_RULES)
  }

  if (ctx.bridge?.connected && ctx.workspace && ctx.toolSupport !== 'unsupported') {
    parts.push(workspaceSection(ctx.bridge, ctx.workspace, ctx.approvalMode ?? 'ask', ctx.workspaceTree))
  } else if (ctx.workspaceBlocked) {
    parts.push(
      [
        '# Workspace در دسترس نیست',
        ctx.workspaceBlocked,
        'پس هیچ ابزاری برای خواندن یا تغییر فایل‌های واقعی نداری.',
        'اگر کاربر چنین کاری خواست، فقط همین مانع را در یک جمله بگو؛ محتوای فایل را حدس نزن و وانمود نکن کاری انجام شده است.',
      ].join('\n'),
    )
  }

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
  const usable = history.filter(
    (m) => m.role !== 'system' && !m.error && (m.content.trim() !== '' || m.attachments?.length),
  )
  const room = Math.max(1200, budget - reserved)

  const kept: Message[] = []
  let used = 0

  for (let i = usable.length - 1; i >= 0; i--) {
    const cost = estimate(usable[i].content) + 8 + imageCost(usable[i])
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
  /** What the capability probe already knows about this model. */
  toolSupport?: ToolSupport
  /** Fired when the turn itself proves the model can (or cannot) call tools. */
  onToolSupport?: (support: ToolSupport, reason: string) => void
  /** Why the real workspace is unreachable this turn, if it is. */
  workspaceBlocked?: string
}

export interface TurnResult {
  usage?: Usage
  toolRuns: ToolRun[]
  steps: number
  /** Set when the model printed tool calls instead of making them. */
  toolCallingFailed?: boolean
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
  // A model that cannot call tools gets no folder map either — the map would
  // only invite it to narrate a project it can't actually open.
  const workspaceTree =
    req.toolSupport === 'unsupported' ? undefined : await fetchWorkspaceTree(env)
  const systemPrompt = () =>
    buildSystemPrompt({
      settings,
      project,
      summary,
      model,
      toolsEnabled: settings.toolsEnabled,
      bridge: env.bridge?.status,
      workspace: env.bridge?.workspace,
      workspaceTree,
      approvalMode: env.bridge?.mode,
      toolSupport: req.toolSupport,
      workspaceBlocked: req.workspaceBlocked,
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

  // Tools are only offered to a model that can actually call them; pretending
  // otherwise is exactly the failure this guards against.
  const tools =
    settings.toolsEnabled && req.toolSupport !== 'unsupported'
      ? harnessTools(Boolean(project), env.bridge?.status, env.bridge?.workspace)
      : undefined
  const toolNames = tools?.map((tool) => tool.name) ?? []
  const wire: WireMessage[] = [...plan.wire]
  const toolRuns: ToolRun[] = []
  let usage: Usage | undefined
  let steps = 0
  let pseudoRetries = 0
  let toolCallingFailed = false

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
    if (signal.aborted) break

    if (result.toolCalls.length === 0) {
      // The provider produced no structured call. If the text merely *looks*
      // like one, the answer is a fake: drop it, correct the model once, and
      // never parse the printed JSON — only a real call may reach a tool.
      const pretended = tools ? detectPseudoToolCall(roundText, toolNames) : null
      if (!pretended) break

      req.onDelta({ resetText: true })
      if (pseudoRetries >= MAX_PSEUDO_RETRIES) {
        toolCallingFailed = true
        req.onToolSupport?.('unsupported', 'مدل به‌جای فراخوانی ابزار، متن نمونه تولید کرد.')
        req.onDelta({ text: PSEUDO_TOOL_FAILURE })
        break
      }

      pseudoRetries++
      wire.push({ role: 'assistant', content: roundText })
      wire.push({ role: 'user', content: PSEUDO_TOOL_CORRECTION })
      continue
    }

    // A real, structured call came back — this model does support tools.
    if (req.toolSupport !== 'supported') {
      req.onToolSupport?.('supported', 'مدل فراخوانی ساختاریافته‌ی ابزار را برمی‌گرداند.')
    }

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

  return { usage, toolRuns, steps: steps + 1, toolCallingFailed: toolCallingFailed || undefined }
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
