import { useEffect, useRef } from 'react'
import type { ApprovalRequest } from '../types'
import { DiffView } from './DiffView'
import { IconAlert, IconCheck, IconShield, IconTerminal, IconX } from './Icons'

interface ApprovalDialogProps {
  request: ApprovalRequest
  /** `always` keeps this tool approved for the rest of the session. */
  onDecide(decision: 'allow' | 'always' | 'deny'): void
}

const KIND_LABEL: Record<ApprovalRequest['kind'], string> = {
  write: 'تغییر در فایل‌های واقعی پروژه',
  shell: 'اجرای دستور در ترمینال شما',
  github: 'تغییر در مخزن GitHub شما',
}

/**
 * The permission gate between the model and the user's real machine. It shows
 * exactly what is about to happen — the diff, the command, the payload — before
 * anything touches disk.
 */
export function ApprovalDialog({ request, onDecide }: ApprovalDialogProps) {
  const allowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    allowRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onDecide('deny')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDecide])

  return (
    <div className="overlay">
      <div className="modal approval-modal" role="alertdialog" aria-modal="true" aria-label={request.title}>
        <div className="modal-head">
          {request.kind === 'shell' ? <IconTerminal /> : <IconShield />}
          <h3>{request.title}</h3>
          <span className="approval-tool" dir="ltr">{request.tool}</span>
        </div>

        <div className="modal-body">
          <div className="approval-subject">
            <IconAlert />
            <div>
              <strong>{KIND_LABEL[request.kind]}</strong>
              <span dir="auto">{request.subject}</span>
            </div>
          </div>

          {request.preview && (
            <div className="approval-preview">
              {request.previewKind === 'diff'
                ? <DiffView diff={request.preview} compact />
                : <pre dir={request.previewKind === 'command' ? 'ltr' : 'auto'}>{request.preview}</pre>}
            </div>
          )}
        </div>

        <div className="modal-foot approval-foot">
          <button className="btn btn-primary" ref={allowRef} onClick={() => onDecide('allow')}>
            <IconCheck size={14} /> اجازه بده
          </button>
          <button className="btn btn-outline" onClick={() => onDecide('always')}>
            همیشه برای این ابزار
          </button>
          <button className="btn btn-danger" onClick={() => onDecide('deny')}>
            <IconX size={14} /> رد کن
          </button>
        </div>
      </div>
    </div>
  )
}
