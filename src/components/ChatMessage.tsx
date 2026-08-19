import { useState } from 'react'
import type { Message } from '../types'
import { Markdown } from './Markdown'
import { copyText, formatClock, formatNumber } from '../lib/utils'
import { IconAlert, IconBrain, IconCheck, IconChevronLeft, IconCopy, IconRefresh } from './Icons'

interface ChatMessageProps {
  message: Message
  streaming: boolean
  onRegenerate?: () => void
}

export function ChatMessage({ message, streaming, onRegenerate }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const isUser = message.role === 'user'

  async function handleCopy() {
    if (await copyText(message.content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  const empty = message.content.trim() === ''

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

        {message.reasoning && (
          <div className="reasoning">
            <button
              className={`reasoning-toggle${showReasoning ? ' open' : ''}`}
              onClick={() => setShowReasoning((v) => !v)}
            >
              <IconBrain />
              <span>زنجیره‌ی استدلال مدل</span>
              <IconChevronLeft className="chev" />
            </button>
            {showReasoning && <div className="reasoning-content">{message.reasoning}</div>}
          </div>
        )}

        {message.error ? (
          <div className="alert alert-error">
            <IconAlert />
            <span>{message.content}</span>
          </div>
        ) : isUser ? (
          <div className="msg-content">{message.content}</div>
        ) : empty && streaming ? (
          <div className="typing">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="msg-content">
            <Markdown content={message.content} />
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
    </article>
  )
}
