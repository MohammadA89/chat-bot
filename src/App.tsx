import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiConfig, Conversation, Message, ModelInfo, Settings } from './types'
import { ApiError, listModels, sendChat } from './lib/api'
import { storage } from './lib/storage'
import { createConversation, createMessage, deriveTitle, uid } from './lib/utils'
import { Setup } from './components/Setup'
import { Sidebar } from './components/Sidebar'
import { ModelPicker } from './components/ModelPicker'
import { ChatMessage } from './components/ChatMessage'
import { Composer } from './components/Composer'
import { SettingsModal } from './components/SettingsModal'
import { Welcome } from './components/Welcome'
import { useToasts } from './hooks/useToasts'
import { IconArrowDown, IconPlus, IconSidebar } from './components/Icons'

export default function App() {
  const [config, setConfig] = useState<ApiConfig | null>(() => storage.loadConfig())
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>(() => storage.loadConversations())
  const [activeId, setActiveId] = useState<string | null>(() => storage.loadActiveId())
  const [settings, setSettings] = useState<Settings>(() => storage.loadSettings())
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [atBottom, setAtBottom] = useState(true)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { push: toast, view: toastView } = useToasts()

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  /* ------------------------------ persistence ----------------------------- */

  useEffect(() => {
    const t = setTimeout(() => storage.saveConversations(conversations), 400)
    return () => clearTimeout(t)
  }, [conversations])

  useEffect(() => storage.saveActiveId(activeId), [activeId])
  useEffect(() => storage.saveSettings(settings), [settings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  /* -------------------------------- models -------------------------------- */

  const refreshModels = useCallback(
    async (cfg: ApiConfig, quiet = false) => {
      setModelsLoading(true)
      try {
        const list = await listModels(cfg)
        setModels(list)
        setModel((current) => (current && list.some((m) => m.id === current) ? current : list[0]?.id ?? ''))
        if (!quiet) toast(`${list.length} مدل بارگیری شد`, 'success')
      } catch (err) {
        toast(err instanceof ApiError ? 'بارگیری مدل‌ها ناموفق بود' : 'خطا در دریافت مدل‌ها', 'error')
      } finally {
        setModelsLoading(false)
      }
    },
    [toast],
  )

  // Load the catalogue once for a session restored from storage.
  useEffect(() => {
    if (config && models.length === 0) void refreshModels(config, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  // Keep the active conversation's model in sync with the picker.
  useEffect(() => {
    if (active && model && active.model !== model) {
      setConversations((list) =>
        list.map((c) => (c.id === active.id ? { ...c, model } : c)),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    if (active?.model && models.some((m) => m.id === active.model)) setModel(active.model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  /* ------------------------------- scrolling ------------------------------ */

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 90)
  }

  useEffect(() => {
    if (atBottom) scrollToBottom(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.messages.length, activeId])

  /* -------------------------- conversation helpers ------------------------ */

  const patchConversation = useCallback((id: string, patch: (c: Conversation) => Conversation) => {
    setConversations((list) => list.map((c) => (c.id === id ? patch(c) : c)))
  }, [])

  const newChat = useCallback(() => {
    const c = createConversation(model)
    setConversations((list) => [c, ...list])
    setActiveId(c.id)
    setInput('')
    if (window.innerWidth <= 860) setSidebarOpen(false)
  }, [model])

  function deleteConversation(id: string) {
    setConversations((list) => list.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(null)
    toast('گفتگو حذف شد', 'success')
  }

  function renameConversation(id: string, title: string) {
    patchConversation(id, (c) => ({ ...c, title }))
  }

  function clearHistory() {
    setConversations([])
    setActiveId(null)
    setShowSettings(false)
    toast('همه‌ی گفتگوها حذف شد', 'success')
  }

  /* --------------------------------- send --------------------------------- */

  /**
   * Runs one completion against `history` and appends the answer to `convId`.
   * Streaming deltas are buffered and flushed on animation frames so a fast
   * token stream doesn't trigger a React render per token.
   */
  const runCompletion = useCallback(
    async (convId: string, history: Message[]) => {
      if (!config || !model) return

      const placeholder = createMessage('assistant', '', { model })
      patchConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, placeholder],
        updatedAt: Date.now(),
      }))

      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)

      let text = ''
      let reasoning = ''
      let frame = 0

      const flush = () => {
        frame = 0
        patchConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === placeholder.id ? { ...m, content: text, reasoning: reasoning || undefined } : m,
          ),
        }))
      }

      const schedule = () => {
        if (frame === 0) frame = requestAnimationFrame(flush)
      }

      try {
        const { usage } = await sendChat({
          config,
          model,
          messages: history,
          systemPrompt: settings.systemPrompt,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          stream: settings.streaming,
          signal: controller.signal,
          onDelta: ({ text: t, reasoning: r }) => {
            if (t) text += t
            if (r) reasoning += r
            schedule()
          },
        })

        if (frame) cancelAnimationFrame(frame)
        const stopped = controller.signal.aborted
        patchConversation(convId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === placeholder.id
              ? {
                  ...m,
                  content: text || (stopped ? '' : '—'),
                  reasoning: reasoning || undefined,
                  usage,
                  stopped: stopped || undefined,
                }
              : m,
          ),
        }))
      } catch (err) {
        if (frame) cancelAnimationFrame(frame)
        const aborted = controller.signal.aborted
        const message = err instanceof Error ? err.message : 'خطای ناشناخته رخ داد.'

        patchConversation(convId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === placeholder.id
              ? aborted
                ? { ...m, content: text, stopped: true }
                : { ...m, content: message, error: true }
              : m,
          ),
        }))
        if (!aborted) toast('ارسال پیام ناموفق بود', 'error')
      } finally {
        abortRef.current = null
        setStreaming(false)
      }
    },
    [config, model, settings, patchConversation, toast],
  )

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !config || !model) return

    let convId = activeId
    let base: Conversation

    if (!convId || !conversations.some((c) => c.id === convId)) {
      base = { ...createConversation(model), id: uid() }
      convId = base.id
      setConversations((list) => [base, ...list])
      setActiveId(convId)
    } else {
      base = conversations.find((c) => c.id === convId)!
    }

    const userMsg = createMessage('user', text)
    const history = [...base.messages, userMsg]

    patchConversation(convId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? deriveTitle(text) : c.title,
      messages: [...c.messages, userMsg],
      updatedAt: Date.now(),
    }))

    setInput('')
    setAtBottom(true)
    await runCompletion(convId, history)
  }, [input, streaming, config, model, activeId, conversations, patchConversation, runCompletion])

  const regenerate = useCallback(async () => {
    if (!active || streaming) return
    const messages = [...active.messages]
    while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') messages.pop()
    if (messages.length === 0) return

    patchConversation(active.id, (c) => ({ ...c, messages }))
    await runCompletion(active.id, messages)
  }, [active, streaming, patchConversation, runCompletion])

  function stop() {
    abortRef.current?.abort()
  }

  /* ------------------------------- shortcuts ------------------------------ */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        newChat()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  /* -------------------------------- render -------------------------------- */

  function handleConnected(cfg: ApiConfig, list: ModelInfo[]) {
    storage.saveConfig(cfg)
    setConfig(cfg)
    setModels(list)
    setModel((current) => (current && list.some((m) => m.id === current) ? current : list[0]?.id ?? ''))
    setReconnecting(false)
    toast('اتصال برقرار شد', 'success')
  }

  if (!config || reconnecting) {
    return (
      <>
        <Setup
          initial={config}
          onConnected={handleConnected}
          onCancel={config ? () => setReconnecting(false) : undefined}
        />
        {toastView}
      </>
    )
  }

  const mobile = typeof window !== 'undefined' && window.innerWidth <= 860

  return (
    <div className="app">
      {sidebarOpen && mobile && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}

      <Sidebar
        conversations={conversations}
        activeId={activeId}
        collapsed={!sidebarOpen}
        theme={settings.theme}
        onSelect={(id) => {
          setActiveId(id)
          if (mobile) setSidebarOpen(false)
        }}
        onNew={newChat}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onOpenSettings={() => setShowSettings(true)}
        onToggleTheme={() =>
          setSettings((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))
        }
        onDisconnect={() => setReconnecting(true)}
      />

      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            title="نمایش/پنهان کردن نوار کناری"
            aria-label="نمایش یا پنهان کردن نوار کناری"
          >
            <IconSidebar />
          </button>

          <button className="icon-btn" onClick={newChat} title="گفتگوی جدید" aria-label="گفتگوی جدید">
            <IconPlus />
          </button>

          <span className="topbar-title">{active?.title ?? 'گفتگوی جدید'}</span>
          <span className="topbar-spacer" />

          <ModelPicker
            models={models}
            value={model}
            loading={modelsLoading}
            onChange={setModel}
            onRefresh={() => config && refreshModels(config)}
          />
        </header>

        {!active || active.messages.length === 0 ? (
          <Welcome onPick={(text) => setInput(text)} />
        ) : (
          <div className="scroll-area" ref={scrollRef} onScroll={handleScroll}>
            <div className="thread">
              {active.messages.map((m, i) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  streaming={streaming && i === active.messages.length - 1 && m.role === 'assistant'}
                  onRegenerate={i === active.messages.length - 1 ? regenerate : undefined}
                />
              ))}
            </div>
          </div>
        )}

        <div className="composer-wrap">
          {!atBottom && active && active.messages.length > 0 && (
            <button
              className="scroll-bottom"
              onClick={() => scrollToBottom()}
              aria-label="رفتن به انتهای گفتگو"
            >
              <IconArrowDown />
            </button>
          )}

          <Composer
            value={input}
            streaming={streaming}
            disabled={!model}
            sendOnEnter={settings.sendOnEnter}
            onChange={setInput}
            onSend={send}
            onStop={stop}
          />
        </div>
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          config={config}
          onSave={(s) => {
            setSettings(s)
            setShowSettings(false)
            toast('تنظیمات ذخیره شد', 'success')
          }}
          onClose={() => setShowSettings(false)}
          onClearHistory={clearHistory}
        />
      )}

      {toastView}
    </div>
  )
}
