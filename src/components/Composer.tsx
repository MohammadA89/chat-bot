import { useEffect, useRef, type KeyboardEvent } from 'react'
import { estimateTokens, toFa } from '../lib/utils'
import { IconSend, IconStop } from './Icons'

interface ComposerProps {
  value: string
  streaming: boolean
  disabled: boolean
  sendOnEnter: boolean
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

const MAX_HEIGHT = 240

export function Composer({
  value,
  streaming,
  disabled,
  sendOnEnter,
  onChange,
  onSend,
  onStop,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the content, then scroll once it hits the cap.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    if (!streaming && !disabled) ref.current?.focus()
  }, [streaming, disabled])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const enterSends = sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey
    if (e.key === 'Enter' && enterSends) {
      e.preventDefault()
      if (!streaming && value.trim()) onSend()
    }
  }

  const canSend = value.trim() !== '' && !streaming && !disabled

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={ref}
          className="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'ابتدا یک مدل انتخاب کنید…' : 'پیام خود را بنویسید…'}
          rows={1}
          disabled={disabled}
        />

        {streaming ? (
          <button className="composer-send stop" onClick={onStop} title="توقف تولید" aria-label="توقف تولید">
            <IconStop />
          </button>
        ) : (
          <button
            className="composer-send"
            onClick={onSend}
            disabled={!canSend}
            title="ارسال پیام"
            aria-label="ارسال پیام"
          >
            <IconSend />
          </button>
        )}
      </div>

      <div className="composer-foot">
        <span>
          {sendOnEnter ? (
            <>
              <kbd>Enter</kbd> ارسال · <kbd>Shift</kbd> + <kbd>Enter</kbd> خط جدید
            </>
          ) : (
            <>
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd> ارسال
            </>
          )}
        </span>
        {value.trim() !== '' && <span>≈ {toFa(estimateTokens(value))} توکن</span>}
      </div>
    </div>
  )
}
