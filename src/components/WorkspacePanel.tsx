import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BridgeConfig,
  BridgeEvent,
  BridgeStatus,
  GitFileChange,
  GitStatus,
  ShellJob,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
} from '../types'
import { callBridge, gitApi, shellApi, workspaceApi, type BridgeTarget } from '../lib/bridge'
import { formatBytes, languageForPath } from '../lib/diff'
import { copyText, toFa } from '../lib/utils'
import { CodeView, DiffView } from './DiffView'
import {
  IconAlert,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDiff,
  IconExternal,
  IconFile,
  IconFileCode,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconGitCommit,
  IconGithub,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStop,
  IconTerminal,
  IconX,
} from './Icons'

type Tab = 'files' | 'changes' | 'terminal' | 'github'

interface WorkspacePanelProps {
  config: BridgeConfig
  status: BridgeStatus
  /** The single root this panel and all of its actions are scoped to. */
  workspace: WorkspaceInfo
  /** Current dock width in pixels, driven by the drag handle beside it. */
  width: number
  /** The most recent sidecar event; the panel refreshes the views it touches. */
  event: BridgeEvent | null
  onClose(): void
  onNotify(message: string, tone: 'success' | 'error'): void
}

const TABS: Array<{ id: Tab; label: string; icon: JSX.Element }> = [
  { id: 'files', label: 'فایل‌ها', icon: <IconFileCode /> },
  { id: 'changes', label: 'تغییرات', icon: <IconDiff /> },
  { id: 'terminal', label: 'ترمینال', icon: <IconTerminal /> },
  { id: 'github', label: 'GitHub', icon: <IconGithub /> },
]

export function WorkspacePanel({ config, status, workspace, width, event, onClose, onNotify }: WorkspacePanelProps) {
  const [tab, setTab] = useState<Tab>('files')
  const target = useMemo<BridgeTarget>(() => ({ config, workspace: workspace.id }), [config, workspace.id])

  const fail = useCallback(
    (error: unknown, fallback: string) =>
      onNotify(error instanceof Error ? error.message : fallback, 'error'),
    [onNotify],
  )

  return (
    <aside className="workspace-panel" style={{ width }}>
      <header className="wp-head">
        <div className="wp-identity">
          <IconFolderOpen />
          <div>
            <strong>{workspace.name}</strong>
            <small title={workspace.root}>{workspace.root}</small>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="بستن پنل Workspace"><IconX /></button>
      </header>

      <div className="wp-meta">
        {workspace.git.available && (
          <span className="wp-chip"><IconGitBranch />{workspace.git.branch}</span>
        )}
        {workspace.editors?.filter((editor) => editor.cliAvailable || editor.workspaceMarker).map((editor) => (
          <span className="wp-chip" key={editor.id}>{editor.name}</span>
        ))}
        <span className={`wp-chip${status.capabilities.write ? ' on' : ''}`}>
          {status.capabilities.write ? 'نوشتن فعال' : 'فقط خواندن'}
        </span>
        {status.capabilities.shell && <span className="wp-chip on">ترمینال</span>}
      </div>

      <nav className="wp-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`wp-tab${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="wp-body">
        {tab === 'files' && <FilesTab target={target} event={event} onError={fail} onNotify={onNotify} />}
        {tab === 'changes' && <ChangesTab target={target} status={status} workspace={workspace} event={event} onError={fail} onNotify={onNotify} />}
        {tab === 'terminal' && <TerminalTab target={target} status={status} event={event} onError={fail} />}
        {tab === 'github' && <GithubTab target={target} workspace={workspace} onError={fail} />}
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    files                                    */
/* -------------------------------------------------------------------------- */

interface TabProps {
  target: BridgeTarget
  onError(error: unknown, fallback: string): void
}

interface SearchHit {
  path: string
  line: number
  preview: string
}

function FilesTab({
  target,
  event,
  onError,
  onNotify,
}: TabProps & { event: BridgeEvent | null; onNotify(message: string, tone: 'success' | 'error'): void }) {
  const [folders, setFolders] = useState<Record<string, WorkspaceEntry[]>>({})
  const [open, setOpen] = useState<Set<string>>(() => new Set(['.']))
  const [file, setFile] = useState<WorkspaceFile | null>(null)
  const [activeLine, setActiveLine] = useState<number | undefined>()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)

  const loadFolder = useCallback(async (path: string) => {
    try {
      const result = await workspaceApi.children(target, path)
      setFolders((current) => ({ ...current, [path]: result.entries }))
    } catch (error) {
      onError(error, 'خواندن پوشه ناموفق بود.')
    }
  }, [target, onError])

  useEffect(() => { void loadFolder('.') }, [loadFolder])

  // A file the sidecar reports as changed is re-read only if it is on screen.
  useEffect(() => {
    if (event?.type !== 'fs.change') return
    if (event.payload.workspace && event.payload.workspace !== target.workspace) return
    const changed = event.payload.path
    const parent = changed.includes('/') ? changed.slice(0, changed.lastIndexOf('/')) : '.'
    if (folders[parent]) void loadFolder(parent)
    if (file && file.path === changed) {
      void workspaceApi.read(target, changed).then(setFile).catch(() => {})
    }
  }, [event]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(path: string) {
    const next = new Set(open)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      if (!folders[path]) await loadFolder(path)
    }
    setOpen(next)
  }

  const openFile = useCallback(async (path: string, line?: number) => {
    setBusy(true)
    try {
      setFile(await workspaceApi.read(target, path))
      setActiveLine(line)
    } catch (error) {
      onError(error, 'خواندن فایل ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }, [target, onError])

  async function search(event_: React.FormEvent) {
    event_.preventDefault()
    if (query.trim().length < 2) return
    setBusy(true)
    try {
      const result = await workspaceApi.search(target, { query: query.trim(), maxResults: 80 })
      setHits(result.matches)
    } catch (error) {
      onError(error, 'جستجو ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  async function openInEditor(path: string, line?: number) {
    try {
      const result = await workspaceApi.openInEditor(target, path, line)
      onNotify(`در ${result.editor} باز شد`, 'success')
    } catch (error) {
      onError(error, 'باز کردن در ادیتور ناموفق بود.')
    }
  }

  function renderTree(path: string, depth: number): JSX.Element[] {
    return (folders[path] ?? []).flatMap((entry) => {
      const isOpen = open.has(entry.path)
      const row = (
        <button
          key={entry.path}
          className={`wp-node${file?.path === entry.path ? ' active' : ''}`}
          style={{ paddingInlineStart: 8 + depth * 14 }}
          onClick={() => (entry.type === 'directory' ? toggle(entry.path) : openFile(entry.path))}
          title={entry.path}
        >
          {entry.type === 'directory'
            ? <span className="wp-caret">{isOpen ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
            : <span className="wp-caret" />}
          {entry.type === 'directory' ? <IconFolder size={14} /> : <IconFile size={14} />}
          <span className="wp-node-name">{entry.name}</span>
          {entry.type === 'file' && entry.size !== undefined && (
            <small className="wp-node-size">{formatBytes(entry.size)}</small>
          )}
        </button>
      )
      return entry.type === 'directory' && isOpen ? [row, ...renderTree(entry.path, depth + 1)] : [row]
    })
  }

  return (
    <div className="wp-split">
      <div className="wp-tree-pane">
        <form className="wp-search" onSubmit={search}>
          <IconSearch size={14} />
          <input
            className="input"
            value={query}
            placeholder="جستجو در فایل‌های پروژه…"
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value.trim()) setHits(null)
            }}
          />
          {hits && (
            <button type="button" className="icon-btn" onClick={() => { setHits(null); setQuery('') }} aria-label="پاک کردن جستجو">
              <IconX size={13} />
            </button>
          )}
        </form>

        {hits ? (
          <div className="wp-hits">
            <p className="wp-hint">{toFa(hits.length)} نتیجه</p>
            {hits.map((hit, index) => (
              <button className="wp-hit" key={`${hit.path}:${hit.line}:${index}`} onClick={() => openFile(hit.path, hit.line)}>
                <span className="wp-hit-path">{hit.path}<small>:{toFa(hit.line)}</small></span>
                <code dir="ltr">{hit.preview}</code>
              </button>
            ))}
            {hits.length === 0 && <p className="panel-empty">نتیجه‌ای پیدا نشد.</p>}
          </div>
        ) : (
          <div className="wp-tree">{renderTree('.', 0)}</div>
        )}
      </div>

      <div className="wp-file-pane">
        {busy && !file && <p className="panel-empty"><span className="spinner" /> در حال بارگذاری…</p>}
        {!file && !busy && <p className="panel-empty">یک فایل را انتخاب کنید تا اینجا نمایش داده شود.</p>}
        {file && (
          <>
            <div className="wp-file-head">
              <span className="wp-file-path" dir="ltr" title={file.path}>{file.path}</span>
              <span className="wp-file-actions">
                <small>{toFa(file.totalLines)} خط · {formatBytes(file.size)}</small>
                <button className="icon-btn" onClick={() => copyText(file.content)} title="کپی محتوا"><IconCopy size={13} /></button>
                <button className="icon-btn" onClick={() => openInEditor(file.path, activeLine)} title="باز کردن در ادیتور"><IconExternal size={13} /></button>
              </span>
            </div>
            <div className="wp-file-body">
              <CodeView content={file.content} language={languageForPath(file.path)} activeLine={activeLine} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   changes                                   */
/* -------------------------------------------------------------------------- */

/** Single-letter status marks, the way Git and Source Control views show them. */
const CHANGE_MARK: Record<string, { letter: string; title: string }> = {
  modified: { letter: 'M', title: 'تغییر کرده' },
  added: { letter: 'A', title: 'اضافه شده' },
  deleted: { letter: 'D', title: 'حذف شده' },
  renamed: { letter: 'R', title: 'تغییر نام' },
  copied: { letter: 'C', title: 'کپی' },
  conflicted: { letter: '!', title: 'تعارض' },
  untracked: { letter: 'U', title: 'ردگیری‌نشده' },
}

function changeState(file: GitFileChange): string {
  if (file.untracked) return 'untracked'
  return file.worktree ?? file.index ?? 'modified'
}

function ChangesTab({
  target,
  status,
  workspace,
  event,
  onError,
  onNotify,
}: TabProps & {
  status: BridgeStatus
  workspace: WorkspaceInfo
  event: BridgeEvent | null
  onNotify(message: string, tone: 'success' | 'error'): void
}) {
  const [git, setGit] = useState<GitStatus | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await gitApi.status(target)
      setGit(next)
      setSelected((current) => (current && next.files.some((file) => file.path === current) ? current : null))
    } catch (error) {
      onError(error, 'خواندن وضعیت Git ناموفق بود.')
    }
  }, [target, onError])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (event?.type === 'fs.change' && (!event.payload.workspace || event.payload.workspace === target.workspace)) void refresh()
  }, [event]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return setDiff('')
    let cancelled = false
    void gitApi.diff(target, { path: selected })
      .then((result) => { if (!cancelled) setDiff(result.stdout) })
      .catch(() => { if (!cancelled) setDiff('') })
    return () => { cancelled = true }
  }, [target, selected])

  async function act(action: () => Promise<unknown>, success: string, fallback: string) {
    setBusy(true)
    try {
      await action()
      onNotify(success, 'success')
      await refresh()
    } catch (error) {
      onError(error, fallback)
    } finally {
      setBusy(false)
    }
  }

  if (!workspace.git.available) return <p className="panel-empty">این Workspace یک مخزن Git نیست.</p>
  if (!git) return <p className="panel-empty"><span className="spinner" /> در حال خواندن وضعیت…</p>

  const staged = git.files.filter((file) => file.staged)
  const canWrite = status.capabilities.write

  const row = (file: GitFileChange) => {
    const state = changeState(file)
    const mark = CHANGE_MARK[state] ?? { letter: '?', title: state }
    const slash = file.path.lastIndexOf('/')
    return (
      <div className={`sc-row${selected === file.path ? ' active' : ''}`} key={file.path}>
        <button className="sc-file" onClick={() => setSelected(file.path)} title={file.path}>
          <IconFile size={13} />
          <span className="sc-name" dir="ltr">{slash < 0 ? file.path : file.path.slice(slash + 1)}</span>
          {slash > 0 && <span className="sc-dir" dir="ltr">{file.path.slice(0, slash)}</span>}
        </button>
        {canWrite && (
          <button
            className="sc-act"
            disabled={busy}
            title={file.staged ? 'خارج کردن از staging' : 'افزودن به staging'}
            onClick={() => act(
              () => (file.staged ? gitApi.unstage(target, file.path) : gitApi.stage(target, [file.path])),
              file.staged ? 'از staging خارج شد' : 'به staging اضافه شد',
              'تغییر staging ناموفق بود.',
            )}
          >
            {file.staged ? <IconX size={12} /> : <IconPlus size={12} />}
          </button>
        )}
        <span className={`sc-mark ${state}`} title={mark.title}>{mark.letter}</span>
      </div>
    )
  }

  return (
    <div className="wp-split">
      <div className="wp-tree-pane sc-pane">
        {canWrite && (
          <form
            className="sc-commit"
            onSubmit={(formEvent) => {
              formEvent.preventDefault()
              if (message.trim().length < 3 || git.clean) return
              void act(
                () => gitApi.commit(target, message.trim(), staged.length === 0),
                'commit ثبت شد',
                'ثبت commit ناموفق بود.',
              ).then(() => setMessage(''))
            }}
          >
            <input
              className="input sc-message"
              value={message}
              placeholder={`پیام commit روی ${git.branch}`}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              className="btn btn-primary sc-commit-btn"
              type="submit"
              disabled={busy || git.clean || message.trim().length < 3}
            >
              <IconGitCommit size={13} />
              {staged.length > 0 ? `Commit (${toFa(staged.length)})` : 'Commit'}
            </button>
          </form>
        )}

        <div className="sc-head">
          <span><IconGitBranch size={12} /> {git.branch}</span>
          <span className="wp-branch-track">
            {git.ahead > 0 && <small>↑{toFa(git.ahead)}</small>}
            {git.behind > 0 && <small>↓{toFa(git.behind)}</small>}
            {!git.clean && <span className="sc-count">{toFa(git.files.length)}</span>}
            <button className="sc-act" onClick={refresh} aria-label="تازه‌سازی"><IconRefresh size={12} /></button>
          </span>
        </div>

        {git.clean && <p className="panel-empty">چیزی تغییر نکرده است.</p>}

        {staged.length > 0 && (
          <>
            <div className="sc-group">Staged</div>
            {staged.map(row)}
            <div className="sc-group">Changes</div>
          </>
        )}
        {git.files.filter((file) => !file.staged).map(row)}
      </div>

      <div className="wp-file-pane">
        {selected ? (
          <>
            <div className="wp-file-head">
              <span className="wp-file-path" dir="ltr">{selected}</span>
            </div>
            <div className="wp-file-body">
              {diff ? <DiffView diff={diff} compact /> : <p className="panel-empty">این فایل هنوز در Git ردگیری نشده یا diff ندارد.</p>}
            </div>
          </>
        ) : (
          <p className="panel-empty">یک فایل تغییرکرده را انتخاب کنید تا diff آن را ببینید.</p>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  terminal                                   */
/* -------------------------------------------------------------------------- */

function TerminalTab({
  target,
  status,
  event,
  onError,
}: TabProps & { status: BridgeStatus; event: BridgeEvent | null }) {
  const [command, setCommand] = useState('')
  const [job, setJob] = useState<ShellJob | null>(null)
  const [output, setOutput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const element = outputRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output])

  // Live output arrives over the event stream; polling is only the fallback.
  useEffect(() => {
    if (!event || !job) return
    if (event.type === 'job.output' && event.payload.id === job.id && (!event.payload.workspace || event.payload.workspace === target.workspace)) {
      setOutput((current) => current + event.payload.chunk)
    }
    if (event.type === 'job.end' && event.payload.id === job.id && (!event.payload.workspace || event.payload.workspace === target.workspace)) {
      setJob(event.payload)
    }
  }, [event, job])

  useEffect(() => {
    if (!job?.running) return
    const timer = setInterval(() => {
      void shellApi.poll(target, job.id, output.length)
        .then((result) => {
          if (result.output) setOutput((current) => current + result.output)
          if (!result.running) setJob(result)
        })
        .catch(() => {})
    }, 1500)
    return () => clearInterval(timer)
  }, [target, job, output.length])

  if (!status.capabilities.shell) {
    return (
      <p className="panel-empty">
        اجرای ترمینال فعال نیست. پل محلی را با <code dir="ltr">--allow-shell</code> دوباره اجرا کنید.
      </p>
    )
  }

  async function run(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    const value = command.trim()
    if (!value || job?.running) return
    setOutput('')
    setCommand('')
    setHistory((current) => [value, ...current.filter((item) => item !== value)].slice(0, 12))
    try {
      setJob(await shellApi.start(target, value))
    } catch (error) {
      onError(error, 'اجرای دستور ناموفق بود.')
    }
  }

  return (
    <div className="wp-terminal">
      <form className="wp-term-form" onSubmit={run}>
        <input
          className="input input-ltr"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npm run build"
          spellCheck={false}
        />
        {job?.running ? (
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => shellApi.kill(target, job.id).then(setJob).catch((error) => onError(error, 'توقف ناموفق بود.'))}
          >
            <IconStop size={14} /> توقف
          </button>
        ) : (
          <button className="btn btn-primary" type="submit" disabled={!command.trim()}>اجرا</button>
        )}
      </form>

      {history.length > 0 && (
        <div className="wp-term-history">
          {history.map((item) => (
            <button key={item} className="wp-chip" onClick={() => setCommand(item)} dir="ltr">{item}</button>
          ))}
        </div>
      )}

      {job && (
        <div className="wp-term-status">
          <code dir="ltr">{job.command}</code>
          {job.running
            ? <span className="wp-chip on"><span className="spinner" /> در حال اجرا</span>
            : <span className={`wp-chip${job.exitCode === 0 ? ' on' : ' bad'}`}>exit {toFa(job.exitCode ?? 0)}</span>}
        </div>
      )}

      <pre className="wp-term-output" dir="ltr" ref={outputRef}>{output || 'خروجی اینجا نمایش داده می‌شود.'}</pre>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   github                                    */
/* -------------------------------------------------------------------------- */

interface RepoInfo {
  nameWithOwner: string
  url: string
  description?: string
  isPrivate?: boolean
  defaultBranchRef?: { name: string }
}

interface IssueRow {
  number: number
  title: string
  state: string
  url: string
  isDraft?: boolean
  headRefName?: string
}

function GithubTab({ target, workspace, onError }: TabProps & { workspace: WorkspaceInfo }) {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [issues, setIssues] = useState<IssueRow[]>([])
  const [prs, setPrs] = useState<IssueRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspace.github.available) return setLoading(false)
    let cancelled = false
    void Promise.all([
      callBridge<RepoInfo>(target.config, 'github.repo', { workspace: target.workspace }),
      callBridge<{ items: IssueRow[] }>(target.config, 'github.issues', { workspace: target.workspace, limit: 15 }),
      callBridge<{ items: IssueRow[] }>(target.config, 'github.prs', { workspace: target.workspace, limit: 15 }),
    ])
      .then(([repoInfo, issueList, prList]) => {
        if (cancelled) return
        setRepo(repoInfo)
        setIssues(issueList.items ?? [])
        setPrs(prList.items ?? [])
      })
      .catch((error) => { if (!cancelled) onError(error, 'خواندن اطلاعات GitHub ناموفق بود.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [target, workspace.github.available, onError])

  if (!workspace.github.available) {
    return (
      <p className="panel-empty">
        <IconAlert /> GitHub متصل نیست. در ترمینال <code dir="ltr">gh auth login</code> را اجرا کنید و دوباره وصل شوید.
      </p>
    )
  }
  if (loading) return <p className="panel-empty"><span className="spinner" /> در حال خواندن از GitHub…</p>

  return (
    <div className="wp-github">
      {repo && (
        <a className="wp-repo" href={repo.url} target="_blank" rel="noreferrer">
          <strong dir="ltr">{repo.nameWithOwner}</strong>
          {repo.description && <small>{repo.description}</small>}
          <span className="wp-chip">{repo.isPrivate ? 'خصوصی' : 'عمومی'}</span>
          {repo.defaultBranchRef && <span className="wp-chip">{repo.defaultBranchRef.name}</span>}
        </a>
      )}

      <h4 className="wp-section-title">Pull Requestها</h4>
      {prs.length === 0 && <p className="panel-empty">PR بازی وجود ندارد.</p>}
      {prs.map((pr) => (
        <a className="wp-issue" key={pr.number} href={pr.url} target="_blank" rel="noreferrer">
          <span className="wp-issue-number">#{toFa(pr.number)}</span>
          <span className="wp-issue-title">{pr.title}</span>
          {pr.isDraft && <span className="wp-chip">پیش‌نویس</span>}
        </a>
      ))}

      <h4 className="wp-section-title">Issueهای باز</h4>
      {issues.length === 0 && <p className="panel-empty">Issue بازی وجود ندارد.</p>}
      {issues.map((issue) => (
        <a className="wp-issue" key={issue.number} href={issue.url} target="_blank" rel="noreferrer">
          <span className="wp-issue-number">#{toFa(issue.number)}</span>
          <span className="wp-issue-title">{issue.title}</span>
        </a>
      ))}
    </div>
  )
}
