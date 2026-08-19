import { useMemo, useState, type KeyboardEvent } from 'react'
import type { Conversation } from '../types'
import { groupByDate, toFa } from '../lib/utils'
import {
  IconLogout,
  IconMessage,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSun,
  IconTrash,
} from './Icons'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string | null
  collapsed: boolean
  theme: 'dark' | 'light'
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  onDisconnect: () => void
}

export function Sidebar({
  conversations,
  activeId,
  collapsed,
  theme,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onOpenSettings,
  onToggleTheme,
  onDisconnect,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? conversations.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => m.content.toLowerCase().includes(q)),
        )
      : conversations
    const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt)
    return groupByDate(sorted)
  }, [conversations, query])

  function startRename(c: Conversation) {
    setEditingId(c.id)
    setDraft(c.title)
  }

  function commitRename() {
    if (editingId) {
      const title = draft.trim()
      if (title) onRename(editingId, title)
    }
    setEditingId(null)
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setEditingId(null)
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <IconSparkles size={17} />
          </div>
          <span className="sidebar-brand-text">دستیار هوشمند</span>
        </div>

        <button className="new-chat" onClick={onNew}>
          <IconPlus size={17} />
          گفتگوی جدید
        </button>

        <div className="search-box">
          <IconSearch />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو در گفتگوها…"
          />
        </div>
      </div>

      <nav className="history">
        {groups.length === 0 ? (
          <div className="history-empty">
            {query ? 'گفتگویی با این عبارت پیدا نشد.' : 'هنوز گفتگویی ندارید.\nبا «گفتگوی جدید» شروع کنید.'}
          </div>
        ) : (
          groups.map((group) => (
            <div className="history-group" key={group.label}>
              <div className="history-label">{group.label}</div>
              {group.items.map((c) => (
                <div
                  key={c.id}
                  className={`chat-item${c.id === activeId ? ' active' : ''}`}
                  onClick={() => editingId !== c.id && onSelect(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(c.id)}
                >
                  <IconMessage className="chat-item-icon" />
                  <div className="chat-item-title">
                    {editingId === c.id ? (
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={onRenameKey}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      c.title
                    )}
                  </div>
                  {editingId !== c.id && (
                    <div className="chat-item-actions">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startRename(c)
                        }}
                        aria-label="تغییر نام"
                        title="تغییر نام"
                      >
                        <IconPencil />
                      </button>
                      <button
                        className="danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(c.id)
                        }}
                        aria-label="حذف گفتگو"
                        title="حذف"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </nav>

      <div className="sidebar-foot">
        <button className="sidebar-link" onClick={onToggleTheme}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
          {theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}
        </button>
        <button className="sidebar-link" onClick={onOpenSettings}>
          <IconSettings />
          تنظیمات
          <span className="badge">{toFa(conversations.length)}</span>
        </button>
        <button className="sidebar-link" onClick={onDisconnect}>
          <IconLogout />
          تغییر اتصال API
        </button>
      </div>
    </aside>
  )
}
