import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Conversation, Project } from '../types'
import { groupByDate, toFa } from '../lib/utils'
import {
  IconChevronDown,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconLayers,
  IconLogout,
  IconMessage,
  IconMoon,
  IconPencil,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSparkles,
  IconSun,
  IconTrash,
} from './Icons'

export type SidebarView = { kind: 'chat'; id: string | null } | { kind: 'project'; id: string }

interface SidebarProps {
  conversations: Conversation[]
  projects: Project[]
  activeId: string | null
  activeProjectId: string | null
  collapsed: boolean
  theme: 'dark' | 'light'
  providerLabel: string
  onSelect: (id: string) => void
  onNew: () => void
  onNewProject: () => void
  onOpenProject: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  onMoveToProject: (id: string, projectId: string | null) => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  onToggleCollapse: () => void
  onDisconnect: () => void
}

/** Closes a popover when the next click lands outside of it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return ref
}

export function Sidebar({
  conversations,
  projects,
  activeId,
  activeProjectId,
  collapsed,
  theme,
  providerLabel,
  onSelect,
  onNew,
  onNewProject,
  onOpenProject,
  onRename,
  onDelete,
  onTogglePin,
  onMoveToProject,
  onOpenSettings,
  onToggleTheme,
  onToggleCollapse,
  onDisconnect,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [openSections, setOpenSections] = useState({ pinned: true, projects: true })
  const [expanded, setExpanded] = useState<string[]>([])

  const menuRef = useDismiss(menuId !== null, () => {
    setMenuId(null)
    setMoveOpen(false)
  })
  const accountRef = useDismiss(accountOpen, () => setAccountOpen(false))

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q)),
    )
  }, [conversations, query])

  // A chat belongs either to a project or to the loose list — never both. A
  // chat pointing at a deleted project falls back to loose.
  const known = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const loose = useMemo(
    () => matches.filter((c) => !c.projectId || !known.has(c.projectId)),
    [matches, known],
  )

  const pinned = useMemo(
    () => loose.filter((c) => c.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
    [loose],
  )
  const groups = useMemo(
    () => groupByDate([...loose.filter((c) => !c.pinned)].sort((a, b) => b.updatedAt - a.updatedAt)),
    [loose],
  )

  /** Chats of one project, pinned ones first. */
  const chatsOf = (projectId: string) =>
    matches
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)

  // The project you are working in opens itself, and a search opens every
  // project that has a hit, so matches are never hidden behind a caret.
  const isExpanded = (projectId: string) =>
    expanded.includes(projectId) ||
    (!expanded.includes(`-${projectId}`) &&
      (projectId === activeProjectId || (query.trim() !== '' && chatsOf(projectId).length > 0)))

  function toggleProject(projectId: string) {
    const open = isExpanded(projectId)
    setExpanded((list) => [
      ...list.filter((id) => id !== projectId && id !== `-${projectId}`),
      // A leading dash marks a project the user collapsed by hand.
      open ? `-${projectId}` : projectId,
    ])
  }

  function startRename(c: Conversation) {
    setMenuId(null)
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

  function chatRow(c: Conversation) {
    const open = menuId === c.id
    return (
      <div
        key={c.id}
        className={`chat-item${c.id === activeId ? ' active' : ''}${open ? ' menu-open' : ''}`}
        onClick={() => editingId !== c.id && onSelect(c.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(c.id)}
      >
        {c.pinned ? (
          <IconPinFilled className="chat-item-icon" />
        ) : (
          <IconMessage className="chat-item-icon" />
        )}

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
                setMoveOpen(false)
                setMenuId(open ? null : c.id)
              }}
              aria-label="گزینه‌های بیشتر"
              title="گزینه‌های بیشتر"
            >
              <IconDots size={15} />
            </button>
          </div>
        )}

        {open && (
          <div className="row-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                onTogglePin(c.id)
                setMenuId(null)
              }}
            >
              <IconPin />
              {c.pinned ? 'برداشتن پین' : 'پین کردن'}
            </button>

            <button onClick={() => startRename(c)}>
              <IconPencil />
              تغییر نام
            </button>

            <button onClick={() => setMoveOpen((v) => !v)}>
              <IconFolder />
              انتقال به پروژه
              <IconChevronDown size={13} className={`caret${moveOpen ? ' open' : ''}`} />
            </button>

            {moveOpen && (
              <div className="row-submenu">
                {projects.length === 0 && <span className="row-submenu-empty">پروژه‌ای ندارید</span>}
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onMoveToProject(c.id, p.id)
                      setMenuId(null)
                      setMoveOpen(false)
                    }}
                  >
                    <IconFolder />
                    {p.name}
                  </button>
                ))}
                {c.projectId && (
                  <button
                    onClick={() => {
                      onMoveToProject(c.id, null)
                      setMenuId(null)
                      setMoveOpen(false)
                    }}
                  >
                    خارج کردن از پروژه
                  </button>
                )}
              </div>
            )}

            <button
              className="danger"
              onClick={() => {
                onDelete(c.id)
                setMenuId(null)
              }}
            >
              <IconTrash />
              حذف گفتگو
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <IconSparkles size={16} />
          </div>
          <span className="sidebar-brand-text">دستیار هوشمند</span>
          <button
            className={`icon-btn ghost${searching ? ' on' : ''}`}
            onClick={() => setSearching((v) => !v)}
            title="جستجو"
            aria-label="جستجو در گفتگوها"
          >
            <IconSearch size={16} />
          </button>
          <button
            className="icon-btn ghost"
            onClick={onToggleCollapse}
            title="بستن نوار کناری"
            aria-label="بستن نوار کناری"
          >
            <IconSidebar size={16} />
          </button>
        </div>

        {searching && (
          <div className="search-box">
            <IconSearch />
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در گفتگوها…"
              autoFocus
            />
          </div>
        )}

        <nav className="nav-list">
          <button className="nav-item primary" onClick={onNew}>
            <IconPlus size={16} />
            گفتگوی جدید
          </button>
          <button className="nav-item" onClick={onNewProject}>
            <IconFolderPlus size={16} />
            پروژه‌ی جدید
          </button>
        </nav>
      </div>

      <div className="history">
        {pinned.length > 0 && (
          <section className="side-section">
            <button
              className="side-section-head"
              onClick={() => setOpenSections((s) => ({ ...s, pinned: !s.pinned }))}
            >
              <IconChevronDown size={13} className={`caret${openSections.pinned ? ' open' : ''}`} />
              پین‌شده
              <span className="count">{toFa(pinned.length)}</span>
            </button>
            {openSections.pinned && <div className="side-section-body">{pinned.map(chatRow)}</div>}
          </section>
        )}

        <section className="side-section">
          <button
            className="side-section-head"
            onClick={() => setOpenSections((s) => ({ ...s, projects: !s.projects }))}
          >
            <IconChevronDown size={13} className={`caret${openSections.projects ? ' open' : ''}`} />
            پروژه‌ها
            <span className="count">{toFa(projects.length)}</span>
          </button>

          {openSections.projects && (
            <div className="side-section-body">
              {projects.length === 0 ? (
                <button className="project-item empty" onClick={onNewProject}>
                  <IconLayers />
                  اولین پروژه را بسازید
                </button>
              ) : (
                projects.map((p) => {
                  const chats = chatsOf(p.id)
                  const open = isExpanded(p.id)
                  return (
                    <div className="project-block" key={p.id}>
                      <div className={`project-item${p.id === activeProjectId ? ' active' : ''}`}>
                        <button
                          className="project-caret"
                          onClick={() => toggleProject(p.id)}
                          aria-expanded={open}
                          aria-label={open ? 'بستن گفتگوهای پروژه' : 'نمایش گفتگوهای پروژه'}
                        >
                          <IconChevronDown size={13} className={`caret${open ? ' open' : ''}`} />
                        </button>
                        <button className="project-open" onClick={() => onOpenProject(p.id)}>
                          <IconFolder />
                          <span className="project-item-name">{p.name}</span>
                          <span className="count">{toFa(chats.length)}</span>
                        </button>
                      </div>

                      {open && (
                        <div className="project-chats-tree">
                          {chats.length === 0 ? (
                            <span className="project-tree-empty">هنوز گفتگویی در این پروژه نیست</span>
                          ) : (
                            chats.map(chatRow)
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </section>

        <section className="side-section">
          <div className="side-section-head static">چت‌ها</div>

          {groups.length === 0 ? (
            <div className="history-empty">
              {query
                ? 'گفتگویی با این عبارت پیدا نشد.'
                : 'گفتگویی بیرون از پروژه‌ها ندارید.'}
            </div>
          ) : (
            groups.map((group) => (
              <div className="history-group" key={group.label}>
                <div className="history-label">{group.label}</div>
                {group.items.map(chatRow)}
              </div>
            ))
          )}
        </section>
      </div>

      <div className="sidebar-foot">
        <button className="account" onClick={() => setAccountOpen((v) => !v)}>
          <span className="account-avatar">
            <IconSparkles size={15} />
          </span>
          <span className="account-body">
            <strong>فضای کاری من</strong>
            <span>{providerLabel}</span>
          </span>
          <IconChevronDown size={14} className={`caret${accountOpen ? ' open' : ''}`} />
        </button>

        {accountOpen && (
          <div className="account-menu" ref={accountRef}>
            <button
              onClick={() => {
                onToggleTheme()
                setAccountOpen(false)
              }}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
              {theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}
            </button>
            <button
              onClick={() => {
                onOpenSettings()
                setAccountOpen(false)
              }}
            >
              <IconSettings />
              تنظیمات
            </button>
            <button
              onClick={() => {
                onDisconnect()
                setAccountOpen(false)
              }}
            >
              <IconLogout />
              تغییر اتصال API
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
