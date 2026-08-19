/**
 * Browser client for the localhost workspace sidecar.
 *
 * Everything the UI and the tool layer know about the real filesystem goes
 * through here: one authenticated `POST /rpc` per call, plus a long-lived
 * `GET /events` stream that reports file changes and terminal output.
 */
import type {
  BridgeConfig,
  BridgeEvent,
  BridgeStatus,
  EditResult,
  GitCommit,
  GitStatus,
  Project,
  ShellJob,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
} from '../types'

/**
 * A connection plus the root a call is aimed at. Every typed helper below takes
 * one of these, so adding a workspace never changes a call site's shape.
 */
export interface BridgeTarget {
  config: BridgeConfig
  workspace: string
}

export class BridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}

export function normalizeBridgeUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) return 'http://127.0.0.1:4312'
  return /^https?:\/\//i.test(value) ? value : `http://${value}`
}

const OFFLINE = 'پل محلی در دسترس نیست. اجرای npm run bridge و آدرس اتصال را بررسی کنید.'

async function bridgeFetch(config: BridgeConfig, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${normalizeBridgeUrl(config.baseUrl)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token.trim()}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new BridgeError(OFFLINE)
  }
}

async function readResult<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) {
    throw new BridgeError(String(body?.error || `درخواست پل محلی ناموفق بود (${response.status}).`))
  }
  return (body?.result ?? body) as T
}

/**
 * A sidecar from before multi-root answered with a single `workspace` object.
 * Folding it into a one-element list keeps an older running bridge usable
 * instead of failing with a confusing "no workspaces" screen.
 */
function normalizeStatus(raw: BridgeStatus & { workspace?: Partial<WorkspaceInfo> }): BridgeStatus {
  if (Array.isArray(raw.workspaces) && raw.workspaces.length) {
    return { ...raw, workspaces: raw.workspaces }
  }

  const legacy = raw as unknown as {
    workspace?: { name?: string; root?: string }
    editors?: WorkspaceInfo['editors']
    git?: WorkspaceInfo['git']
    github?: WorkspaceInfo['github']
  }
  if (!legacy.workspace?.root) return { ...raw, workspaces: [] }

  return {
    ...raw,
    workspaces: [{
      id: 'default',
      name: legacy.workspace.name || legacy.workspace.root,
      root: legacy.workspace.root,
      editors: legacy.editors,
      git: legacy.git ?? { available: false },
      github: legacy.github ?? { available: false },
    }],
  }
}

export async function probeBridge(config: BridgeConfig, signal?: AbortSignal): Promise<BridgeStatus> {
  return normalizeStatus(await readResult(await bridgeFetch(config, '/health', { signal })))
}

/**
 * Which root the app should be pointed at: the active project's folder when it
 * is connected, otherwise the user's manual pick, otherwise the first root.
 */
export function resolveWorkspace(
  status: BridgeStatus | null,
  project: Project | null,
  fallbackId?: string | null,
): WorkspaceInfo | null {
  const list = status?.workspaces ?? []
  if (!list.length) return null

  if (project?.workspaceRoot) {
    const linked = list.find((item) => item.root === project.workspaceRoot)
      ?? (project.workspaceId ? list.find((item) => item.id === project.workspaceId) : undefined)
    // A project pinned to a folder that is not connected has no workspace at
    // all — silently falling back to another repo would edit the wrong code.
    return linked ?? null
  }

  return list.find((item) => item.id === fallbackId) ?? list[0]
}

export async function callBridge<T = unknown>(
  config: BridgeConfig,
  method: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  return readResult<T>(
    await bridgeFetch(config, '/rpc', {
      method: 'POST',
      body: JSON.stringify({ method, params }),
      signal,
    }),
  )
}

/* -------------------------------------------------------------------------- */
/*                                typed calls                                  */
/* -------------------------------------------------------------------------- */

/**
 * The methods the UI itself uses. The model reaches the same sidecar through
 * `lib/tools.ts`, which keeps its own allow-list and approval gate.
 */
function callTarget<T = unknown>(
  target: BridgeTarget,
  method: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  return callBridge<T>(target.config, method, { ...params, workspace: target.workspace }, signal)
}

export const workspaceApi = {
  children: (target: BridgeTarget, path = '.', signal?: AbortSignal) =>
    callTarget<{ path: string; entries: WorkspaceEntry[] }>(target, 'workspace.children', { path }, signal),

  read: (target: BridgeTarget, path: string, signal?: AbortSignal) =>
    callTarget<WorkspaceFile>(target, 'workspace.read', { path }, signal),

  search: (
    target: BridgeTarget,
    params: { query: string; path?: string; include?: string; regex?: boolean; maxResults?: number },
    signal?: AbortSignal,
  ) =>
    callTarget<{ matches: Array<{ path: string; line: number; preview: string }>; scanned: number; truncated: boolean }>(
      target, 'workspace.search', params, signal,
    ),

  write: (target: BridgeTarget, path: string, content: string, signal?: AbortSignal) =>
    callTarget<EditResult>(target, 'workspace.write', { path, content }, signal),

  openInEditor: (target: BridgeTarget, path: string, line?: number, editor?: string) =>
    callTarget<{ opened: string; editor: string; line?: number }>(target, 'editor.open', { path, line, editor }),
}

export const gitApi = {
  status: (target: BridgeTarget, signal?: AbortSignal) =>
    callTarget<GitStatus>(target, 'git.status', {}, signal),

  diff: (target: BridgeTarget, params: { path?: string; staged?: boolean } = {}, signal?: AbortSignal) =>
    callTarget<{ ok: boolean; stdout: string; stderr: string }>(target, 'git.diff', params, signal),

  log: (target: BridgeTarget, limit = 20, signal?: AbortSignal) =>
    callTarget<{ commits: GitCommit[] }>(target, 'git.log', { limit }, signal),

  branches: (target: BridgeTarget, signal?: AbortSignal) =>
    callTarget<{ branches: Array<{ name: string; current: boolean; upstream?: string }> }>(
      target, 'git.branches', {}, signal,
    ),

  stage: (target: BridgeTarget, paths: string[]) =>
    callTarget<{ ok: boolean; stderr: string }>(target, 'git.add', { paths }),

  unstage: (target: BridgeTarget, path?: string) =>
    callTarget<{ ok: boolean; stderr: string }>(target, 'git.unstage', { path }),

  commit: (target: BridgeTarget, message: string, all = false) =>
    callTarget<{ ok: boolean; stdout: string; stderr: string }>(target, 'git.commit', { message, all }),
}

export const shellApi = {
  start: (target: BridgeTarget, command: string, cwd = '.') =>
    callTarget<ShellJob>(target, 'shell.start', { command, cwd }),

  poll: (target: BridgeTarget, id: string, offset: number, signal?: AbortSignal) =>
    callTarget<ShellJob & { output: string; offset: number }>(target, 'shell.poll', { id, offset }, signal),

  kill: (target: BridgeTarget, id: string) => callTarget<ShellJob>(target, 'shell.kill', { id }),

  jobs: (target: BridgeTarget, signal?: AbortSignal) =>
    callTarget<{ jobs: ShellJob[] }>(target, 'shell.jobs', {}, signal),
}

/* -------------------------------------------------------------------------- */
/*                                event stream                                 */
/* -------------------------------------------------------------------------- */

/**
 * Subscribes to the sidecar's event stream.
 *
 * `EventSource` cannot send an Authorization header, so the stream is read as a
 * plain streamed fetch body instead — same SSE framing, real bearer auth.
 * Returns an unsubscribe function; reconnection is the caller's business.
 */
export function subscribeBridgeEvents(
  config: BridgeConfig,
  onEvent: (event: BridgeEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  const controller = new AbortController()

  void (async () => {
    try {
      const response = await bridgeFetch(config, '/events', { signal: controller.signal })
      if (!response.ok || !response.body) throw new BridgeError('اتصال به جریان رویدادها ناموفق بود.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')

          const data = frame.split('\n').find((line) => line.startsWith('data:'))
          if (!data) continue // a `: ping` heartbeat
          try {
            onEvent(JSON.parse(data.slice(5).trim()) as BridgeEvent)
          } catch {
            /* a truncated frame is not worth tearing the stream down for */
          }
        }
      }
      if (!controller.signal.aborted) onError?.(new BridgeError('جریان رویدادهای Workspace بسته شد.'))
    } catch (error) {
      if (controller.signal.aborted) return
      onError?.(error instanceof Error ? error : new BridgeError(OFFLINE))
    }
  })()

  return () => controller.abort()
}
