import { DEFAULT_SETTINGS, type ApiConfig, type Conversation, type Settings } from '../types'

const KEYS = {
  config: 'chatbot.apiConfig',
  conversations: 'chatbot.conversations',
  settings: 'chatbot.settings',
  activeId: 'chatbot.activeId',
} as const

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota exceeded or storage disabled — the app still works in-memory */
  }
}

export const storage = {
  loadConfig: (): ApiConfig | null => read<ApiConfig | null>(KEYS.config, null),
  saveConfig: (config: ApiConfig) => write(KEYS.config, config),
  clearConfig: () => localStorage.removeItem(KEYS.config),

  loadConversations: (): Conversation[] => read<Conversation[]>(KEYS.conversations, []),
  saveConversations: (list: Conversation[]) => write(KEYS.conversations, list),

  loadSettings: (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) }),
  saveSettings: (settings: Settings) => write(KEYS.settings, settings),

  loadActiveId: (): string | null => read<string | null>(KEYS.activeId, null),
  saveActiveId: (id: string | null) => write(KEYS.activeId, id),

  clearAll: () => {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
  },
}
