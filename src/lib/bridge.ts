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
  ShellJob,
  WorkspaceEntry,
  WorkspaceFile,
} from '../types'

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

export async function probeBridge(config: BridgeConfig, signal?: AbortSignal): Promise<BridgeStatus> {
  return readResult<BridgeStatus>(await bridgeFetch(config, '/health', { signal }))
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
export const workspaceApi = {
  children: (config: BridgeConfig, path = '.', signal?: AbortSignal) =>
    callBridge<{ path: string; entries: WorkspaceEntry[] }>(config, 'workspace.children', { path }, signal),

  read: (config: BridgeConfig, path: string, signal?: AbortSignal) =>
    callBridge<WorkspaceFile>(config, 'workspace.read', { path }, signal),

  search: (
    config: BridgeConfig,
    params: { query: string; path?: string; include?: string; regex?: boolean; maxResults?: number },
    signal?: AbortSignal,
  ) =>
    callBridge<{ matches: Array<{ path: string; line: number; preview: string }>; scanned: number; truncated: boolean }>(
      config, 'workspace.search', params, signal,
    ),

  write: (config: BridgeConfig, path: string, content: string, signal?: AbortSignal) =>
    callBridge<EditResult>(config, 'workspace.write', { path, content }, signal),

  openInEditor: (config: BridgeConfig, path: string, line?: number, editor?: string) =>
    callBridge<{ opened: string; editor: string; line?: number }>(config, 'editor.open', { path, line, editor }),
}

export const gitApi = {
  status: (config: BridgeConfig, signal?: AbortSignal) =>
    callBridge<GitStatus>(config, 'git.status', {}, signal),

  diff: (config: BridgeConfig, params: { path?: string; staged?: boolean } = {}, signal?: AbortSignal) =>
    callBridge<{ ok: boolean; stdout: string; stderr: string }>(config, 'git.diff', params, signal),

  log: (config: BridgeConfig, limit = 20, signal?: AbortSignal) =>
    callBridge<{ commits: GitCommit[] }>(config, 'git.log', { limit }, signal),

  branches: (config: BridgeConfig, signal?: AbortSignal) =>
    callBridge<{ branches: Array<{ name: string; current: boolean; upstream?: string }> }>(
      config, 'git.branches', {}, signal,
    ),

  stage: (config: BridgeConfig, paths: string[]) =>
    callBridge<{ ok: boolean; stderr: string }>(config, 'git.add', { paths }),

  unstage: (config: BridgeConfig, path?: string) =>
    callBridge<{ ok: boolean; stderr: string }>(config, 'git.unstage', { path }),

  commit: (config: BridgeConfig, message: string, all = false) =>
    callBridge<{ ok: boolean; stdout: string; stderr: string }>(config, 'git.commit', { message, all }),
}

export const shellApi = {
  start: (config: BridgeConfig, command: string, cwd = '.') =>
    callBridge<ShellJob>(config, 'shell.start', { command, cwd }),

  poll: (config: BridgeConfig, id: string, offset: number, signal?: AbortSignal) =>
    callBridge<ShellJob & { output: string; offset: number }>(config, 'shell.poll', { id, offset }, signal),

  kill: (config: BridgeConfig, id: string) => callBridge<ShellJob>(config, 'shell.kill', { id }),

  jobs: (config: BridgeConfig, signal?: AbortSignal) =>
    callBridge<{ jobs: ShellJob[] }>(config, 'shell.jobs', {}, signal),
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
