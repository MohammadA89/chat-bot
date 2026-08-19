export type Provider = 'openai' | 'anthropic'

export type Role = 'user' | 'assistant' | 'system'

export interface ApiConfig {
  provider: Provider
  baseUrl: string
  apiKey: string
}

export interface ModelInfo {
  id: string
  label: string
  owner?: string
  created?: number
}

export interface Usage {
  input: number
  output: number
}

export interface Message {
  id: string
  role: Role
  content: string
  /** Chain-of-thought / reasoning text, when the model exposes it. */
  reasoning?: string
  createdAt: number
  model?: string
  usage?: Usage
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
}

export interface Settings {
  systemPrompt: string
  temperature: number
  maxTokens: number
  streaming: boolean
  theme: 'dark' | 'light'
  sendOnEnter: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt:
    'تو یک دستیار هوشمند، دقیق و حرفه‌ای هستی. پاسخ‌ها را ساختارمند و خوانا بنویس: از عنوان‌بندی، فهرست و جدول در جای مناسب استفاده کن، کدها را همیشه داخل بلوک کد با مشخص کردن زبان قرار بده، و روابط ریاضی را با LaTeX بنویس. مختصر اما کامل باش و از حاشیه‌روی بپرهیز.',
  temperature: 0.7,
  maxTokens: 4096,
  streaming: true,
  theme: 'dark',
  sendOnEnter: true,
}
