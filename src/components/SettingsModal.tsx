import { useState } from 'react'
import type { ApiConfig, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { normalizeBaseUrl } from '../lib/api'
import { toFa } from '../lib/utils'
import { IconSettings, IconX } from './Icons'

interface SettingsModalProps {
  settings: Settings
  config: ApiConfig
  onSave: (settings: Settings) => void
  onClose: () => void
  onClearHistory: () => void
}

export function SettingsModal({
  settings,
  config,
  onSave,
  onClose,
  onClearHistory,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<Settings>(settings)

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="تنظیمات">
        <div className="modal-head">
          <IconSettings />
          <h3>تنظیمات</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن">
            <IconX />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor="sys">
              دستور سیستمی (System Prompt)
            </label>
            <textarea
              id="sys"
              className="textarea"
              rows={5}
              value={draft.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              placeholder="مثلاً: تو یک دستیار فارسی‌زبان و دقیق هستی…"
            />
            <p className="field-hint">لحن و سبک پاسخ‌های دستیار را تعیین می‌کند.</p>
          </div>

          <div className="field">
            <label className="field-label">
              خلاقیت (Temperature) — {toFa(draft.temperature.toFixed(1))}
            </label>
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onChange={(e) => set('temperature', Number(e.target.value))}
              />
              <output>{draft.temperature.toFixed(1)}</output>
            </div>
            <p className="field-hint">مقدار کمتر پاسخ‌های دقیق‌تر و مقدار بیشتر پاسخ‌های خلاقانه‌تر می‌دهد.</p>
          </div>

          <div className="field">
            <label className="field-label">بیشینه‌ی توکن پاسخ</label>
            <div className="slider-row">
              <input
                type="range"
                min={256}
                max={32768}
                step={256}
                value={draft.maxTokens}
                onChange={(e) => set('maxTokens', Number(e.target.value))}
              />
              <output>{draft.maxTokens}</output>
            </div>
          </div>

          <div className="switch-row">
            <div>
              <div className="field-label">پاسخ لحظه‌ای (Streaming)</div>
              <p className="field-hint">متن هم‌زمان با تولید شدن نمایش داده می‌شود.</p>
            </div>
            <button
              className={`switch${draft.streaming ? ' on' : ''}`}
              onClick={() => set('streaming', !draft.streaming)}
              role="switch"
              aria-checked={draft.streaming}
              aria-label="پاسخ لحظه‌ای"
            />
          </div>

          <div className="switch-row">
            <div>
              <div className="field-label">ابزارهای عامل</div>
              <p className="field-hint">اجازه می‌دهد مدل از Workspace، Git، GitHub و حافظه‌ی پروژه استفاده کند.</p>
            </div>
            <button
              className={`switch${draft.toolsEnabled ? ' on' : ''}`}
              onClick={() => set('toolsEnabled', !draft.toolsEnabled)}
              role="switch"
              aria-checked={draft.toolsEnabled}
              aria-label="ابزارهای عامل"
            />
          </div>

          <div className="field">
            <div className="field-label">اختیار دستیار در Workspace</div>
            <p className="field-hint">
              تعیین می‌کند مدل تا کجا می‌تواند فایل‌های واقعی، ترمینال و GitHub شما را تغییر دهد.
            </p>
            <div className="ws-modes">
              {([
                { id: 'plan', label: 'فقط مطالعه', hint: 'می‌خواند و پیشنهاد می‌دهد؛ چیزی تغییر نمی‌کند.' },
                { id: 'ask', label: 'با تأیید من', hint: 'قبل از هر تغییر diff یا دستور را می‌بینید.' },
                { id: 'auto', label: 'خودگردان', hint: 'بدون پرسش اعمال می‌کند.' },
              ] as const).map((mode) => (
                <button
                  type="button"
                  key={mode.id}
                  className={`ws-mode${draft.approvalMode === mode.id ? ' active' : ''}`}
                  onClick={() => set('approvalMode', mode.id)}
                >
                  <strong>{mode.label}</strong>
                  <span>{mode.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="switch-row">
            <div>
              <div className="field-label">حافظه‌ی خودکار پروژه</div>
              <p className="field-hint">تصمیم‌ها و محدودیت‌های پایدار را بعد از پاسخ در پروژه نگه می‌دارد.</p>
            </div>
            <button
              className={`switch${draft.autoMemory ? ' on' : ''}`}
              onClick={() => set('autoMemory', !draft.autoMemory)}
              role="switch"
              aria-checked={draft.autoMemory}
              aria-label="حافظه‌ی خودکار پروژه"
              disabled={!draft.toolsEnabled}
            />
          </div>

          <div className="switch-row">
            <div>
              <div className="field-label">خلاصه‌سازی خودکار زمینه</div>
              <p className="field-hint">در گفتگوهای طولانی، تصمیم‌های قدیمی را به خلاصه‌ی فشرده تبدیل می‌کند.</p>
            </div>
            <button
              className={`switch${draft.autoSummarize ? ' on' : ''}`}
              onClick={() => set('autoSummarize', !draft.autoSummarize)}
              role="switch"
              aria-checked={draft.autoSummarize}
              aria-label="خلاصه‌سازی خودکار زمینه"
            />
          </div>

          <div className="field">
            <label className="field-label">بودجه‌ی زمینه — {toFa(draft.contextBudget.toLocaleString())} توکن</label>
            <div className="slider-row">
              <input
                type="range"
                min={4000}
                max={64000}
                step={1000}
                value={draft.contextBudget}
                onChange={(e) => set('contextBudget', Number(e.target.value))}
              />
              <output>{draft.contextBudget}</output>
            </div>
          </div>

          <div className="switch-row">
            <div>
              <div className="field-label">ارسال با کلید Enter</div>
              <p className="field-hint">در حالت غیرفعال، ارسال با Ctrl + Enter انجام می‌شود.</p>
            </div>
            <button
              className={`switch${draft.sendOnEnter ? ' on' : ''}`}
              onClick={() => set('sendOnEnter', !draft.sendOnEnter)}
              role="switch"
              aria-checked={draft.sendOnEnter}
              aria-label="ارسال با Enter"
            />
          </div>

          <div className="field">
            <label className="field-label">اتصال فعلی</label>
            <div className="setup-note">
              <span>
                نوع سرویس: <strong>{config.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}</strong>
                <br />
                <span style={{ direction: 'ltr', display: 'inline-block', wordBreak: 'break-all' }}>
                  {normalizeBaseUrl(config.baseUrl)}
                </span>
              </span>
            </div>
          </div>

          <div className="field">
            <label className="field-label">پاک‌سازی</label>
            <button className="btn btn-danger" onClick={onClearHistory}>
              حذف همه‌ی گفتگوها
            </button>
            <p className="field-hint">این کار برگشت‌پذیر نیست.</p>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={() => onSave(draft)}>
            ذخیره‌ی تنظیمات
          </button>
          <button className="btn btn-outline" onClick={() => setDraft({ ...DEFAULT_SETTINGS, theme: draft.theme })}>
            بازگردانی پیش‌فرض‌ها
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </div>
  )
}
