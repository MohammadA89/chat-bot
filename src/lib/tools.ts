import type { ToolSpec } from './api'
import type {
  ApprovalMode,
  ApprovalRequest,
  BridgeStatus,
  Project,
  ProjectFact,
  ProjectFile,
} from '../types'
import { uid } from './utils'

/**
 * The world the tools act on. The harness owns a mutable draft of the project
 * so several tool calls inside one turn see each other's writes, and pushes the
 * draft back into React state through `setProject`.
 */
export interface ToolEnv {
  getProject(): Project | null
  setProject(next: Project): void
  renameConversation(title: string): void
  searchChats(query: string): Array<{ title: string; snippet: string; updatedAt: number }>
  bridge?: {
    status: BridgeStatus
    call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
    /** How much the model may change without asking; see `ApprovalMode`. */
    mode: ApprovalMode
    /** Resolves once the user answers the permission prompt. */
    approve(request: Omit<ApprovalRequest, 'id'>): Promise<boolean>
    /** Called after a mutation lands, so the panel can refresh its views. */
    onWorkspaceChange?(path?: string): void
  }
}

const NO_PROJECT = 'این گفتگو به هیچ پروژه‌ای وصل نیست، پس حافظه و فایل‌های پروژه در دسترس نیستند.'

const PROJECT_TOOLS: ToolSpec[] = [
  {
    name: 'remember',
    description:
      'ذخیره‌ی حقایق پایدار و مهم درباره‌ی این پروژه در حافظه‌ی بلندمدت (مثل تصمیم‌های معماری، نام‌ها، ترجیحات کاربر، محدودیت‌ها). فقط چیزهایی را ذخیره کن که در گفتگوهای بعدی هم به درد می‌خورند. حقایق موقتی یا تکراری را ذخیره نکن.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: { type: 'string' },
          description: 'فهرست حقایق کوتاه و مستقل، هرکدام یک جمله‌ی کامل.',
        },
      },
      required: ['facts'],
    },
  },
  {
    name: 'forget',
    description:
      'حذف یک حقیقت از حافظه‌ی پروژه وقتی نادرست یا منسوخ شده است. شناسه را از فهرست حافظه در پیام سیستمی بردار.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'شناسه‌ی حقیقت، مثل f3' } },
      required: ['id'],
    },
  },
  {
    name: 'read_project_file',
    description:
      'خواندن کامل یک فایل متنی پروژه. وقتی محتوای فایل در پیام سیستمی کوتاه شده یا اصلاً نیامده است از این استفاده کن.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'نام دقیق فایل' } },
      required: ['name'],
    },
  },
  {
    name: 'write_project_file',
    description:
      'ساخت یا بازنویسی یک فایل متنی در پروژه (مثل مشخصات فنی، طرح کار، یادداشت). محتوای قبلی فایل هم‌نام بازنویسی می‌شود.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'نام فایل، مثلاً spec.md' },
        content: { type: 'string', description: 'محتوای کامل فایل' },
      },
      required: ['name', 'content'],
    },
  },
]

const GLOBAL_TOOLS: ToolSpec[] = [
  {
    name: 'search_chats',
    description:
      'جستجو در گفتگوهای قبلی کاربر بر اساس یک عبارت. برای یادآوری چیزی که کاربر قبلاً گفته یا پیدا کردن کار قبلی مفید است.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'عبارت جستجو' } },
      required: ['query'],
    },
  },
  {
    name: 'set_chat_title',
    description: 'تغییر عنوان گفتگوی جاری به عنوانی کوتاه و گویا (حداکثر ۶ کلمه).',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'عنوان جدید' } },
      required: ['title'],
    },
  },
]

const WORKSPACE_READ_TOOLS: ToolSpec[] = [
  {
    name: 'workspace_list',
    description:
      'فهرست فایل‌ها و پوشه‌های Workspace واقعی که در VS Code یا Cursor باز است. برای شناخت ساختار پروژه قبل از تغییر کد استفاده کن.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی پوشه؛ پیش‌فرض نقطه است.' },
        depth: { type: 'number', description: 'عمق فهرست از ۰ تا ۵.' },
      },
    },
  },
  {
    name: 'workspace_read',
    description:
      'خواندن یک فایل متنی واقعی از Workspace. برای فایل‌های بلند می‌توانی با offset و limit فقط بخشی از خط‌ها را بگیری. همیشه قبل از ویرایش، فایل را بخوان.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل.' },
        offset: { type: 'number', description: 'شماره‌ی خط شروع از صفر.' },
        limit: { type: 'number', description: 'تعداد خط‌هایی که خوانده می‌شود.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'workspace_search',
    description:
      'جستجوی متن در فایل‌های Workspace با شماره خط و پیش‌نمایش. برای پیدا کردن محل یک تابع، متغیر یا رشته قبل از تغییر کد از این استفاده کن.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'عبارت متنی یا الگوی regex.' },
        path: { type: 'string', description: 'پوشه‌ی نسبی شروع جستجو.' },
        include: { type: 'string', description: 'محدود کردن به الگوی glob، مثل src/**/*.ts' },
        regex: { type: 'boolean', description: 'اگر true باشد query به‌عنوان regex تفسیر می‌شود.' },
        maxResults: { type: 'number', description: 'حداکثر تعداد نتیجه، پیش‌فرض ۶۰.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'workspace_glob',
    description:
      'پیدا کردن فایل‌ها بر اساس الگوی glob مثل **/*.tsx یا src/lib/*.ts. برای شناخت سریع ساختار پروژه بهتر از فهرست کامل است.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'الگوی glob نسبت به ریشه‌ی Workspace.' },
        path: { type: 'string', description: 'پوشه‌ی نسبی شروع؛ پیش‌فرض ریشه.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'open_in_editor',
    description:
      'باز کردن یک فایل Workspace در VS Code یا Cursor کاربر، در صورت تمایل روی یک شماره خط مشخص. وقتی کاربر می‌خواهد جایی از کد را ببیند مفید است.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل.' },
        line: { type: 'number', description: 'شماره خط برای پرش مستقیم.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_status',
    description: 'نمایش branch و فایل‌های تغییرکرده‌ی Git در Workspace.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'git_diff',
    description: 'نمایش diff فعلی Git. می‌توان آن را به یک مسیر نسبی محدود کرد.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی اختیاری.' },
        staged: { type: 'boolean', description: 'اگر true باشد diff فایل‌های staged را نشان می‌دهد.' },
      },
    },
  },
  {
    name: 'git_log',
    description: 'نمایش commitهای اخیر مخزن با نویسنده، زمان و پیام.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'تعداد commit از ۱ تا ۱۰۰.' } },
    },
  },
  {
    name: 'git_branches',
    description: 'فهرست شاخه‌های محلی Git و مشخص کردن شاخه‌ی فعلی.',
    parameters: { type: 'object', properties: {} },
  },
]

const WORKSPACE_WRITE_TOOLS: ToolSpec[] = [
  {
    name: 'workspace_create',
    description:
      'ساخت یک فایل متنی جدید در Workspace. اگر فایل وجود داشته باشد عمداً خطا می‌دهد تا چیزی تصادفی بازنویسی نشود.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل جدید.' },
        content: { type: 'string', description: 'محتوای کامل فایل.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'workspace_write',
    description:
      'بازنویسی کامل محتوای یک فایل موجود در Workspace. فقط وقتی استفاده کن که تغییر آن‌قدر گسترده است که ویرایش جزئی معنا ندارد؛ در غیر این صورت workspace_edit دقیق‌تر و کم‌ریسک‌تر است.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل.' },
        content: { type: 'string', description: 'محتوای کامل و نهایی فایل.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'workspace_edit',
    description:
      'یک قطعه متن دقیق را در فایل واقعی جایگزین می‌کند و diff نتیجه را برمی‌گرداند. قبل از آن فایل را بخوان و oldText را آن‌قدر دقیق بده که یکتا باشد؛ برای جایگزینی همه‌ی تکرارها replaceAll را true کن.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل موجود.' },
        oldText: { type: 'string', description: 'متن دقیق فعلی.' },
        newText: { type: 'string', description: 'متن جایگزین.' },
        replaceAll: { type: 'boolean', description: 'جایگزینی همه‌ی تکرارها به‌جای فقط یکی.' },
      },
      required: ['path', 'oldText', 'newText'],
    },
  },
  {
    name: 'workspace_delete',
    description: 'حذف یک فایل یا پوشه از Workspace. این کار برگشت‌پذیر نیست، پس فقط با درخواست روشن کاربر انجامش بده.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'مسیر نسبی فایل یا پوشه.' } },
      required: ['path'],
    },
  },
  {
    name: 'workspace_rename',
    description: 'تغییر نام یا جابه‌جایی یک فایل یا پوشه داخل Workspace.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'مسیر نسبی فعلی.' },
        to: { type: 'string', description: 'مسیر نسبی مقصد.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'git_stage',
    description: 'اضافه کردن فایل‌های مشخص به ناحیه‌ی staging گیت.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'فهرست مسیرهای نسبی.' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'git_commit',
    description:
      'ثبت commit با پیام داده‌شده. پیام را کوتاه، توصیفی و به سبک مخزن بنویس. بدون درخواست کاربر commit نزن.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'پیام commit.' },
        all: { type: 'boolean', description: 'اگر true باشد همه‌ی فایل‌های تغییرکرده هم stage می‌شوند.' },
      },
      required: ['message'],
    },
  },
]

const SHELL_TOOLS: ToolSpec[] = [
  {
    name: 'terminal_run',
    description:
      'اجرای یک دستور ترمینال داخل Workspace برای build، test، lint یا بررسی پروژه. دستور را کوتاه و غیرتعاملی نگه دار و بعد از تغییر کد، تست یا build مربوطه را اجرا کن.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'دستور قابل اجرا در PowerShell یا sh.' },
        cwd: { type: 'string', description: 'پوشه‌ی نسبی اجرا؛ پیش‌فرض ریشه Workspace.' },
        timeoutMs: { type: 'number', description: 'مهلت اجرا، حداکثر ۱۸۰۰۰۰ میلی‌ثانیه.' },
      },
      required: ['command'],
    },
  },
]

const GITHUB_TOOLS: ToolSpec[] = [
  {
    name: 'github_repo',
    description: 'دریافت نام، URL و شاخه‌ی پیش‌فرض مخزن متصل GitHub.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'github_issues',
    description: 'فهرست Issueهای مخزن GitHub متصل.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'تعداد نتیجه از ۱ تا ۵۰.' } },
    },
  },
  {
    name: 'github_issue',
    description: 'خواندن جزئیات یک Issue مشخص GitHub.',
    parameters: {
      type: 'object',
      properties: { number: { type: 'number', description: 'شماره Issue.' } },
      required: ['number'],
    },
  },
  {
    name: 'github_prs',
    description: 'فهرست Pull Requestهای مخزن GitHub متصل.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'تعداد نتیجه از ۱ تا ۵۰.' } },
    },
  },
  {
    name: 'github_pr',
    description: 'خواندن جزئیات یک Pull Request مشخص، شامل شاخه‌ها و فایل‌های تغییرکرده.',
    parameters: {
      type: 'object',
      properties: { number: { type: 'number', description: 'شماره Pull Request.' } },
      required: ['number'],
    },
  },
]

const GITHUB_WRITE_TOOLS: ToolSpec[] = [
  {
    name: 'github_create_issue',
    description: 'ساخت Issue جدید در مخزن متصل. فقط با درخواست روشن کاربر.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان Issue.' },
        body: { type: 'string', description: 'متن کامل Issue به Markdown.' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'github_comment',
    description: 'نوشتن نظر روی یک Issue یا Pull Request موجود.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'شماره Issue یا PR.' },
        body: { type: 'string', description: 'متن نظر.' },
        kind: { type: 'string', description: 'issue یا pr؛ پیش‌فرض issue.' },
      },
      required: ['number', 'body'],
    },
  },
  {
    name: 'github_create_pr',
    description:
      'ساخت Pull Request از شاخه‌ی فعلی. قبل از آن مطمئن شو تغییرات commit و push شده‌اند.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان Pull Request.' },
        body: { type: 'string', description: 'توضیح تغییرات به Markdown.' },
        base: { type: 'string', description: 'شاخه‌ی مقصد؛ پیش‌فرض شاخه‌ی اصلی مخزن.' },
        draft: { type: 'boolean', description: 'ساخت به‌صورت پیش‌نویس.' },
      },
      required: ['title', 'body'],
    },
  },
]

/** The tool set for the current turn — project tools only inside a project. */
export function harnessTools(hasProject: boolean, bridge?: BridgeStatus): ToolSpec[] {
  const tools = hasProject ? [...PROJECT_TOOLS, ...GLOBAL_TOOLS] : [...GLOBAL_TOOLS]
  if (!bridge?.connected) return tools
  tools.push(...WORKSPACE_READ_TOOLS)
  if (bridge.capabilities.write) tools.push(...WORKSPACE_WRITE_TOOLS)
  if (bridge.capabilities.shell) tools.push(...SHELL_TOOLS)
  if (bridge.github.available) tools.push(...GITHUB_TOOLS)
  if (bridge.github.available && bridge.capabilities.githubWrite) tools.push(...GITHUB_WRITE_TOOLS)
  return tools
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function touch(project: Project, patch: Partial<Project>): Project {
  return { ...project, ...patch, updatedAt: Date.now() }
}

export function createFact(text: string, source: ProjectFact['source']): ProjectFact {
  const now = Date.now()
  return { id: uid(), text: text.trim(), source, createdAt: now, updatedAt: now }
}

export function createFile(name: string, content: string): ProjectFile {
  const now = Date.now()
  return { id: uid(), name: name.trim(), content, createdAt: now, updatedAt: now }
}

/** Facts are labelled `f1…fn` in the prompt; the model refers back with those. */
export function factLabel(index: number): string {
  return `f${index + 1}`
}

function normalize(text: string): string {
  return text.replace(/[\s‌]+/g, ' ').trim().toLowerCase()
}

function formatBridgeResult(result: unknown): string {
  if (result && typeof result === 'object') {
    const command = result as { ok?: boolean; stdout?: string; stderr?: string; exitCode?: number }
    if ('stdout' in command || 'stderr' in command) {
      const chunks = [command.stdout?.trim(), command.stderr?.trim()].filter(Boolean)
      return `${chunks.join('\n') || '(بدون خروجی)'}${command.ok === false ? `\nexit code: ${command.exitCode ?? 1}` : ''}`
    }
  }
  return JSON.stringify(result, null, 2)
}

const DENIED = 'کاربر این عملیات را رد کرد. بدون انجام آن ادامه بده و در صورت نیاز راه دیگری پیشنهاد کن.'
const PLAN_ONLY =
  'حالت فعلی «فقط مطالعه» است، پس تغییر در Workspace انجام نمی‌شود. تغییر پیشنهادی‌ات را توضیح بده تا کاربر خودش حالت را عوض کند.'

/**
 * Runs one bridge method, first clearing it with the user when it mutates
 * something. Edits are previewed through `workspace.preview`, so the approval
 * dialog shows the exact diff the model is asking to apply.
 */
async function bridgeTool(
  env: ToolEnv,
  method: string,
  params: Record<string, unknown>,
  gate?: Omit<ApprovalRequest, 'id' | 'preview' | 'previewKind'> & {
    preview?: string
    previewKind?: ApprovalRequest['previewKind']
    /** Fetches a richer preview (a diff) right before asking. */
    resolvePreview?: () => Promise<string | undefined>
  },
): Promise<{ ok: boolean; output: string }> {
  const bridge = env.bridge
  if (!bridge) return { ok: false, output: 'پل محلی Workspace متصل نیست.' }

  if (gate) {
    if (bridge.mode === 'plan') return { ok: false, output: PLAN_ONLY }
    if (bridge.mode === 'ask') {
      let preview = gate.preview
      if (gate.resolvePreview) {
        try {
          preview = (await gate.resolvePreview()) ?? preview
        } catch (error) {
          // A failed preview is the real failure: report it instead of asking.
          return { ok: false, output: error instanceof Error ? error.message : 'پیش‌نمایش تغییر ممکن نبود.' }
        }
      }
      const allowed = await bridge.approve({
        tool: gate.tool,
        title: gate.title,
        subject: gate.subject,
        kind: gate.kind,
        preview,
        previewKind: gate.previewKind ?? (preview ? 'diff' : undefined),
      })
      if (!allowed) return { ok: false, output: DENIED }
    }
  }

  try {
    const result = await bridge.call(method, params)
    if (gate) bridge.onWorkspaceChange?.(typeof params.path === 'string' ? params.path : undefined)
    return { ok: true, output: formatBridgeResult(result) }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : 'اجرای ابزار Workspace ناموفق بود.' }
  }
}

/**
 * Adds facts to a project, skipping ones it already knows. Shared by the
 * `remember` tool and the background memory extraction.
 */
export function addFacts(
  project: Project,
  texts: string[],
  source: ProjectFact['source'],
): { project: Project; added: ProjectFact[] } {
  const seen = new Set(project.facts.map((f) => normalize(f.text)))
  const added: ProjectFact[] = []

  for (const raw of texts) {
    const text = raw.trim()
    if (text.length < 3 || seen.has(normalize(text))) continue
    seen.add(normalize(text))
    added.push(createFact(text, source))
  }

  if (added.length === 0) return { project, added }
  return { project: touch(project, { facts: [...project.facts, ...added] }), added }
}

/** Executes one tool call and returns the text the model will see as its result. */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  env: ToolEnv,
): Promise<{ ok: boolean; output: string }> {
  const project = env.getProject()

  switch (name) {
    case 'remember': {
      if (!project) return { ok: false, output: NO_PROJECT }
      const incoming = (Array.isArray(args.facts) ? args.facts : [])
        .map((f) => (typeof f === 'string' ? f.trim() : ''))
        .filter((f) => f.length > 2)
      if (incoming.length === 0) return { ok: false, output: 'هیچ حقیقتی برای ذخیره داده نشد.' }

      const { project: next, added } = addFacts(project, incoming, 'auto')
      if (added.length === 0) return { ok: true, output: 'این موارد از قبل در حافظه بودند.' }

      env.setProject(next)
      return { ok: true, output: `${added.length} مورد در حافظه‌ی پروژه «${project.name}» ذخیره شد.` }
    }

    case 'forget': {
      if (!project) return { ok: false, output: NO_PROJECT }
      const id = str(args, 'id')
      const index = /^f\d+$/i.test(id)
        ? Number(id.slice(1)) - 1
        : project.facts.findIndex((f) => f.id === id)
      const fact = project.facts[index]
      if (!fact) return { ok: false, output: `حقیقتی با شناسه‌ی «${id}» پیدا نشد.` }

      env.setProject(touch(project, { facts: project.facts.filter((f) => f.id !== fact.id) }))
      return { ok: true, output: `حذف شد: ${fact.text}` }
    }

    case 'read_project_file': {
      if (!project) return { ok: false, output: NO_PROJECT }
      const name_ = normalize(str(args, 'name'))
      const file = project.files.find((f) => normalize(f.name) === name_)
      if (!file) {
        const list = project.files.map((f) => f.name).join('، ') || '—'
        return { ok: false, output: `فایلی با این نام نیست. فایل‌های موجود: ${list}` }
      }
      return { ok: true, output: file.content || '(فایل خالی است)' }
    }

    case 'write_project_file': {
      if (!project) return { ok: false, output: NO_PROJECT }
      const fileName = str(args, 'name')
      const content = typeof args.content === 'string' ? args.content : ''
      if (!fileName) return { ok: false, output: 'نام فایل داده نشد.' }

      const existing = project.files.find((f) => normalize(f.name) === normalize(fileName))
      const files = existing
        ? project.files.map((f) =>
            f.id === existing.id ? { ...f, content, updatedAt: Date.now() } : f,
          )
        : [...project.files, createFile(fileName, content)]

      env.setProject(touch(project, { files }))
      return {
        ok: true,
        output: `${existing ? 'به‌روزرسانی شد' : 'ساخته شد'}: ${fileName} (${content.length} نویسه)`,
      }
    }

    case 'search_chats': {
      const query = str(args, 'query')
      if (!query) return { ok: false, output: 'عبارت جستجو خالی است.' }
      const hits = env.searchChats(query)
      if (hits.length === 0) return { ok: true, output: `نتیجه‌ای برای «${query}» پیدا نشد.` }
      return {
        ok: true,
        output: hits
          .slice(0, 5)
          .map((h) => `• ${h.title} — ${h.snippet}`)
          .join('\n'),
      }
    }

    case 'set_chat_title': {
      const title = str(args, 'title')
      if (!title) return { ok: false, output: 'عنوان خالی است.' }
      env.renameConversation(title.slice(0, 60))
      return { ok: true, output: `عنوان گفتگو به «${title}» تغییر کرد.` }
    }

    /* ------------------------------ read-only ------------------------------ */

    case 'workspace_list':
      return bridgeTool(env, 'workspace.list', { path: str(args, 'path') || '.', depth: args.depth })
    case 'workspace_read':
      return bridgeTool(env, 'workspace.read', {
        path: str(args, 'path'),
        offset: args.offset,
        limit: args.limit,
      })
    case 'workspace_search':
      return bridgeTool(env, 'workspace.search', {
        query: str(args, 'query'),
        path: str(args, 'path') || '.',
        include: str(args, 'include') || undefined,
        regex: args.regex === true,
        maxResults: args.maxResults,
      })
    case 'workspace_glob':
      return bridgeTool(env, 'workspace.glob', {
        pattern: str(args, 'pattern'),
        path: str(args, 'path') || '.',
      })
    case 'open_in_editor':
      return bridgeTool(env, 'editor.open', { path: str(args, 'path'), line: args.line })
    case 'git_status':
      return bridgeTool(env, 'git.status', {})
    case 'git_diff':
      return bridgeTool(env, 'git.diff', { path: str(args, 'path'), staged: args.staged === true })
    case 'git_log':
      return bridgeTool(env, 'git.log', { limit: args.limit })
    case 'git_branches':
      return bridgeTool(env, 'git.branches', {})

    /* ------------------------------ mutations ------------------------------ */

    case 'workspace_create': {
      const path = str(args, 'path')
      const content = typeof args.content === 'string' ? args.content : ''
      return bridgeTool(env, 'workspace.create', { path, content }, {
        tool: name,
        kind: 'write',
        title: 'ساخت فایل جدید',
        subject: path,
        preview: content.split('\n').slice(0, 200).map((line) => `+${line}`).join('\n'),
        previewKind: 'diff',
      })
    }

    case 'workspace_write': {
      const path = str(args, 'path')
      const content = typeof args.content === 'string' ? args.content : ''
      return bridgeTool(env, 'workspace.write', { path, content }, {
        tool: name,
        kind: 'write',
        title: 'بازنویسی کامل فایل',
        subject: path,
        preview: content.split('\n').slice(0, 200).join('\n'),
        previewKind: 'text',
      })
    }

    case 'workspace_edit': {
      const params = {
        path: str(args, 'path'),
        oldText: typeof args.oldText === 'string' ? args.oldText : '',
        newText: typeof args.newText === 'string' ? args.newText : '',
        replaceAll: args.replaceAll === true,
      }
      return bridgeTool(env, 'workspace.edit', params, {
        tool: name,
        kind: 'write',
        title: 'ویرایش فایل',
        subject: params.path,
        previewKind: 'diff',
        resolvePreview: async () => {
          const preview = await env.bridge!.call<{ diff: string }>('workspace.preview', params)
          return preview.diff
        },
      })
    }

    case 'workspace_delete': {
      const path = str(args, 'path')
      return bridgeTool(env, 'workspace.delete', { path }, {
        tool: name,
        kind: 'write',
        title: 'حذف از Workspace',
        subject: path,
        preview: `این مسیر برای همیشه حذف می‌شود:\n${path}`,
        previewKind: 'text',
      })
    }

    case 'workspace_rename': {
      const from = str(args, 'from')
      const to = str(args, 'to')
      return bridgeTool(env, 'workspace.rename', { from, to }, {
        tool: name,
        kind: 'write',
        title: 'تغییر نام یا جابه‌جایی',
        subject: `${from} → ${to}`,
        previewKind: 'text',
      })
    }

    case 'git_stage': {
      const paths = (Array.isArray(args.paths) ? args.paths : [])
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
      if (!paths.length) return { ok: false, output: 'هیچ مسیری برای stage داده نشد.' }
      return bridgeTool(env, 'git.add', { paths }, {
        tool: name,
        kind: 'write',
        title: 'افزودن به staging گیت',
        subject: paths.join('، '),
        previewKind: 'text',
      })
    }

    case 'git_commit': {
      const message = str(args, 'message')
      if (!message) return { ok: false, output: 'پیام commit خالی است.' }
      return bridgeTool(env, 'git.commit', { message, all: args.all === true }, {
        tool: name,
        kind: 'write',
        title: 'ثبت commit',
        subject: message.split('\n')[0],
        preview: message,
        previewKind: 'text',
      })
    }

    case 'terminal_run': {
      const command = str(args, 'command')
      const cwd = str(args, 'cwd') || '.'
      if (!command) return { ok: false, output: 'دستور ترمینال خالی است.' }
      return bridgeTool(env, 'shell.run', { command, cwd, timeoutMs: args.timeoutMs }, {
        tool: name,
        kind: 'shell',
        title: 'اجرای دستور ترمینال',
        subject: cwd === '.' ? command : `${command}  (در ${cwd})`,
        preview: command,
        previewKind: 'command',
      })
    }

    /* -------------------------------- github ------------------------------- */

    case 'github_repo':
      return bridgeTool(env, 'github.repo', {})
    case 'github_issues':
      return bridgeTool(env, 'github.issues', { limit: args.limit })
    case 'github_issue':
      return bridgeTool(env, 'github.issue', { number: args.number })
    case 'github_prs':
      return bridgeTool(env, 'github.prs', { limit: args.limit })
    case 'github_pr':
      return bridgeTool(env, 'github.pr', { number: args.number })

    case 'github_create_issue': {
      const title = str(args, 'title')
      const body = typeof args.body === 'string' ? args.body : ''
      return bridgeTool(env, 'github.createIssue', { title, body }, {
        tool: name,
        kind: 'github',
        title: 'ساخت Issue در GitHub',
        subject: title,
        preview: `${title}\n\n${body}`,
        previewKind: 'text',
      })
    }

    case 'github_comment': {
      const body = typeof args.body === 'string' ? args.body : ''
      const kind = str(args, 'kind') === 'pr' ? 'pr' : 'issue'
      return bridgeTool(env, 'github.comment', { number: args.number, body, kind }, {
        tool: name,
        kind: 'github',
        title: `نظر روی ${kind === 'pr' ? 'Pull Request' : 'Issue'} شماره ${args.number}`,
        subject: body.slice(0, 80),
        preview: body,
        previewKind: 'text',
      })
    }

    case 'github_create_pr': {
      const title = str(args, 'title')
      const body = typeof args.body === 'string' ? args.body : ''
      return bridgeTool(env, 'github.createPr', {
        title, body, base: str(args, 'base') || undefined, draft: args.draft === true,
      }, {
        tool: name,
        kind: 'github',
        title: 'ساخت Pull Request',
        subject: title,
        preview: `${title}\n\n${body}`,
        previewKind: 'text',
      })
    }

    default:
      return { ok: false, output: `ابزار ناشناخته: ${name}` }
  }
}
