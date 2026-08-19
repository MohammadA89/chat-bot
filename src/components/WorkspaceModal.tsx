import { useState, type FormEvent } from 'react'
import type { ApprovalMode, BridgeConfig, BridgeStatus } from '../types'
import { normalizeBridgeUrl, probeBridge } from '../lib/bridge'
import { copyText } from '../lib/utils'
import {
  IconAlert,
  IconCheck,
  IconCode,
  IconCopy,
  IconGitBranch,
  IconGithub,
  IconShield,
  IconTerminal,
  IconWrench,
  IconX,
} from './Icons'

interface WorkspaceModalProps {
  initial: BridgeConfig | null
  status: BridgeStatus | null
  approvalMode: ApprovalMode
  onApprovalModeChange(mode: ApprovalMode): void
  onConnected(config: BridgeConfig, status: BridgeStatus): void
  onDisconnect(): void
  onClose(): void
}

/** Neutral example path — the real one comes from whatever the user types. */
const PLACEHOLDER_PATH = navigator.userAgent.includes('Windows')
  ? 'D:\\path\\to\\repo'
  : '/path/to/repo'

/** The launch flags, from read-only to a full coding session. */
const PRESETS = [
  {
    id: 'read',
    label: 'فقط خواندن',
    hint: 'کد را می‌خواند و توضیح می‌دهد؛ هیچ فایلی عوض نمی‌شود.',
    flags: '',
  },
  {
    id: 'edit',
    label: 'خواندن و ویرایش',
    hint: 'می‌تواند فایل بسازد و ویرایش کند؛ نتیجه بلافاصله در ادیتور دیده می‌شود.',
    flags: ' --allow-write',
  },
  {
    id: 'full',
    label: 'محیط کامل برنامه‌نویسی',
    hint: 'ویرایش + ترمینال + عملیات GitHub؛ مثل یک همکار که پشت همین دستگاه نشسته است.',
    flags: ' --allow-write --allow-shell --allow-github-write',
  },
] as const

const MODES: Array<{ id: ApprovalMode; label: string; hint: string }> = [
  { id: 'plan', label: 'فقط مطالعه', hint: 'مدل فقط می‌خواند و پیشنهاد می‌دهد؛ هیچ تغییری اعمال نمی‌شود.' },
  { id: 'ask', label: 'با تأیید من', hint: 'قبل از هر تغییر، diff یا دستور را می‌بینید و تصمیم می‌گیرید.' },
  { id: 'auto', label: 'خودگردان', hint: 'تغییرها بدون پرسش اعمال می‌شوند. برای مخزن‌های نسخه‌کنترل‌شده مناسب است.' },
]

export function WorkspaceModal({
  initial,
  status,
  approvalMode,
  onApprovalModeChange,
  onConnected,
  onDisconnect,
  onClose,
}: WorkspaceModalProps) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? 'http://127.0.0.1:4312')
  const [token, setToken] = useState(initial?.token ?? '')
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('full')
  const [workspacePath, setWorkspacePath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const command = `npm run bridge -- --workspace "${workspacePath || PLACEHOLDER_PATH}"${
    PRESETS.find((item) => item.id === preset)!.flags
  }`

  async function copyCommand() {
    if (!(await copyText(command))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function connect(event: FormEvent) {
    event.preventDefault()
    if (!token.trim() || busy) return
    const config = { baseUrl: normalizeBridgeUrl(baseUrl), token: token.trim() }
    setBusy(true)
    setError('')
    try {
      onConnected(config, await probeBridge(config))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'اتصال به Workspace ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal workspace-modal" role="dialog" aria-modal="true" aria-label="اتصال Workspace">
        <div className="modal-head">
          <IconCode />
          <h3>محیط برنامه‌نویسی — VS Code و Cursor</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن"><IconX /></button>
        </div>

        <form onSubmit={connect}>
          <div className="modal-body">
            {status ? <StatusBoard status={status} /> : (
              <p className="field-hint">
                یک سرویس کوچک روی همین دستگاه اجرا می‌شود و فقط همان پوشه‌ای را که در VS Code یا Cursor باز کرده‌اید
                در اختیار دستیار می‌گذارد. هیچ فایلی به اینترنت نمی‌رود.
              </p>
            )}

            <section className="ws-step">
              <h4><span className="ws-step-num">۱</span> سطح دسترسی را انتخاب کنید</h4>
              <div className="ws-presets">
                {PRESETS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`ws-preset${preset === item.id ? ' active' : ''}`}
                    onClick={() => setPreset(item.id)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="ws-step">
              <h4><span className="ws-step-num">۲</span> این دستور را در ترمینال اجرا کنید</h4>
              <div className="field">
                <label className="field-label" htmlFor="wsPath">مسیر پوشه‌ی بازشده در ادیتور</label>
                <input
                  id="wsPath"
                  className="input input-ltr"
                  value={workspacePath}
                  onChange={(event) => setWorkspacePath(event.target.value)}
                  placeholder={PLACEHOLDER_PATH}
                  spellCheck={false}
                />
              </div>
              <div className="bridge-command-row">
                <code dir="ltr">{command}</code>
                <button className="bridge-copy" type="button" onClick={copyCommand} aria-label="کپی دستور راه‌اندازی">
                  {copied ? <IconCheck /> : <IconCopy />}
                  {copied ? 'کپی شد' : 'کپی'}
                </button>
              </div>
              <p className="field-hint">توکن چاپ‌شده در ترمینال را در گام بعد وارد کنید.</p>
            </section>

            <section className="ws-step">
              <h4><span className="ws-step-num">۳</span> اتصال</h4>
              <div className="ws-grid">
                <div className="field">
                  <label className="field-label" htmlFor="bridgeUrl">آدرس پل محلی</label>
                  <input
                    id="bridgeUrl"
                    className="input input-ltr"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="http://127.0.0.1:4312"
                    spellCheck={false}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="bridgeToken">توکن اتصال</label>
                  <input
                    id="bridgeToken"
                    className="input input-ltr"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <p className="field-hint">توکن فقط در همین مرورگر ذخیره می‌شود و هرگز داخل پیام‌های مدل نمی‌رود.</p>
            </section>

            <section className="ws-step">
              <h4><span className="ws-step-num">۴</span> اختیار دستیار روی تغییرها</h4>
              <div className="ws-modes">
                {MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode.id}
                    className={`ws-mode${approvalMode === mode.id ? ' active' : ''}`}
                    onClick={() => onApprovalModeChange(mode.id)}
                  >
                    <IconShield size={14} />
                    <strong>{mode.label}</strong>
                    <span>{mode.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            {error && <div className="alert alert-error"><IconAlert /><span>{error}</span></div>}
          </div>

          <div className="modal-foot">
            <button className="btn btn-primary" type="submit" disabled={!token.trim() || busy}>
              {busy ? <><span className="spinner" />در حال بررسی…</> : status ? 'بررسی دوباره' : 'اتصال و بررسی'}
            </button>
            {initial && <button className="btn btn-danger" type="button" onClick={onDisconnect}>قطع اتصال</button>}
            <button className="btn btn-ghost" type="button" onClick={onClose}>بستن</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Live capability read-out for a connected sidecar. */
function StatusBoard({ status }: { status: BridgeStatus }) {
  const editors = (status.editors ?? []).filter((editor) => editor.cliAvailable || editor.workspaceMarker)

  return (
    <div className="connection-summary">
      <div>
        <IconCheck />
        <span><strong>{status.workspace.name}</strong><small dir="ltr">{status.workspace.root}</small></span>
      </div>
      <div>
        {status.git.available ? <IconGitBranch /> : <IconAlert />}
        <span>
          <strong>Git</strong>
          <small>{status.git.available ? status.git.branch : 'در دسترس نیست'}</small>
        </span>
      </div>
      <div>
        {status.github.available ? <IconGithub /> : <IconAlert />}
        <span>
          <strong>GitHub</strong>
          <small>{status.github.available ? `@${status.github.login}` : 'gh auth login لازم است'}</small>
        </span>
      </div>
      <div>
        {editors.length ? <IconCode /> : <IconAlert />}
        <span>
          <strong>ادیتور</strong>
          <small>{editors.length ? editors.map((editor) => editor.name).join('، ') : 'شناسایی نشد'}</small>
        </span>
      </div>
      <div>
        <IconWrench />
        <span>
          <strong>دسترسی‌ها</strong>
          <small>
            خواندن
            {status.capabilities.write ? '، نوشتن' : ''}
            {status.capabilities.shell ? '، ترمینال' : ''}
            {status.capabilities.githubWrite ? '، GitHub' : ''}
          </small>
        </span>
      </div>
      <div>
        {status.capabilities.watch ? <IconCheck /> : <IconTerminal />}
        <span>
          <strong>هم‌زمانی</strong>
          <small>{status.capabilities.watch ? 'تغییر فایل‌ها زنده دیده می‌شود' : 'بدون رصد زنده'}</small>
        </span>
      </div>
    </div>
  )
}
