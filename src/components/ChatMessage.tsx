import { useMemo, useState } from 'react'
import type { Message } from '../types'
import { Markdown } from './Markdown'
import { hasInlineThinking, splitThinking } from '../lib/thinking'
import { copyText, formatClock, formatNumber } from '../lib/utils'
import { IconAlert, IconBrain, IconCheck, IconChevronLeft, IconCopy, IconImage, IconRefresh, IconWrench } from './Icons'

const TOOL_LABELS: Record<string, string> = {
  workspace_list: 'فهرست فایل‌ها',
  workspace_read: 'خواندن فایل',
  workspace_search: 'جستجو در کد',
  workspace_glob: 'یافتن فایل‌ها',
  workspace_create: 'ساخت فایل',
  workspace_edit: 'ویرایش فایل',
  workspace_write: 'بازنویسی فایل',
  workspace_delete: 'حذف از Workspace',
  workspace_rename: 'تغییر نام فایل',
  open_in_editor: 'باز کردن در ادیتور',
  terminal_run: 'اجرای ترمینال',
  git_status: 'وضعیت Git',
  git_diff: 'تغییرات Git',
  git_log: 'تاریخچه Git',
  git_branches: 'شاخه‌های Git',
  git_stage: 'stage در Git',
  git_commit: 'ثبت commit',
  github_repo: 'مخزن GitHub',
  github_issues: 'Issueهای GitHub',
  github_issue: 'جزئیات Issue',
  github_prs: 'Pull Requestهای GitHub',
  github_pr: 'جزئیات Pull Request',
  github_create_issue: 'ساخت Issue',
  github_comment: 'نظر در GitHub',
  github_create_pr: 'ساخت Pull Request',
  remember: 'حافظه پروژه',
  forget: 'حذف از حافظه',
  read_project_file: 'خواندن فایل پروژه',
  write_project_file: 'نوشتن فایل پروژه',
  search_chats: 'جستجو در گفتگوها',
  set_chat_title: 'عنوان گفتگو',
}

interface ChatMessageProps {
  message: Message
  streaming: boolean
  onRegenerate?: () => void
}

export function ChatMessage({ message, streaming, onRegenerate }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const [showTools, setShowTools] = useState(false)
  /** Data URL of the image opened full-screen, if any. */
  const [preview, setPreview] = useState<string | null>(null)
  const isUser = message.role === 'user'

  // Conversations saved before inline `<think>` blocks were split out still
  // carry them in `content`; peel them apart at render time.
  const { content, reasoning } = useMemo(() => {
    if (isUser || message.error || !hasInlineThinking(message.content)) {
      return { content: message.content, reasoning: message.reasoning?.trim() }
    }
    const split = splitThinking(message.content)
    return {
      content: split.text,
      reasoning: [message.reasoning, split.reasoning].filter(Boolean).join('\n\n').trim(),
    }
  }, [isUser, message.content, message.error, message.reasoning])

  async function handleCopy() {
    if (await copyText(content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  const empty = content.trim() === ''
  /** Reasoning is still arriving and the answer hasn't started. */
  const thinking = streaming && empty && !!reasoning

  return (
    <article className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className={`avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? 'شما' : <IconBrain size={17} />}
      </div>

      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-author">{isUser ? 'شما' : 'دستیار'}</span>
          <span className="msg-meta">{formatClock(message.createdAt)}</span>
          {message.model && !isUser && <span className="msg-badge">{message.model}</span>}
          {message.usage && (
            <span className="msg-badge">
              {formatNumber(message.usage.input)}↑ {formatNumber(message.usage.output)}↓
            </span>
          )}
        </div>

        {reasoning && (
          <div className={`reasoning${thinking ? ' thinking' : ''}`}>
            <button
              className={`reasoning-toggle${showReasoning ? ' open' : ''}`}
              onClick={() => setShowReasoning((v) => !v)}
              aria-expanded={showReasoning}
            >
              <IconBrain />
              <span>{thinking ? 'در حال فکر کردن…' : 'زنجیره‌ی استدلال مدل'}</span>
              <span className="reasoning-hint">{showReasoning ? 'بستن' : 'نمایش'}</span>
              <IconChevronLeft className="chev" />
            </button>
            {showReasoning && (
              <div className="reasoning-content">
                {reasoning}
                {thinking && <span className="caret" />}
              </div>
            )}
          </div>
        )}

        {!!message.toolRuns?.length && (
          <div className="tool-runs">
            <button className="tool-runs-toggle" onClick={() => setShowTools((value) => !value)} aria-expanded={showTools}>
              <IconWrench />
              <span>{formatNumber(message.toolRuns.length)} ابزار اجرا شد</span>
              <span className="reasoning-hint">{showTools ? 'بستن' : 'جزئیات'}</span>
              <IconChevronLeft className={`chev${showTools ? ' open' : ''}`} />
            </button>
            {showTools && <div className="tool-runs-list">
              {message.toolRuns.map((run) => <details key={run.id} className={run.ok ? 'ok' : 'failed'}>
                <summary><span className="tool-state">{run.ok ? '✓' : '!'}</span>{TOOL_LABELS[run.name] ?? run.name}</summary>
                <pre>{run.output}</pre>
              </details>)}
            </div>}
          </div>
        )}

        {!!message.attachments?.length && (
          <div className="msg-attachments">
            {message.attachments.map((attachment) => (
              attachment.dataUrl ? (
                <button
                  key={attachment.id}
                  className="msg-attachment"
                  onClick={() => setPreview(attachment.dataUrl!)}
                  title={attachment.name}
                >
                  <img src={attachment.dataUrl} alt={attachment.name} />
                </button>
              ) : (
                // The image was dropped to keep the saved history inside quota.
                <div className="msg-attachment missing" key={attachment.id} title={attachment.name}>
                  <IconImage size={18} />
                  <span>تصویر ذخیره نشد</span>
                </div>
              )
            ))}
          </div>
        )}

        {message.error ? (
          <div className="alert alert-error">
            <IconAlert />
            <span>{content}</span>
          </div>
        ) : isUser ? (
          <div className="msg-content">{content}</div>
        ) : empty && streaming ? (
          // While the model is thinking the reasoning panel above already shows
          // progress, so the dots would just be noise.
          thinking ? null : (
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
          )
        ) : (
          <div className="msg-content">
            <Markdown content={content} />
            {streaming && <span className="caret" />}
          </div>
        )}

        {message.stopped && <div className="msg-meta">— تولید پاسخ توسط شما متوقف شد.</div>}

        {!streaming && !empty && (
          <div className="msg-actions">
            <button className="msg-action" onClick={handleCopy}>
              {copied ? <IconCheck /> : <IconCopy />}
              {copied ? 'کپی شد' : 'کپی'}
            </button>
            {!isUser && onRegenerate && (
              <button className="msg-action" onClick={onRegenerate}>
                <IconRefresh />
                تولید دوباره
              </button>
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)} role="presentation">
          <img src={preview} alt="" />
        </div>
      )}
    </article>
  )
}
