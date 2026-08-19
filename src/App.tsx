import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  ApiConfig,
  ApprovalRequest,
  Attachment,
  BridgeConfig,
  BridgeEvent,
  BridgeStatus,
  Conversation,
  Message,
  ModelInfo,
  Project,
  Settings,
} from './types'
import { ApiError, listModels } from './lib/api'
import { callBridge, probeBridge, resolveWorkspace, subscribeBridgeEvents } from './lib/bridge'
import { extractFacts, runTurn } from './lib/harness'
import { storage } from './lib/storage'
import { addFacts } from './lib/tools'
import { createConversation, createMessage, deriveTitle, toFa, uid } from './lib/utils'
import { Setup } from './components/Setup'
import { Sidebar } from './components/Sidebar'
import { ModelPicker } from './components/ModelPicker'
import { ChatMessage } from './components/ChatMessage'
import { Composer } from './components/Composer'
import { SettingsModal } from './components/SettingsModal'
import { ProjectModal } from './components/ProjectModal'
import { WorkspaceModal } from './components/WorkspaceModal'
import { WorkspacePanel } from './components/WorkspacePanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { ResizeHandle } from './components/ResizeHandle'
import { Welcome } from './components/Welcome'
import { useToasts } from './hooks/useToasts'
import { isMobileViewport, useIsMobile } from './hooks/useMediaQuery'
import {
  IconArrowDown,
  IconCode,
  IconFolder,
  IconGitBranch,
  IconPanel,
  IconPlus,
  IconSidebar,
} from './components/Icons'

export default function App() {
  const [config, setConfig] = useState<ApiConfig | null>(() => storage.loadConfig())
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(() => storage.loadBridgeConfig())
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>(() => storage.loadConversations())
  const [projects, setProjects] = useState<Project[]>(() => storage.loadProjects())
  const [activeId, setActiveId] = useState<string | null>(() => storage.loadActiveId())
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => storage.loadActiveProjectId())
  /** Manual workspace pick, used only when the open project has no folder. */
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => storage.loadActiveWorkspaceId())
  const [settings, setSettings] = useState<Settings>(() => storage.loadSettings())
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [streaming, setStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileViewport())
  const [showSettings, setShowSettings] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)
  /** `null` closed, `{ id: null }` creating, `{ id }` editing that project. */
  const [projectEditor, setProjectEditor] = useState<{ id: string | null } | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  /** Last event pushed by the sidecar; the workspace panel reacts to it. */
  const [bridgeEvent, setBridgeEvent] = useState<BridgeEvent | null>(null)
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [layout, setLayout] = useState(() => storage.loadLayout())

  const mobile = useIsMobile()
  const abortRef = useRef<AbortController | null>(null)
  /** Resolver for the approval dialog currently on screen. */
  const approvalRef = useRef<((allowed: boolean) => void) | null>(null)
  /** Tools the user approved for the rest of the session, per «همیشه». */
  const trustedTools = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const { push: toast, view: toastView } = useToasts()
  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  )
  const activeProject = useMemo(
    () => projects.find((project) => project.id === (active?.projectId ?? activeProjectId)) ?? null,
    [projects, active?.projectId, activeProjectId],
  )
  /**
   * The folder this conversation codes in. A project pinned to a folder wins, so
   * opening a project retargets the panel and every tool call at once; without
   * one, the user's manual pick decides.
   */
  const activeWorkspace = useMemo(
    () => resolveWorkspace(bridgeStatus, activeProject, activeWorkspaceId),
    [bridgeStatus, activeProject, activeWorkspaceId],
  )
  /** Set when the open project points at a folder this bridge is not serving. */
  const missingWorkspace = Boolean(bridgeStatus && activeProject?.workspaceRoot && !activeWorkspace)

  useEffect(() => {
    const timer = setTimeout(() => storage.saveConversations(conversations), 300)
    return () => clearTimeout(timer)
  }, [conversations])
  useEffect(() => {
    const timer = setTimeout(() => storage.saveProjects(projects), 300)
    return () => clearTimeout(timer)
  }, [projects])
  useEffect(() => storage.saveActiveId(activeId), [activeId])
  useEffect(() => storage.saveActiveProjectId(activeProjectId), [activeProjectId])
  useEffect(() => storage.saveActiveWorkspaceId(activeWorkspaceId), [activeWorkspaceId])
  useEffect(() => storage.saveLayout(layout), [layout])
  useEffect(() => storage.saveSettings(settings), [settings])
  useEffect(() => document.documentElement.setAttribute('data-theme', settings.theme), [settings.theme])

  // The drawer is closed by default on phones and restored on wider screens.
  useEffect(() => setSidebarOpen(!mobile), [mobile])

  useEffect(() => {
    if (!bridgeConfig) {
      setBridgeStatus(null)
      return
    }
    const controller = new AbortController()
    void probeBridge(bridgeConfig, controller.signal).then(setBridgeStatus).catch(() => setBridgeStatus(null))
    return () => controller.abort()
  }, [bridgeConfig])

  // Live file-change and terminal events from the sidecar, reconnected on drop.
  useEffect(() => {
    if (!bridgeConfig || !bridgeStatus) return
    let stopped = false
    let unsubscribe = () => {}
    let retry: number | undefined

    const connect = () => {
      if (stopped) return
      unsubscribe = subscribeBridgeEvents(bridgeConfig, setBridgeEvent, () => {
        retry = window.setTimeout(connect, 4000)
      })
    }
    connect()

    return () => {
      stopped = true
      window.clearTimeout(retry)
      unsubscribe()
    }
  }, [bridgeConfig, bridgeStatus?.workspaces.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Shows the permission dialog and resolves once the user decides. `always`
   * whitelists the tool for the rest of the session.
   */
  const requestApproval = useCallback((request: Omit<ApprovalRequest, 'id'>): Promise<boolean> => {
    if (trustedTools.current.has(request.tool)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      approvalRef.current = resolve
      setApproval({ ...request, id: uid() })
    })
  }, [])

  const decideApproval = useCallback((decision: 'allow' | 'always' | 'deny') => {
    if (decision === 'always' && approval) trustedTools.current.add(approval.tool)
    approvalRef.current?.(decision !== 'deny')
    approvalRef.current = null
    setApproval(null)
  }, [approval])

  const refreshModels = useCallback(async (nextConfig: ApiConfig, quiet = false) => {
    setModelsLoading(true)
    try {
      const list = await listModels(nextConfig)
      setModels(list)
      setModel((current) => current && list.some((item) => item.id === current) ? current : list[0]?.id ?? '')
      if (!quiet) toast(`${list.length} مدل بارگیری شد`, 'success')
    } catch (error) {
      toast(error instanceof ApiError ? 'بارگیری مدل‌ها ناموفق بود' : 'خطا در دریافت مدل‌ها', 'error')
    } finally {
      setModelsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (config && models.length === 0) void refreshModels(config, true)
  }, [config, models.length, refreshModels])
  /**
   * Opening a chat restores the model it was last answered with.
   *
   * This deliberately does not react to `active.model` itself: the picker is
   * the only writer (see `selectModel`), and an effect that mirrored the value
   * back would fight it — switching to a chat saved with another model used to
   * leave the two effects overwriting each other every render.
   */
  useEffect(() => {
    const saved = active?.model
    if (saved && models.some((item) => item.id === saved)) setModel(saved)
  }, [activeId, models]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Choosing a model applies it to the open chat as well, in one direction. */
  const selectModel = useCallback((id: string) => {
    setModel(id)
    setConversations((list) => list.map((item) => item.id === activeId ? { ...item, model: id } : item))
  }, [activeId])

  const scrollToBottom = useCallback((smooth = true) => {
    const element = scrollRef.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])
  function handleScroll() {
    const element = scrollRef.current
    if (element) setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 90)
  }
  useEffect(() => {
    if (atBottom) scrollToBottom(false)
  }, [active?.messages.length, activeId, atBottom, scrollToBottom])

  const patchConversation = useCallback((id: string, patch: (value: Conversation) => Conversation) => {
    setConversations((list) => list.map((item) => item.id === id ? patch(item) : item))
  }, [])
  const newChat = useCallback(() => {
    const conversation = { ...createConversation(model), projectId: activeProjectId }
    setConversations((list) => [conversation, ...list])
    setActiveId(conversation.id)
    setInput('')
    setAttachments([])
    if (isMobileViewport()) setSidebarOpen(false)
  }, [activeProjectId, model])

  function saveProject(next: Project) {
    const isNew = !projects.some((project) => project.id === next.id)
    setProjects((list) => isNew ? [next, ...list] : list.map((project) => project.id === next.id ? next : project))
    setProjectEditor(null)
    if (!isNew) return toast('پروژه به‌روزرسانی شد', 'success')

    // A fresh project opens straight into its first chat.
    const conversation = { ...createConversation(model), projectId: next.id }
    setConversations((list) => [conversation, ...list])
    setActiveProjectId(next.id)
    setActiveId(conversation.id)
    toast(`پروژه‌ی «${next.name}» ساخته شد`, 'success')
  }
  function deleteProject(id: string) {
    setProjects((list) => list.filter((project) => project.id !== id))
    // Chats survive their project; they simply become loose chats.
    setConversations((list) => list.map((item) => item.projectId === id ? { ...item, projectId: null } : item))
    if (activeProjectId === id) setActiveProjectId(null)
    setProjectEditor(null)
    toast('پروژه حذف شد', 'success')
  }
  function openProject(id: string) {
    setActiveProjectId(id)
    const recent = conversations.filter((item) => item.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (recent) setActiveId(recent.id)
    else {
      const conversation = { ...createConversation(model), projectId: id }
      setConversations((list) => [conversation, ...list])
      setActiveId(conversation.id)
    }
  }
  function deleteConversation(id: string) {
    setConversations((list) => list.filter((item) => item.id !== id))
    if (activeId === id) setActiveId(null)
    toast('گفتگو حذف شد', 'success')
  }
  function clearHistory() {
    setConversations([])
    setActiveId(null)
    setShowSettings(false)
    toast('همه‌ی گفتگوها حذف شد', 'success')
  }

  const runCompletion = useCallback(async (conversationId: string, history: Message[]) => {
    if (!config || !model) return
    const snapshot = conversations.find((item) => item.id === conversationId)
    if (!snapshot) return
    const placeholder = createMessage('assistant', '', { model, toolRuns: [] })
    // `model` is recorded here too, so reopening the chat later restores the
    // model it was actually answered with.
    patchConversation(conversationId, (conversation) => ({
      ...conversation, model, messages: [...conversation.messages, placeholder], updatedAt: Date.now(),
    }))

    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    let answer = ''
    let reasoning = ''
    let frame = 0
    let projectDraft = projects.find((project) => project.id === snapshot.projectId) ?? null

    const flush = () => {
      frame = 0
      patchConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === placeholder.id
          ? { ...message, content: answer, reasoning: reasoning || undefined }
          : message),
      }))
    }
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(flush) }

    try {
      const result = await runTurn({
        config,
        model,
        settings,
        conversation: { ...snapshot, messages: history },
        project: projectDraft,
        history,
        signal: controller.signal,
        env: {
          getProject: () => projectDraft,
          setProject: (next) => {
            projectDraft = next
            setProjects((list) => list.map((project) => project.id === next.id ? next : project))
          },
          renameConversation: (title) => patchConversation(conversationId, (item) => ({ ...item, title })),
          searchChats: (query) => {
            const normalized = query.toLocaleLowerCase()
            return conversations.filter((conversation) =>
              conversation.title.toLocaleLowerCase().includes(normalized) ||
              conversation.messages.some((message) => message.content.toLocaleLowerCase().includes(normalized)),
            ).slice(0, 8).map((conversation) => ({
              title: conversation.title,
              snippet: conversation.messages.find((message) => message.content.toLocaleLowerCase().includes(normalized))?.content.slice(0, 180) ?? '',
              updatedAt: conversation.updatedAt,
            }))
          },
          ...(bridgeConfig && bridgeStatus && activeWorkspace ? {
            bridge: {
              status: bridgeStatus,
              workspace: activeWorkspace,
              mode: settings.approvalMode,
              approve: requestApproval,
              // Every tool call is pinned to this turn's workspace here, so no
              // individual tool can reach into another project's folder.
              call: <T,>(method: string, params: Record<string, unknown> = {}) =>
                callBridge<T>(bridgeConfig, method, { ...params, workspace: activeWorkspace.id }, controller.signal),
              onWorkspaceChange: (path?: string) => setBridgeEvent({
                type: 'fs.change',
                payload: { workspace: activeWorkspace.id, path: path ?? '.' },
                at: Date.now(),
              }),
            },
          } : {}),
        },
        onDelta: ({ text, reasoning: thought, reclassifyAsReasoning }) => {
          if (text) answer += text
          if (thought) reasoning += thought
          if (reclassifyAsReasoning) { reasoning += answer; answer = '' }
          schedule()
        },
        onToolRun: (toolRun) => patchConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => message.id === placeholder.id
            ? { ...message, toolRuns: [...(message.toolRuns ?? []), toolRun] }
            : message),
        })),
        onSummary: (summary, coveredCount) => patchConversation(conversationId, (conversation) => ({
          ...conversation, summary, summarizedCount: coveredCount,
        })),
      })

      if (frame) cancelAnimationFrame(frame)
      const stopped = controller.signal.aborted
      const finalMessage: Message = {
        ...placeholder,
        content: answer || (stopped ? '' : '—'),
        reasoning: reasoning || undefined,
        usage: result.usage,
        toolRuns: result.toolRuns,
        stopped: stopped || undefined,
      }
      patchConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        messages: conversation.messages.map((message) => message.id === placeholder.id ? finalMessage : message),
      }))

      if (projectDraft && settings.autoMemory && !stopped && answer.trim()) {
        const memoryProject = projectDraft
        void extractFacts(config, model, memoryProject, [...history.slice(-1), finalMessage])
          .then((facts) => {
            if (facts.length) setProjects((list) => list.map((project) =>
              project.id === memoryProject.id ? addFacts(project, facts, 'auto').project : project))
          })
          .catch(() => {})
      }
    } catch (error) {
      if (frame) cancelAnimationFrame(frame)
      const aborted = controller.signal.aborted
      const message = error instanceof Error ? error.message : 'خطای ناشناخته رخ داد.'
      patchConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        messages: conversation.messages.map((item) => item.id === placeholder.id
          ? aborted ? { ...item, content: answer, stopped: true } : { ...item, content: message, error: true }
          : item),
      }))
      if (!aborted) toast('ارسال پیام ناموفق بود', 'error')
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }, [activeWorkspace, bridgeConfig, bridgeStatus, config, conversations, model, patchConversation, projects, requestApproval, settings, toast])

  const send = useCallback(async () => {
    const text = input.trim()
    // An image on its own is enough to ask about — text is not required.
    if ((!text && attachments.length === 0) || streaming || !config || !model) return
    let conversation = active
    if (!conversation) {
      conversation = { ...createConversation(model), id: uid(), projectId: activeProjectId }
      setConversations((list) => [conversation!, ...list])
      setActiveId(conversation.id)
    }
    const userMessage = createMessage('user', text, attachments.length ? { attachments } : {})
    const history = [...conversation.messages, userMessage]
    patchConversation(conversation.id, (current) => ({
      ...current,
      title: current.messages.length === 0 ? deriveTitle(text || 'گفتگو درباره‌ی تصویر') : current.title,
      messages: [...current.messages, userMessage],
      updatedAt: Date.now(),
    }))
    setInput('')
    setAttachments([])
    setAtBottom(true)
    await runCompletion(conversation.id, history)
  }, [active, activeProjectId, attachments, config, input, model, patchConversation, runCompletion, streaming])

  const regenerate = useCallback(async () => {
    if (!active || streaming) return
    const messages = [...active.messages]
    while (messages.at(-1)?.role === 'assistant') messages.pop()
    if (!messages.length) return
    patchConversation(active.id, (conversation) => ({ ...conversation, messages }))
    await runCompletion(active.id, messages)
  }, [active, patchConversation, runCompletion, streaming])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newChat() }
      if ((event.ctrlKey || event.metaKey) && event.key === '\\') { event.preventDefault(); setSidebarOpen((value) => !value) }
      if (event.key === 'Escape' && isMobileViewport()) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  function handleApiConnected(nextConfig: ApiConfig, list: ModelInfo[]) {
    storage.saveConfig(nextConfig)
    setConfig(nextConfig)
    setModels(list)
    setModel((current) => current && list.some((item) => item.id === current) ? current : list[0]?.id ?? '')
    setReconnecting(false)
    toast('اتصال مدل برقرار شد', 'success')
  }

  if (!config || reconnecting) {
    return <><Setup initial={config} onConnected={handleApiConnected} onCancel={config ? () => setReconnecting(false) : undefined} />{toastView}</>
  }

  const providerLabel = config.provider === 'anthropic' ? 'Anthropic' : 'OpenAI compatible'
  return (
    <div className="app" style={{ '--sidebar-w': `${layout.sidebarWidth}px` } as CSSProperties}>
      {sidebarOpen && mobile && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        conversations={conversations} projects={projects} activeId={activeId} activeProjectId={activeProjectId}
        collapsed={!sidebarOpen} theme={settings.theme} providerLabel={providerLabel}
        onSelect={(id) => {
          setActiveId(id)
          setActiveProjectId(conversations.find((conversation) => conversation.id === id)?.projectId ?? null)
          if (mobile) setSidebarOpen(false)
        }}
        onNew={newChat} onNewProject={() => setProjectEditor({ id: null })} onOpenProject={openProject}
        onRename={(id, title) => patchConversation(id, (conversation) => ({ ...conversation, title }))}
        onDelete={deleteConversation}
        onTogglePin={(id) => patchConversation(id, (conversation) => ({ ...conversation, pinned: !conversation.pinned }))}
        onMoveToProject={(id, projectId) => {
          patchConversation(id, (conversation) => ({ ...conversation, projectId }))
          if (id === activeId) setActiveProjectId(projectId)
        }}
        onOpenSettings={() => setShowSettings(true)}
        onToggleTheme={() => setSettings((value) => ({ ...value, theme: value.theme === 'dark' ? 'light' : 'dark' }))}
        onToggleCollapse={() => setSidebarOpen(false)}
        onDisconnect={() => setReconnecting(true)}
      />
      {sidebarOpen && !mobile && (
        <ResizeHandle
          anchor="start"
          width={layout.sidebarWidth}
          min={220}
          max={520}
          label="تغییر عرض نوار کناری"
          onResize={(sidebarWidth) => setLayout((value) => ({ ...value, sidebarWidth }))}
        />
      )}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setSidebarOpen((value) => !value)} title="نمایش/پنهان کردن نوار کناری" aria-label="نمایش یا پنهان کردن نوار کناری"><IconSidebar /></button>
          <button className="icon-btn" onClick={newChat} title="گفتگوی جدید" aria-label="گفتگوی جدید"><IconPlus /></button>
          {activeProject && (
            <button className="project-pill" onClick={() => setProjectEditor({ id: activeProject.id })} title="جزئیات و حافظه‌ی پروژه">
              <IconFolder size={14} />
              <span>{activeProject.name}</span>
              {activeProject.facts.length > 0 && <small>{toFa(activeProject.facts.length)} حافظه</small>}
            </button>
          )}
          <span className="topbar-title">{active?.title ?? 'گفتگوی جدید'}</span>
          <span className="topbar-spacer" />
          {bridgeStatus && !mobile && (
            <button
              className={`icon-btn${settings.workspacePanel ? ' active' : ''}`}
              onClick={() => setSettings((value) => ({ ...value, workspacePanel: !value.workspacePanel }))}
              title="نمایش/پنهان کردن پنل Workspace"
              aria-label="نمایش یا پنهان کردن پنل Workspace"
            >
              <IconPanel />
            </button>
          )}
          <button
            className={`workspace-pill${activeWorkspace ? ' connected' : ''}${missingWorkspace ? ' missing' : ''}`}
            onClick={() => setShowWorkspace(true)}
            title={missingWorkspace
              ? `پوشه‌ی پروژه در دسترس نیست: ${activeProject?.workspaceRoot}`
              : activeWorkspace?.root ?? 'اتصال Workspace، Git و GitHub'}
          >
            <span className="status-dot" /><IconCode size={15} />
            <span>{missingWorkspace ? 'پوشه در دسترس نیست' : activeWorkspace?.name ?? 'اتصال Workspace'}</span>
            {activeWorkspace?.git.branch && <small><IconGitBranch size={11} />{activeWorkspace.git.branch}</small>}
          </button>
          {/* Switching is a manual override, so it is hidden once a project pins the folder. */}
          {!activeProject?.workspaceRoot && (bridgeStatus?.workspaces.length ?? 0) > 1 && (
            <select
              className="workspace-switch"
              value={activeWorkspace?.id ?? ''}
              onChange={(event) => setActiveWorkspaceId(event.target.value)}
              aria-label="انتخاب Workspace"
              title="جابه‌جایی بین پوشه‌های متصل"
            >
              {bridgeStatus?.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          )}
          <ModelPicker models={models} value={model} loading={modelsLoading} onChange={selectModel} onRefresh={() => refreshModels(config)} />
        </header>

        {!active || active.messages.length === 0 ? <Welcome onPick={setInput} /> : (
          <div className="scroll-area" ref={scrollRef} onScroll={handleScroll}><div className="thread">
            {active.messages.map((message, index) => <ChatMessage
              key={message.id} message={message}
              streaming={streaming && index === active.messages.length - 1 && message.role === 'assistant'}
              onRegenerate={index === active.messages.length - 1 ? regenerate : undefined}
            />)}
          </div></div>
        )}

        <div className="composer-wrap">
          {!atBottom && active && active.messages.length > 0 && <button className="scroll-bottom" onClick={() => scrollToBottom()} aria-label="رفتن به انتهای گفتگو"><IconArrowDown /></button>}
          <Composer
            value={input}
            attachments={attachments}
            streaming={streaming}
            disabled={!model}
            sendOnEnter={settings.sendOnEnter}
            onChange={setInput}
            onAttach={(added) => setAttachments((list) => [...list, ...added])}
            onRemoveAttachment={(id) => setAttachments((list) => list.filter((item) => item.id !== id))}
            onAttachError={(message) => toast(message, 'error')}
            onSend={send}
            onStop={() => abortRef.current?.abort()}
          />
        </div>
      </main>

      {bridgeConfig && bridgeStatus && activeWorkspace && settings.workspacePanel && !mobile && (
        <>
          <ResizeHandle
            anchor="end"
            width={layout.panelWidth}
            min={300}
            max={860}
            label="تغییر عرض پنل Workspace"
            onResize={(panelWidth) => setLayout((value) => ({ ...value, panelWidth }))}
          />
          <WorkspacePanel
            key={activeWorkspace.id}
            config={bridgeConfig}
            status={bridgeStatus}
            workspace={activeWorkspace}
            width={layout.panelWidth}
            event={bridgeEvent}
            onClose={() => setSettings((value) => ({ ...value, workspacePanel: false }))}
            onNotify={toast}
          />
        </>
      )}

      {showSettings && <SettingsModal settings={settings} config={config} onSave={(next) => { setSettings(next); setShowSettings(false); toast('تنظیمات ذخیره شد', 'success') }} onClose={() => setShowSettings(false)} onClearHistory={clearHistory} />}
      {showWorkspace && <WorkspaceModal
        initial={bridgeConfig} status={bridgeStatus}
        approvalMode={settings.approvalMode}
        onApprovalModeChange={(mode) => setSettings((value) => ({ ...value, approvalMode: mode }))}
        onConnected={(nextConfig, status) => {
          storage.saveBridgeConfig(nextConfig); setBridgeConfig(nextConfig); setBridgeStatus(status); setShowWorkspace(false)
          setActiveWorkspaceId((current) => status.workspaces.some((workspace) => workspace.id === current)
            ? current
            : status.workspaces[0]?.id ?? null)
          setSettings((value) => ({ ...value, workspacePanel: true }))
          toast(status.workspaces.length === 1
            ? `Workspace «${status.workspaces[0]?.name ?? 'بدون نام'}» متصل شد`
            : `${toFa(status.workspaces.length)} Workspace متصل شدند`, 'success')
        }}
        onDisconnect={() => {
          storage.clearBridgeConfig(); setBridgeConfig(null); setBridgeStatus(null); setShowWorkspace(false)
          toast('اتصال Workspace قطع شد', 'success')
        }}
        onClose={() => setShowWorkspace(false)}
      />}
      {projectEditor && <ProjectModal
        project={projectEditor.id ? projects.find((project) => project.id === projectEditor.id) ?? null : null}
        chats={conversations.filter((item) => item.projectId === projectEditor.id)}
        onSave={saveProject}
        onDelete={deleteProject}
        onOpenChat={(id) => { setActiveId(id); setProjectEditor(null) }}
        onClose={() => setProjectEditor(null)}
      />}
      {approval && <ApprovalDialog request={approval} onDecide={decideApproval} />}
      {toastView}
    </div>
  )
}
