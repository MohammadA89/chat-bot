export type Provider = 'openai' | 'anthropic'

export type Role = 'user' | 'assistant' | 'system'

export interface ApiConfig {
  provider: Provider
  baseUrl: string
  apiKey: string
}

export interface BridgeConfig {
  baseUrl: string
  token: string
}

export interface BridgeCapabilities {
  read: boolean
  write: boolean
  shell: boolean
  githubWrite: boolean
  /** The sidecar is pushing live file-change events over `/events`. */
  watch: boolean
}

/** An editor the sidecar found next to the workspace. */
export interface EditorInfo {
  id: 'vscode' | 'cursor' | 'windsurf'
  name: string
  cli: string
  /** Its command-line launcher is on PATH, so files can be opened remotely. */
  cliAvailable: boolean
  /** The workspace carries this editor's config folder (`.vscode`, `.cursor`…). */
  workspaceMarker: boolean
}

export interface BridgeStatus {
  connected: boolean
  version?: string
  platform?: string
  workspace: { name: string; root: string }
  editors?: EditorInfo[]
  git: { available: boolean; branch?: string; remote?: string; ahead?: number; behind?: number }
  github: { available: boolean; login?: string }
  capabilities: BridgeCapabilities
}

/* ------------------------------- workspace -------------------------------- */

export interface WorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size?: number
  modifiedAt?: number
  binary?: boolean
}

export interface WorkspaceFile {
  path: string
  content: string
  size: number
  totalLines: number
  offset?: number
  partial?: boolean
  modifiedAt?: number
}

export interface GitFileChange {
  path: string
  from?: string
  staged: boolean
  index: string | null
  worktree: string | null
  untracked: boolean
}

export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  files: GitFileChange[]
  clean: boolean
}

export interface GitCommit {
  hash: string
  short: string
  author: string
  when: string
  subject: string
  refs: string
}

export interface ShellJob {
  id: string
  command: string
  cwd: string
  running: boolean
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  bytes: number
  /** Filled in by `shell.poll`; the panel appends each chunk it receives. */
  output?: string
}

/** The result of a mutating workspace call — always carries a reviewable diff. */
export interface EditResult {
  path: string
  bytes: number
  created?: boolean
  applied?: boolean
  replacements?: number
  diff: string
  added: number
  removed: number
}

/** A live event pushed from the sidecar over `/events`. */
export type BridgeEvent =
  | { type: 'ready'; payload: { version: string }; at: number }
  | { type: 'fs.change'; payload: { path: string }; at: number }
  | { type: 'job.output'; payload: { id: string; chunk: string }; at: number }
  | { type: 'job.end'; payload: ShellJob; at: number }

/* ------------------------------- approvals -------------------------------- */

/**
 * How much the model may do to the real workspace without asking.
 * `plan` keeps it read-only, `ask` prompts per action, `auto` trusts it.
 */
export type ApprovalMode = 'plan' | 'ask' | 'auto'

/** One pending permission request raised by a tool call mid-turn. */
export interface ApprovalRequest {
  id: string
  tool: string
  title: string
  /** Short human summary of the target, e.g. the file path or the command. */
  subject: string
  kind: 'write' | 'shell' | 'github'
  /** Unified diff for edits, command text for shell, JSON for the rest. */
  preview?: string
  previewKind?: 'diff' | 'command' | 'text'
}

export interface ModelInfo {
  id: string
  label: string
  owner?: string
  created?: number
}

/** An image the user attached to a message, kept inline as a data URL. */
export interface Attachment {
  id: string
  name: string
  /** e.g. `image/png`. Only image types are accepted today. */
  mimeType: string
  /** Byte size of the (already downscaled) image. */
  size: number
  width?: number
  height?: number
  /** `data:<mime>;base64,…`. Absent when storage had to drop it to fit quota. */
  dataUrl?: string
}

export interface Usage {
  input: number
  output: number
}

/** One tool the harness executed while producing an answer. */
export interface ToolRun {
  id: string
  name: string
  input: Record<string, unknown>
  output: string
  ok: boolean
  at: number
}

export interface Message {
  id: string
  role: Role
  content: string
  /** Chain-of-thought / reasoning text, when the model exposes it. */
  reasoning?: string
  /** Images sent along with this turn. */
  attachments?: Attachment[]
  createdAt: number
  model?: string
  usage?: Usage
  /** Tools the model called on the way to this answer, in order. */
  toolRuns?: ToolRun[]
  /** Set when the request failed; `content` then holds the error text. */
  error?: boolean
  /** Set when the user stopped generation mid-stream. */
  stopped?: boolean
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  createdAt: number
  updatedAt: number
  pinned?: boolean
  /** Project this chat belongs to; `null` for loose chats. */
  projectId?: string | null
  /** Rolling summary of the messages the context window no longer carries. */
  summary?: string
  /** How many leading messages `summary` already covers. */
  summarizedCount?: number
}

/* -------------------------------- projects -------------------------------- */

/** A durable fact the harness keeps about a project. */
export interface ProjectFact {
  id: string
  text: string
  /** `auto` facts were extracted by the model, `manual` ones typed by the user. */
  source: 'auto' | 'manual'
  createdAt: number
  updatedAt: number
}

/** A text document attached to a project and injected as context. */
export interface ProjectFile {
  id: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  description: string
  /** Free-form instructions prepended to the system prompt for this project. */
  instructions: string
  facts: ProjectFact[]
  files: ProjectFile[]
  createdAt: number
  updatedAt: number
}

/* -------------------------------- settings -------------------------------- */

export interface Settings {
  systemPrompt: string
  temperature: number
  maxTokens: number
  streaming: boolean
  theme: 'dark' | 'light'
  sendOnEnter: boolean
  /** Let the model call the harness tools (project memory, files, titles). */
  toolsEnabled: boolean
  /** Extract project facts from the conversation after each answer. */
  autoMemory: boolean
  /** Fold older turns into a rolling summary once the budget is exceeded. */
  autoSummarize: boolean
  /** Approximate token budget for the prompt the harness assembles. */
  contextBudget: number
  /** How much the model may change in the real workspace without confirmation. */
  approvalMode: ApprovalMode
  /** Keep the workspace panel docked next to the conversation. */
  workspacePanel: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt:
    'تو یک دستیار هوشمند، دقیق و حرفه‌ای هستی. پاسخ‌ها را ساختارمند و خوانا بنویس: از عنوان‌بندی، فهرست و جدول در جای مناسب استفاده کن، کدها را همیشه داخل بلوک کد با مشخص کردن زبان قرار بده، و روابط ریاضی را با LaTeX بنویس. مختصر اما کامل باش و از حاشیه‌روی بپرهیز.',
  temperature: 0.7,
  maxTokens: 4096,
  streaming: true,
  theme: 'dark',
  sendOnEnter: true,
  toolsEnabled: true,
  autoMemory: true,
  autoSummarize: true,
  contextBudget: 12000,
  approvalMode: 'ask',
  workspacePanel: true,
}
