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

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota exceeded or storage disabled — the app still works in-memory */
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
  }
}

export const storage = {
  loadConfig: (): ApiConfig | null => read<ApiConfig | null>(KEYS.config, null),
  saveConfig: (config: ApiConfig) => write(KEYS.config, config),
  clearConfig: () => localStorage.removeItem(KEYS.config),

  loadBridgeConfig: (): BridgeConfig | null => read<BridgeConfig | null>(KEYS.bridge, null),
  saveBridgeConfig: (config: BridgeConfig) => write(KEYS.bridge, config),
  clearBridgeConfig: () => localStorage.removeItem(KEYS.bridge),

  loadConversations: (): Conversation[] =>
    read<Conversation[]>(KEYS.conversations, []).map(migrateConversation),
  saveConversations: (list: Conversation[]) => write(KEYS.conversations, list),

  loadProjects: (): Project[] => read<Project[]>(KEYS.projects, []).map(migrateProject),
  saveProjects: (list: Project[]) => write(KEYS.projects, list),

  loadSettings: (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) }),
  saveSettings: (settings: Settings) => write(KEYS.settings, settings),

  loadActiveId: (): string | null => read<string | null>(KEYS.activeId, null),
  saveActiveId: (id: string | null) => write(KEYS.activeId, id),

  loadActiveProjectId: (): string | null => read<string | null>(KEYS.activeProjectId, null),
  saveActiveProjectId: (id: string | null) => write(KEYS.activeProjectId, id),

  loadLayout: (): Layout => ({ ...DEFAULT_LAYOUT, ...read<Partial<Layout>>(KEYS.layout, {}) }),
  saveLayout: (layout: Layout) => write(KEYS.layout, layout),

  clearAll: () => {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
  },
}
