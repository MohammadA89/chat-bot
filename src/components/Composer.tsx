import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { Attachment } from '../types'
import { estimateTokens, toFa } from '../lib/utils'
import {
  ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENTS,
  fileToAttachment,
  formatBytes,
  imageFilesFrom,
} from '../lib/images'
import { IconImage, IconSend, IconStop, IconX } from './Icons'

interface ComposerProps {
  value: string
  attachments: Attachment[]
  streaming: boolean
  disabled: boolean
  sendOnEnter: boolean
  onChange: (value: string) => void
  onAttach: (attachments: Attachment[]) => void
  onRemoveAttachment: (id: string) => void
  onAttachError: (message: string) => void
  onSend: () => void
  onStop: () => void
}

const MAX_HEIGHT = 240

export function Composer({
  value,
  attachments,
  streaming,
  disabled,
  sendOnEnter,
  onChange,
  onAttach,
  onRemoveAttachment,
  onAttachError,
  onSend,
  onStop,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)

  // Grow with the content, then scroll once it hits the cap.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    // Autofocus only where there is a real pointer; on touch it forces the keyboard open.
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (finePointer && !streaming && !disabled) ref.current?.focus()
  }, [streaming, disabled])

  /** Decodes and downscales the picked files, then hands the survivors up. */
  async function addFiles(files: File[]) {
    if (files.length === 0) return
    const room = MAX_ATTACHMENTS - attachments.length
    if (room <= 0) {
      onAttachError(`حداکثر ${toFa(MAX_ATTACHMENTS)} تصویر در هر پیام.`)
      return
    }
    if (files.length > room) onAttachError(`فقط ${toFa(room)} تصویر اول اضافه شد.`)

    setReading(true)
    const accepted: Attachment[] = []
    for (const file of files.slice(0, room)) {
      try {
        accepted.push(await fileToAttachment(file))
      } catch (error) {
        onAttachError(error instanceof Error ? error.message : 'افزودن تصویر ناموفق بود.')
      }
    }
    setReading(false)
    if (accepted.length) onAttach(accepted)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const enterSends = sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey
    if (e.key === 'Enter' && enterSends) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const images = imageFilesFrom(e.clipboardData)
    if (images.length === 0) return
    e.preventDefault()
    void addFiles(images)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (!disabled) void addFiles(imageFilesFrom(e.dataTransfer))
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }

  // A picture on its own is a valid message — the model can be asked about it.
  const canSend = (value.trim() !== '' || attachments.length > 0) && !streaming && !disabled && !reading

  return (
    <div className="composer">
      <div
        className={`composer-box${dragging ? ' dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((attachment) => (
              <figure className="attachment" key={attachment.id}>
                {attachment.dataUrl && <img src={attachment.dataUrl} alt={attachment.name} />}
                <button
                  className="attachment-remove"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  title="حذف تصویر"
                  aria-label={`حذف ${attachment.name}`}
                >
                  <IconX size={12} />
                </button>
                <figcaption title={attachment.name}>{formatBytes(attachment.size)}</figcaption>
              </figure>
            ))}
          </div>
        )}

        <textarea
          ref={ref}
          className="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={disabled ? 'ابتدا یک مدل انتخاب کنید…' : 'پیام خود را بنویسید یا تصویری بچسبانید…'}
          rows={1}
          disabled={disabled}
        />

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])])
            e.target.value = '' // so the same file can be picked twice in a row
          }}
        />
        <button
          className="composer-attach"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || reading || attachments.length >= MAX_ATTACHMENTS}
          title="افزودن تصویر"
          aria-label="افزودن تصویر"
        >
          <IconImage size={17} />
        </button>

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

        {dragging && <div className="composer-drop">تصویر را اینجا رها کنید</div>}
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
        {reading && <span>در حال آماده‌سازی تصویر…</span>}
        {value.trim() !== '' && <span>≈ {toFa(estimateTokens(value))} توکن</span>}
      </div>
    </div>
  )
}
