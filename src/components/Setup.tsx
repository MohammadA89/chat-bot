import { useState, type FormEvent } from 'react'
import type { ApiConfig, ModelInfo, Provider } from '../types'
import { listModels, verifyChatAccess } from '../lib/api'
import { IconAlert, IconEye, IconEyeOff, IconInfo, IconKey } from './Icons'
import { toFa } from '../lib/utils'

interface SetupProps {
  initial?: ApiConfig | null
  /** Called once the credentials are proven to work. */
  onConnected: (config: ApiConfig, models: ModelInfo[]) => void
  onCancel?: () => void
}

const PROVIDERS: Array<{ id: Provider; name: string; endpoint: string }> = [
  { id: 'openai', name: 'OpenAI سازگار', endpoint: '/chat/completions' },
  { id: 'anthropic', name: 'Anthropic سازگار', endpoint: '/messages' },
]

export function Setup({ initial, onConnected, onCancel }: SetupProps) {
  const [provider, setProvider] = useState<Provider>(initial?.provider ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = baseUrl.trim() !== '' && apiKey.trim() !== '' && !busy

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const config: ApiConfig = { provider, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }
    setBusy(true)
    setError('')
    try {
      const models = await listModels(config)

      // Listing models is not proof of anything on gateways that leave the
      // catalogue open, so the key is tried on a real one-token completion
      // before the connection is called healthy.
      const rejected = models[0] ? await verifyChatAccess(config, models[0].id) : null
      if (rejected) {
        setError(
          `فهرست مدل‌ها خوانده شد، اما سرویس همین کلید را برای تولید پاسخ رد کرد:\n${rejected.message}`,
        )
        return
      }

      onConnected(config, models)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اتصال ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-brand">
          <div className="setup-logo">
            <IconKey />
          </div>
          <h1 className="setup-title">اتصال به سرویس هوش مصنوعی</h1>
          <p className="setup-sub">
            آدرس سرویس و کلید API خود را وارد کنید. اطلاعات فقط در همین مرورگر ذخیره می‌شود و به هیچ
            سرور دیگری ارسال نمی‌گردد.
          </p>
        </div>

        <form className="setup-form" onSubmit={handleSubmit}>
          <div className="field">
            <label className="field-label">نوع سرویس</label>
            <div className="provider-grid">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`provider-card${provider === p.id ? ' active' : ''}`}
                  onClick={() => setProvider(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span>{p.endpoint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="baseUrl">
              Base URL
            </label>
            <input
              id="baseUrl"
              className="input input-ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              اگر انتهای آدرس <code>/v1</code> نباشد، به‌صورت خودکار اضافه می‌شود.
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="apiKey">
              کلید API
            </label>
            <div className="input-with-action">
              <input
                id="apiKey"
                className="input input-ltr"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="input-reveal"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'پنهان کردن کلید' : 'نمایش کلید'}
              >
                {showKey ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error">
              <IconAlert />
              <span>{toFa(error)}</span>
            </div>
          )}

          <div className="setup-footer">
            <button className="btn btn-primary btn-block" type="submit" disabled={!canSubmit}>
              {busy ? (
                <>
                  <span className="spinner" />
                  در حال بررسی اتصال…
                </>
              ) : (
                'اتصال و دریافت مدل‌ها'
              )}
            </button>

            {onCancel && (
              <button className="btn btn-ghost btn-block" type="button" onClick={onCancel}>
                انصراف
              </button>
            )}

            <div className="setup-note">
              <IconInfo />
              <span>
                لیست مدل‌ها از مسیر <code>GET /models</code> خوانده می‌شود. اگر مرورگر خطای اتصال داد،
                معمولاً یعنی سرویس شما هدرهای CORS را برای دامنه‌ی این صفحه فعال نکرده است.
              </span>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
