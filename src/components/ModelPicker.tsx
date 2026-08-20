import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelInfo } from '../types'
import type { ToolSupport } from '../lib/api'
import { toFa } from '../lib/utils'
import { IconAlert, IconCheck, IconChevronDown, IconRefresh, IconSearch, IconSparkles, IconWrench } from './Icons'

interface ModelPickerProps {
  models: ModelInfo[]
  value: string
  loading: boolean
  onChange: (id: string) => void
  onRefresh: () => void
  /** Probe verdict for a model — `unknown` until it has been tested. */
  supportOf?: (id: string) => ToolSupport
  /** Why the active model got its verdict; shown under the search box. */
  supportReason?: string
  /** A capability probe is in flight. */
  probing?: boolean
  /** Re-runs the probe for the active model. */
  onProbe?: () => void
}

/** The badge that tells the user whether a model can really run tools. */
function SupportBadge({ support }: { support: ToolSupport }) {
  if (support === 'unknown') return null
  const ok = support === 'supported'
  return (
    <span className={`tool-badge${ok ? ' ok' : ' bad'}`} title={ok ? 'این مدل ابزارها را واقعاً اجرا می‌کند' : 'این مدل فراخوانی ابزار ندارد؛ Workspace با آن کار نمی‌کند'}>
      {ok ? <IconWrench size={11} /> : <IconAlert size={11} />}
      {ok ? 'ابزار' : 'بدون ابزار'}
    </span>
  )
}

export function ModelPicker({
  models, value, loading, onChange, onRefresh, supportOf, supportReason, probing, onProbe,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
  }, [models, query])

  const current = models.find((m) => m.id === value)
  const currentSupport = supportOf?.(value) ?? 'unknown'

  return (
    <div className="model-picker" ref={ref}>
      <button
        className="model-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={loading && models.length === 0}
        title={value || 'انتخاب مدل'}
      >
        <IconSparkles size={15} />
        <span className="model-trigger-name">{current?.label ?? value ?? 'انتخاب مدل'}</span>
        <SupportBadge support={currentSupport} />
        <IconChevronDown size={13} />
      </button>

      {open && (
        <div className="model-menu">
          <div className="model-menu-head">
            <div className="row">
              <strong>انتخاب مدل</strong>
              <span className="count">{toFa(models.length)} مدل</span>
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={onRefresh}
                disabled={loading}
                title="بارگیری مجدد مدل‌ها"
                aria-label="بارگیری مجدد مدل‌ها"
              >
                {loading ? <span className="spinner" /> : <IconRefresh />}
              </button>
            </div>
            <div className="search-box">
              <IconSearch />
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجوی مدل…"
                autoFocus
              />
            </div>
            {onProbe && (
              <div className={`tool-support-row ${currentSupport}`}>
                <span>
                  {probing
                    ? 'در حال بررسی سازگاری ابزار…'
                    : currentSupport === 'supported'
                      ? 'این مدل فراخوانی واقعی ابزار را انجام می‌دهد.'
                      : currentSupport === 'unsupported'
                        ? supportReason || 'این مدل فراخوانی ابزار را انجام نمی‌دهد؛ ابزارهای Workspace با آن کار نمی‌کنند.'
                        : 'سازگاری ابزار این مدل هنوز بررسی نشده است.'}
                </span>
                <button className="btn btn-ghost btn-xs" onClick={onProbe} disabled={probing}>
                  بررسی مجدد
                </button>
              </div>
            )}
          </div>

          <div className="model-list">
            {filtered.length === 0 ? (
              <div className="model-empty">مدلی پیدا نشد.</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  className={`model-option${m.id === value ? ' active' : ''}`}
                  onClick={() => {
                    onChange(m.id)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  <div className="model-option-body">
                    <div className="model-option-name">
                      <span className="model-option-label">{m.label}</span>
                      <SupportBadge support={supportOf?.(m.id) ?? 'unknown'} />
                    </div>
                    <div className="model-option-id">{m.id}</div>
                  </div>
                  {m.id === value && <IconCheck className="check" size={15} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
