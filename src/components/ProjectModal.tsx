import { useMemo, useState } from 'react'
import type { Conversation, Project, ProjectFact, ProjectFile } from '../types'
import { createFact, createFile } from '../lib/tools'
import { timeAgo, toFa, uid } from '../lib/utils'
import {
  IconBrain,
  IconCheck,
  IconFile,
  IconFolder,
  IconMessage,
  IconPlus,
  IconTrash,
  IconX,
} from './Icons'

type Tab = 'overview' | 'memory' | 'files' | 'chats'

interface ProjectModalProps {
  /** `null` while creating a project. */
  project: Project | null
  chats: Conversation[]
  onSave: (project: Project) => void
  onDelete: (id: string) => void
  onOpenChat: (id: string) => void
  onClose: () => void
}

function blankProject(): Project {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    description: '',
    instructions: '',
    facts: [],
    files: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function ProjectModal({
  project,
  chats,
  onSave,
  onDelete,
  onOpenChat,
  onClose,
}: ProjectModalProps) {
  const creating = project === null
  const [draft, setDraft] = useState<Project>(() => project ?? blankProject())
  const [tab, setTab] = useState<Tab>('overview')
  const [newFact, setNewFact] = useState('')
  const [openFileId, setOpenFileId] = useState<string | null>(null)

  const patch = (changes: Partial<Project>) => setDraft((d) => ({ ...d, ...changes }))

  const memoryCount = draft.facts.length
  const autoCount = useMemo(() => draft.facts.filter((f) => f.source === 'auto').length, [draft.facts])

  function addFact() {
    const text = newFact.trim()
    if (!text) return
    patch({ facts: [...draft.facts, createFact(text, 'manual')] })
    setNewFact('')
  }

  function editFact(id: string, text: string) {
    patch({
      facts: draft.facts.map((f) => (f.id === id ? { ...f, text, updatedAt: Date.now() } : f)),
    })
  }

  function removeFact(id: string) {
    patch({ facts: draft.facts.filter((f) => f.id !== id) })
  }

  function addFile() {
    const file = createFile(`سند-${toFa(draft.files.length + 1)}.md`, '')
    patch({ files: [...draft.files, file] })
    setOpenFileId(file.id)
  }

  function editFile(id: string, changes: Partial<ProjectFile>) {
    patch({
      files: draft.files.map((f) => (f.id === id ? { ...f, ...changes, updatedAt: Date.now() } : f)),
    })
  }

  function removeFile(id: string) {
    patch({ files: draft.files.filter((f) => f.id !== id) })
    if (openFileId === id) setOpenFileId(null)
  }

  function save() {
    const name = draft.name.trim()
    if (!name) return
    onSave({ ...draft, name, updatedAt: Date.now() })
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'کلیات' },
    { id: 'memory', label: 'حافظه', count: memoryCount },
    { id: 'files', label: 'فایل‌ها', count: draft.files.length },
    { id: 'chats', label: 'گفتگوها', count: chats.length },
  ]

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <span className="modal-icon">
            <IconFolder size={17} />
          </span>
          <h3>{creating ? 'پروژه‌ی جدید' : draft.name || 'پروژه'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن">
            <IconX />
          </button>
        </div>

        {!creating && (
          <div className="modal-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`modal-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && <span className="count">{toFa(t.count)}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="modal-body">
          {(creating || tab === 'overview') && (
            <>
              <label className="field">
                <span className="field-label">نام پروژه</span>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="مثلاً بازطراحی سایت فروشگاه"
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field-label">توضیح کوتاه</span>
                <input
                  className="input"
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="این پروژه درباره‌ی چیست؟"
                />
              </label>

              <label className="field">
                <span className="field-label">دستورالعمل‌های پروژه</span>
                <textarea
                  className="textarea"
                  rows={6}
                  value={draft.instructions}
                  onChange={(e) => patch({ instructions: e.target.value })}
                  placeholder="در این پروژه چطور جواب بدهم؟ زبان، سبک، استک فنی، محدودیت‌ها…"
                />
                <span className="field-hint">
                  این متن در هر گفتگوی این پروژه به ابتدای پیام سیستمی اضافه می‌شود.
                </span>
              </label>

              {!creating && (
                <div className="project-stats">
                  <span>
                    <IconBrain size={14} />
                    {toFa(memoryCount)} حقیقت در حافظه ({toFa(autoCount)} خودکار)
                  </span>
                  <span>
                    <IconFile size={14} />
                    {toFa(draft.files.length)} فایل
                  </span>
                  <span>
                    <IconMessage size={14} />
                    {toFa(chats.length)} گفتگو
                  </span>
                </div>
              )}
            </>
          )}

          {!creating && tab === 'memory' && (
            <>
              <p className="modal-note">
                هر چه دستیار درباره‌ی این پروژه بفهمد این‌جا می‌ماند و در همه‌ی گفتگوهای پروژه به او
                داده می‌شود. می‌توانید موارد را ویرایش یا حذف کنید.
              </p>

              <div className="memo-add">
                <input
                  className="input"
                  value={newFact}
                  onChange={(e) => setNewFact(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addFact()}
                  placeholder="یک نکته‌ی ماندگار درباره‌ی پروژه بنویسید…"
                />
                <button className="btn btn-primary" onClick={addFact} disabled={!newFact.trim()}>
                  <IconPlus size={15} />
                  افزودن
                </button>
              </div>

              {memoryCount === 0 ? (
                <div className="empty-box">
                  <IconBrain size={22} />
                  هنوز چیزی در حافظه نیست. با گفتگو کردن، دستیار خودش این‌جا را پر می‌کند.
                </div>
              ) : (
                <ul className="memo-list">
                  {draft.facts.map((fact: ProjectFact) => (
                    <li key={fact.id} className="memo-item">
                      <span className={`memo-badge ${fact.source}`}>
                        {fact.source === 'auto' ? 'خودکار' : 'دستی'}
                      </span>
                      <textarea
                        className="memo-text"
                        rows={1}
                        value={fact.text}
                        onChange={(e) => editFact(fact.id, e.target.value)}
                      />
                      <span className="memo-time">{timeAgo(fact.updatedAt)}</span>
                      <button
                        className="icon-btn danger"
                        onClick={() => removeFact(fact.id)}
                        aria-label="حذف"
                        title="حذف"
                      >
                        <IconTrash />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {!creating && tab === 'files' && (
            <>
              <p className="modal-note">
                فایل‌های متنی پروژه در زمینه‌ی گفتگو قرار می‌گیرند؛ فایل‌های بلند بریده می‌شوند و
                دستیار در صورت نیاز کل متن را با ابزار می‌خواند.
              </p>

              <button className="btn btn-outline" onClick={addFile}>
                <IconPlus size={15} />
                فایل جدید
              </button>

              {draft.files.length === 0 ? (
                <div className="empty-box">
                  <IconFile size={22} />
                  هنوز فایلی اضافه نکرده‌اید.
                </div>
              ) : (
                <ul className="file-list">
                  {draft.files.map((file) => (
                    <li key={file.id} className={`file-item${openFileId === file.id ? ' open' : ''}`}>
                      <div className="file-row">
                        <IconFile size={15} />
                        <input
                          className="file-name"
                          value={file.name}
                          onChange={(e) => editFile(file.id, { name: e.target.value })}
                        />
                        <span className="file-size">{toFa(file.content.length)} نویسه</span>
                        <button
                          className="icon-btn"
                          onClick={() => setOpenFileId(openFileId === file.id ? null : file.id)}
                          title={openFileId === file.id ? 'بستن' : 'ویرایش محتوا'}
                        >
                          {openFileId === file.id ? <IconCheck /> : <IconFile />}
                        </button>
                        <button
                          className="icon-btn danger"
                          onClick={() => removeFile(file.id)}
                          aria-label="حذف فایل"
                          title="حذف"
                        >
                          <IconTrash />
                        </button>
                      </div>

                      {openFileId === file.id && (
                        <textarea
                          className="textarea file-content"
                          rows={10}
                          value={file.content}
                          onChange={(e) => editFile(file.id, { content: e.target.value })}
                          placeholder="محتوای فایل…"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {!creating && tab === 'chats' && (
            <>
              {chats.length === 0 ? (
                <div className="empty-box">
                  <IconMessage size={22} />
                  هنوز گفتگویی در این پروژه نیست.
                </div>
              ) : (
                <ul className="project-chats">
                  {[...chats]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((chat) => (
                      <li key={chat.id}>
                        <button onClick={() => onOpenChat(chat.id)}>
                          <IconMessage size={15} />
                          <span className="project-chat-title">{chat.title}</span>
                          <span className="memo-time">{timeAgo(chat.updatedAt)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
            {creating ? 'ساخت پروژه' : 'ذخیره‌ی تغییرات'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            انصراف
          </button>
          {!creating && (
            <button
              className="btn btn-danger foot-end"
              onClick={() => {
                if (window.confirm(`پروژه «${draft.name}» حذف شود؟ گفتگوها باقی می‌مانند.`)) {
                  onDelete(draft.id)
                }
              }}
            >
              <IconTrash />
              حذف پروژه
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
