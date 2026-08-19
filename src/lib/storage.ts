import {
  DEFAULT_SETTINGS,
  type ApiConfig,
  type BridgeConfig,
  type Conversation,
  type Project,
  type Settings,
} from '../types'

const KEYS = {
  config: 'chatbot.apiConfig',
  bridge: 'chatbot.bridgeConfig',
  conversations: 'chatbot.conversations',
  projects: 'chatbot.projects',
  settings: 'chatbot.settings',
  activeId: 'chatbot.activeId',
  activeProjectId: 'chatbot.activeProjectId',
  activeWorkspaceId: 'chatbot.activeWorkspaceId',
  layout: 'chatbot.layout',
} as const

/** Widths of the two docked panels, in pixels. */
export interface Layout {
  sidebarWidth: number
  panelWidth: number
}

export const DEFAULT_LAYOUT: Layout = { sidebarWidth: 288, panelWidth: 440 }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    /* quota exceeded or storage disabled — the app still works in-memory */
    return false
  }
}

/**
 * Attached images dominate the size of a saved history. When the quota says no,
 * the oldest ones are dropped — the message keeps its attachment card, just
 * without the picture — and the write is retried until it fits.
 */
function writeConversations(list: Conversation[]): void {
  if (write(KEYS.conversations, list)) return

  const withImages: Array<{ conversation: number; message: number; index: number }> = []
  const trimmed = list.map((conversation, ci) => ({
    ...conversation,
    messages: conversation.messages.map((message, mi) => {
      if (!message.attachments?.length) return message
      message.attachments.forEach((_, index) => withImages.push({ conversation: ci, message: mi, index }))
      return { ...message, attachments: message.attachments.map((a) => ({ ...a })) }
    }),
  }))

  // Walking backwards drops the tail of the list first — the chats that have
  // gone longest without an update, and within them the newest attachments last.
  for (let i = withImages.length - 1; i >= 0; i--) {
    const at = withImages[i]
    const attachments = trimmed[at.conversation].messages[at.message].attachments
    if (attachments?.[at.index]) delete attachments[at.index].dataUrl
    if (write(KEYS.conversations, trimmed)) return
  }
}

/** Fills in fields added after a conversation was first written to storage. */
function migrateConversation(c: Conversation): Conversation {
  return { projectId: null, ...c }
}

function migrateProject(p: Project): Project {
  return {
    ...p,
    description: p.description ?? '',
    instructions: p.instructions ?? '',
    facts: p.facts ?? [],
    files: p.files ?? [],
    workspaceRoot: p.workspaceRoot ?? null,
    workspaceId: p.workspaceId ?? null,
  }
}

export const storage = {
  loadConfig: (): ApiConfig | null => read<ApiConfig | null>(KEYS.config, null),
  saveConfig: (config: ApiConfig): void => void write(KEYS.config, config),
  clearConfig: () => localStorage.removeItem(KEYS.config),

  loadBridgeConfig: (): BridgeConfig | null => read<BridgeConfig | null>(KEYS.bridge, null),
  saveBridgeConfig: (config: BridgeConfig): void => void write(KEYS.bridge, config),
  clearBridgeConfig: () => localStorage.removeItem(KEYS.bridge),

  loadConversations: (): Conversation[] =>
    read<Conversation[]>(KEYS.conversations, []).map(migrateConversation),
  saveConversations: (list: Conversation[]) => writeConversations(list),

  loadProjects: (): Project[] => read<Project[]>(KEYS.projects, []).map(migrateProject),
  saveProjects: (list: Project[]): void => void write(KEYS.projects, list),

  loadSettings: (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) }),
  saveSettings: (settings: Settings): void => void write(KEYS.settings, settings),

  loadActiveId: (): string | null => read<string | null>(KEYS.activeId, null),
  saveActiveId: (id: string | null): void => void write(KEYS.activeId, id),

  loadActiveProjectId: (): string | null => read<string | null>(KEYS.activeProjectId, null),
  saveActiveProjectId: (id: string | null): void => void write(KEYS.activeProjectId, id),

  loadActiveWorkspaceId: (): string | null => read<string | null>(KEYS.activeWorkspaceId, null),
  saveActiveWorkspaceId: (id: string | null): void => void write(KEYS.activeWorkspaceId, id),

  loadLayout: (): Layout => ({ ...DEFAULT_LAYOUT, ...read<Partial<Layout>>(KEYS.layout, {}) }),
  saveLayout: (layout: Layout): void => void write(KEYS.layout, layout),

  clearAll: () => {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
  },
}
