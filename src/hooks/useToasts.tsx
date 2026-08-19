import { useCallback, useState } from 'react'
import { uid } from '../lib/utils'
import { IconAlert, IconCheck } from '../components/Icons'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: string
  kind: ToastKind
  text: string
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = uid()
    setToasts((list) => [...list, { id, kind, text }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2800)
  }, [])

  const view = (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <IconAlert size={14} /> : t.kind === 'success' ? <IconCheck size={14} /> : null}
          {t.text}
        </div>
      ))}
    </div>
  )

  return { push, view }
}
