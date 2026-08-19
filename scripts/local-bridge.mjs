#!/usr/bin/env node
/**
 * Local workspace bridge.
 *
 * A dependency-free HTTP sidecar that exposes one or more folders — the ones the
 * user has open in VS Code or Cursor — to the browser client over localhost.
 * Every request is path-jailed to the root it names, carries a bearer token, and
 * mutating capabilities stay off until they are explicitly enabled. The
 * capability flags apply to every root: one session, one level of trust.
 *
 *   node scripts/local-bridge.mjs --workspace "D:\repo" --workspace "D:\api" --allow-write
 */
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const VERSION = '2.0.0'
const MAX_BODY = 2_000_000
const MAX_FILE = 1_200_000
const MAX_OUTPUT = 180_000
const MAX_JOB_BUFFER = 400_000
const DEFAULT_PORT = 4312
const TREE_LIMIT = 4000
const SEARCH_FILE_LIMIT = 4000
const SEARCH_MATCH_LIMIT = 200

/** Never walked into, never searched, never watched. */
const IGNORED = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo',
  '.cache', 'coverage', '.venv', 'venv', '__pycache__', 'target', 'vendor',
  '.gradle', '.idea', '.svelte-kit', '.parcel-cache', '.pytest_cache',
])

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'pdf',
  'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'class', 'jar',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'webm',
  'wasm', 'bin', 'db', 'sqlite',
])

/* -------------------------------------------------------------------------- */
/*                                    args                                     */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const value = (name, fallback) => {
    const index = argv.indexOf(name)
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
  }
  // `--workspace` is repeatable: every occurrence adds another root.
  const folders = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--workspace') continue
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) folders.push(resolve(next))
  }
  const all = argv.includes('--allow-all')
  return {
    workspaces: folders.length ? folders : [resolve(process.cwd())],
    port: Number(value('--port', process.env.BRIDGE_PORT ?? DEFAULT_PORT)),
    token: value('--token', process.env.BRIDGE_TOKEN ?? randomBytes(24).toString('base64url')),
    allowWrite: all || argv.includes('--allow-write'),
    allowShell: all || argv.includes('--allow-shell'),
    allowGithubWrite: all || argv.includes('--allow-github-write'),
    selfTest: argv.includes('--self-test'),
  }
}

/* -------------------------------------------------------------------------- */
/*                              workspace registry                             */
/* -------------------------------------------------------------------------- */

/** A URL/JSON-safe id derived from the folder name, e.g. `chat-bot`. */
function slugify(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'workspace'
}

/**
 * Turns the resolved `--workspace` folders into `{ id, name, root }` records.
 * Duplicate names get a numeric suffix so ids stay unique and stable across
 * restarts as long as the folder set is the same.
 */
async function buildWorkspaces(folders) {
  const seen = new Map()
  const list = []

  for (const folder of folders) {
    const root = await realpath(folder)
    if (!(await stat(root)).isDirectory()) throw new Error(`Workspace must be a directory: ${folder}`)
    if (list.some((item) => item.root === root)) continue

    const name = basename(root) || root
    const base = slugify(name)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    list.push({ id: count === 1 ? base : `${base}-${count}`, name, root })
  }

  if (!list.length) throw new Error('No workspace folder was resolved.')
  return list
}

/**
 * Picks the root a request is talking about. `params.workspace` may be an id or
 * an absolute path; when it is missing the first workspace is used, which keeps
 * single-root callers working unchanged.
 */
function resolveWorkspace(workspaces, requested) {
  if (requested === undefined || requested === null || requested === '') return workspaces[0]
  const wanted = String(requested)
  const match = workspaces.find((item) => item.id === wanted)
    || workspaces.find((item) => item.root === resolve(wanted))
  if (!match) throw new Error(`Workspace شناخته‌شده نیست: ${wanted}`)
  return match
}

/* -------------------------------------------------------------------------- */
/*                                  path jail                                  */
/* -------------------------------------------------------------------------- */

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function safeRelativePath(value = '.') {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('مسیر نامعتبر است.')
  const trimmed = value.trim()
  if (isAbsolute(trimmed)) throw new Error('فقط مسیر نسبی داخل Workspace مجاز است.')
  return trimmed.replaceAll('\\', '/') || '.'
}

function toRel(root, absolute) {
  return relative(root, absolute).replaceAll('\\', '/') || '.'
}

/**
 * Resolves a caller-supplied relative path to a real path inside the root.
 * `create: true` allows a not-yet-existing leaf as long as its parent is inside.
 */
async function confinedPath(root, requested, { create = false } = {}) {
  const rel = safeRelativePath(requested)
  const target = resolve(root, rel)
  if (!inside(root, target)) throw new Error('دسترسی خارج از Workspace مجاز نیست.')

  if (create) {
    // Walk up to the nearest folder that exists and verify *it* is inside the
    // jail, so a new file may sit under directories we are about to create.
    const missing = []
    let cursor = target
    let physicalParent = null
    while (cursor !== dirname(cursor)) {
      missing.unshift(basename(cursor))
      cursor = dirname(cursor)
      physicalParent = await realpath(cursor).catch(() => null)
      if (physicalParent) break
    }
    if (!physicalParent || !inside(root, physicalParent)) throw new Error('پوشه‌ی مقصد معتبر نیست.')
    return join(physicalParent, ...missing)
  }

  const physical = await realpath(target).catch(() => null)
  if (!physical) throw new Error(`مسیر پیدا نشد: ${rel}`)
  if (!inside(root, physical)) throw new Error('Symlink خارج از Workspace مجاز نیست.')
  return physical
}

function isProbablyBinaryName(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return BINARY_EXT.has(ext)
}

/* -------------------------------------------------------------------------- */
/*                                 processes                                   */
/* -------------------------------------------------------------------------- */

function clip(value, max = MAX_OUTPUT) {
  const output = String(value ?? '')
  return output.length > max ? `${output.slice(0, max)}\n… (خروجی کوتاه شد)` : output
}

async function runFile(command, args, cwd, timeout = 30_000) {
  try {
    const result = await execFileAsync(command, args, {
      cwd, timeout, windowsHide: true, maxBuffer: MAX_OUTPUT * 2, encoding: 'utf8',
    })
    return { ok: true, stdout: clip(result.stdout), stderr: clip(result.stderr), exitCode: 0 }
  } catch (error) {
    return {
      ok: false,
      stdout: clip(error?.stdout),
      stderr: clip(error?.stderr || error?.message),
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
    }
  }
}

async function runJson(command, args, cwd, timeout = 20_000) {
  const result = await runFile(command, args, cwd, timeout)
  if (!result.ok) throw new Error(result.stderr.trim() || `اجرای ${command} ناموفق بود.`)
  try {
    return JSON.parse(result.stdout || 'null')
  } catch {
    throw new Error(`خروجی ${command} قابل خواندن نبود.`)
  }
}

function shellArgs(command) {
  return process.platform === 'win32'
    ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]]
    : ['/bin/sh', ['-lc', command]]
}

/* -------------------------------------------------------------------------- */
/*                              unified diffs                                  */
/* -------------------------------------------------------------------------- */

/** Longest common subsequence over lines — small files only, which is all we edit. */
function lcsTable(a, b) {
  const cols = b.length + 1
  const table = new Uint32Array((a.length + 1) * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
    }
  }
  return table
}

function diffLines(a, b) {
  if (a.length * b.length > 4_000_000) {
    return [...a.map((line) => ({ type: '-', line })), ...b.map((line) => ({ type: '+', line }))]
  }
  const cols = b.length + 1
  const table = lcsTable(a, b)
  const ops = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: ' ', line: a[i] }); i += 1; j += 1 }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) { ops.push({ type: '-', line: a[i] }); i += 1 }
    else { ops.push({ type: '+', line: b[j] }); j += 1 }
  }
  while (i < a.length) { ops.push({ type: '-', line: a[i] }); i += 1 }
  while (j < b.length) { ops.push({ type: '+', line: b[j] }); j += 1 }
  return ops
}

/** Builds a git-style unified diff so the UI can render a real review view. */
function unifiedDiff(path, before, after, context = 3) {
  if (before === after) return { diff: '', added: 0, removed: 0 }
  const a = before.length ? before.split('\n') : []
  const b = after.length ? after.split('\n') : []
  const ops = diffLines(a, b)

  const added = ops.reduce((total, op) => total + (op.type === '+' ? 1 : 0), 0)
  const removed = ops.reduce((total, op) => total + (op.type === '-' ? 1 : 0), 0)

  const hunks = []
  let index = 0
  let oldLine = 1
  let newLine = 1

  while (index < ops.length) {
    if (ops[index].type === ' ') {
      oldLine += 1
      newLine += 1
      index += 1
      continue
    }

    let leading = 0
    while (leading < context && index - leading - 1 >= 0 && ops[index - leading - 1].type === ' ') leading += 1

    // Extend the hunk while changes keep appearing within `context * 2` lines.
    let end = index
    let quiet = 0
    while (end < ops.length && quiet <= context * 2) {
      quiet = ops[end].type === ' ' ? quiet + 1 : 0
      end += 1
    }
    const stop = end - Math.max(0, quiet - Math.min(context, quiet))

    const slice = ops.slice(index - leading, stop)
    const oldStart = oldLine - leading
    const newStart = newLine - leading
    let oldCount = 0
    let newCount = 0
    const body = slice.map((op) => {
      if (op.type !== '+') oldCount += 1
      if (op.type !== '-') newCount += 1
      return `${op.type}${op.line}`
    })
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.join('\n')}`)

    for (let k = index; k < stop; k += 1) {
      if (ops[k].type !== '+') oldLine += 1
      if (ops[k].type !== '-') newLine += 1
    }
    index = stop
  }

  return { diff: `--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}`, added, removed }
}

/* -------------------------------------------------------------------------- */
/*                              editor detection                               */
/* -------------------------------------------------------------------------- */

const EDITORS = [
  { id: 'vscode', name: 'VS Code', cli: 'code', marker: '.vscode' },
  { id: 'cursor', name: 'Cursor', cli: 'cursor', marker: '.cursor' },
  { id: 'windsurf', name: 'Windsurf', cli: 'windsurf', marker: '.windsurf' },
]

/** Per-root, because `workspaceMarker` (`.vscode`, `.cursor`…) is per-root. */
const editorCache = new Map()

async function detectEditors(root) {
  const cached = editorCache.get(root)
  if (cached) return cached
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const detected = await Promise.all(EDITORS.map(async (editor) => {
    const [cliAvailable, workspaceMarker] = await Promise.all([
      runFile(probe, [editor.cli], root, 6_000).then((result) => result.ok),
      stat(join(root, editor.marker)).then(() => true).catch(() => false),
    ])
    return { id: editor.id, name: editor.name, cli: editor.cli, cliAvailable, workspaceMarker }
  }))
  editorCache.set(root, detected)
  return detected
}

/* -------------------------------------------------------------------------- */
/*                                   health                                    */
/* -------------------------------------------------------------------------- */

function redactRemote(remote) {
  const value = String(remote || '').trim()
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.replace(/^(https?:\/\/)[^/@]+@/i, '$1')
  }
}

/**
 * Probing git, gh and the editor CLIs costs several `execFile` calls per root,
 * and `/health` is polled. A few seconds of cache keeps a multi-root probe as
 * cheap as a single-root one without ever showing a stale branch for long.
 */
const STATUS_TTL = 5_000
const statusCache = new Map()

async function workspaceStatus(workspace) {
  const cached = statusCache.get(workspace.root)
  if (cached && Date.now() - cached.at < STATUS_TTL) return cached.value

  const value = await probeWorkspace(workspace)
  statusCache.set(workspace.root, { at: Date.now(), value })
  return value
}

async function probeWorkspace({ id, name, root }) {
  const [branchResult, editors, githubResult] = await Promise.all([
    runFile('git', ['branch', '--show-current'], root, 5_000),
    detectEditors(root),
    runFile('gh', ['api', 'user', '--jq', '.login'], root, 8_000),
  ])

  const [remoteResult, aheadBehind] = branchResult.ok
    ? await Promise.all([
        runFile('git', ['config', '--get', 'remote.origin.url'], root, 5_000),
        runFile('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root, 5_000),
      ])
    : [{ ok: false, stdout: '' }, { ok: false, stdout: '' }]

  const [ahead = 0, behind = 0] = aheadBehind.ok
    ? aheadBehind.stdout.trim().split(/\s+/).map(Number)
    : []

  return {
    id,
    name,
    root,
    editors,
    git: {
      available: branchResult.ok,
      ...(branchResult.ok ? { branch: branchResult.stdout.trim() || 'HEAD', ahead, behind } : {}),
      ...(remoteResult.ok && remoteResult.stdout.trim() ? { remote: redactRemote(remoteResult.stdout) } : {}),
    },
    github: {
      available: githubResult.ok,
      ...(githubResult.ok ? { login: githubResult.stdout.trim() } : {}),
    },
  }
}

/**
 * Connection-level status. `workspaces` describes every root; `workspace` is the
 * one this particular call resolved to, so `system.health` still answers "where
 * am I" for whoever asked.
 */
async function healthStatus(workspaces, resolved, options) {
  const list = await Promise.all(workspaces.map(workspaceStatus))

  return {
    connected: true,
    version: VERSION,
    platform: process.platform,
    workspaces: list,
    workspace: list.find((item) => item.id === resolved.id) ?? list[0],
    capabilities: {
      read: true,
      write: options.allowWrite,
      shell: options.allowShell,
      githubWrite: options.allowGithubWrite,
      watch: watchers.size > 0,
    },
  }
}

/* -------------------------------------------------------------------------- */
/*                                  workspace                                  */
/* -------------------------------------------------------------------------- */

async function listChildren(root, requested) {
  const start = await confinedPath(root, requested)
  if (!(await stat(start)).isDirectory()) throw new Error('مسیر باید یک پوشه باشد.')
  const entries = await readdir(start, { withFileTypes: true })
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))

  const rows = []
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    const absolute = join(start, entry.name)
    const info = await stat(absolute).catch(() => null)
    rows.push({
      name: entry.name,
      path: toRel(root, absolute),
      type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file',
      ...(info?.isFile() ? { size: info.size, binary: isProbablyBinaryName(entry.name) } : {}),
      ...(info ? { modifiedAt: Math.round(info.mtimeMs) } : {}),
    })
  }
  return { path: toRel(root, start), entries: rows }
}

async function listTree(root, requested, depth = 2) {
  const start = await confinedPath(root, requested)
  if (!(await stat(start)).isDirectory()) throw new Error('مسیر باید یک پوشه باشد.')
  const rows = []
  const maxDepth = Math.max(0, Math.min(Number(depth) || 2, 6))

  async function walk(folder, level) {
    if (rows.length >= TREE_LIMIT) return
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (rows.length >= TREE_LIMIT || IGNORED.has(entry.name)) continue
      const absolute = join(folder, entry.name)
      const rel = toRel(root, absolute)
      if (entry.isSymbolicLink()) rows.push({ path: rel, type: 'symlink' })
      else if (entry.isDirectory()) {
        rows.push({ path: rel, type: 'directory' })
        if (level < maxDepth) await walk(absolute, level + 1)
      } else if (entry.isFile()) rows.push({ path: rel, type: 'file' })
    }
  }

  await walk(start, 0)
  return { entries: rows, truncated: rows.length >= TREE_LIMIT }
}

async function readTextFile(root, requested, { offset = 0, limit = 0 } = {}) {
  const target = await confinedPath(root, requested)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('مسیر باید یک فایل باشد.')
  if (info.size > MAX_FILE) throw new Error(`فایل بزرگ‌تر از ${MAX_FILE} بایت است و خوانده نمی‌شود.`)
  const content = await readFile(target, 'utf8')
  if (content.includes('\0')) throw new Error('خواندن فایل باینری پشتیبانی نمی‌شود.')

  const path = toRel(root, target)
  const totalLines = content.length ? content.split('\n').length : 0
  const from = Math.max(0, Number(offset) || 0)
  const count = Math.max(0, Number(limit) || 0)
  if (!from && !count) {
    return { path, content, size: info.size, totalLines, modifiedAt: Math.round(info.mtimeMs) }
  }

  const lines = content.split('\n').slice(from, count ? from + count : undefined)
  return {
    path,
    content: lines.join('\n'),
    size: info.size,
    totalLines,
    offset: from,
    partial: true,
    modifiedAt: Math.round(info.mtimeMs),
  }
}

/** Converts a `**\/*.ts`-style glob into a RegExp anchored at the workspace root. */
function globToRegExp(pattern) {
  const escaped = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('\u0000', '(?:.*/)?')
    .replaceAll('\u0001', '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

async function collectFiles(root, start, { limit = SEARCH_FILE_LIMIT, filter } = {}) {
  const files = []
  async function walk(folder) {
    if (files.length >= limit) return
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= limit || IGNORED.has(entry.name) || entry.isSymbolicLink()) continue
      const absolute = join(folder, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) {
        const rel = toRel(root, absolute)
        if (!filter || filter(rel, entry.name)) files.push({ absolute, rel })
      }
    }
  }
  await walk(start)
  return files
}

async function globWorkspace(root, pattern, requested = '.') {
  if (typeof pattern !== 'string' || !pattern.trim()) throw new Error('الگوی glob خالی است.')
  const matcher = globToRegExp(pattern.trim())
  const start = await confinedPath(root, requested)
  const files = await collectFiles(root, start, { filter: (rel) => matcher.test(rel) })
  return { pattern: pattern.trim(), files: files.slice(0, 400).map((file) => file.rel), truncated: files.length > 400 }
}

async function searchWorkspace(root, params) {
  const query = String(params.query ?? '')
  if (query.trim().length < 2) throw new Error('عبارت جستجو باید حداقل دو نویسه باشد.')

  const useRegex = params.regex === true
  const caseSensitive = params.caseSensitive === true
  let matcher = null
  if (useRegex) {
    try {
      matcher = new RegExp(query, caseSensitive ? '' : 'i')
    } catch {
      throw new Error('الگوی regex معتبر نیست.')
    }
  }
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const include = typeof params.include === 'string' && params.include.trim()
    ? globToRegExp(params.include.trim())
    : null

  const start = await confinedPath(root, params.path ?? '.')
  if (!(await stat(start)).isDirectory()) throw new Error('مسیر جستجو باید پوشه باشد.')

  const cap = Math.max(1, Math.min(Number(params.maxResults) || 60, SEARCH_MATCH_LIMIT))
  const files = await collectFiles(root, start, {
    filter: (rel, name) => !isProbablyBinaryName(name) && (!include || include.test(rel)),
  })

  const matches = []
  let scanned = 0
  for (const file of files) {
    if (matches.length >= cap) break
    const info = await stat(file.absolute).catch(() => null)
    if (!info?.size || info.size > 400_000) continue
    const body = await readFile(file.absolute, 'utf8').catch(() => '')
    if (!body || body.includes('\0')) continue
    scanned += 1
    const lines = body.split(/\r?\n/)
    for (let index = 0; index < lines.length && matches.length < cap; index += 1) {
      const line = lines[index]
      const hit = useRegex
        ? matcher.test(line)
        : (caseSensitive ? line : line.toLocaleLowerCase()).includes(needle)
      if (hit) matches.push({ path: file.rel, line: index + 1, preview: line.trim().slice(0, 260) })
    }
  }

  return { matches, scanned, truncated: matches.length >= cap || files.length >= SEARCH_FILE_LIMIT }
}

/* -------------------------------------------------------------------------- */
/*                                 mutations                                   */
/* -------------------------------------------------------------------------- */

function assertWritable(options) {
  if (!options.allowWrite) throw new Error('نوشتن فایل فعال نیست. پل را با --allow-write اجرا کنید.')
}

async function writeFileAt(root, requested, content, { overwrite }) {
  const target = await confinedPath(root, requested, { create: true })
  if (Buffer.byteLength(content) > MAX_FILE) throw new Error('محتوای فایل بیش از حد بزرگ است.')

  const existing = await stat(target).catch(() => null)
  if (existing && !overwrite) throw new Error('فایل از قبل وجود دارد؛ برای تغییر از workspace.edit استفاده کنید.')
  if (existing && !existing.isFile()) throw new Error('مسیر مقصد یک فایل نیست.')

  const before = existing ? await readFile(target, 'utf8').catch(() => '') : ''
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')

  const path = toRel(root, target)
  const { diff, added, removed } = unifiedDiff(path, before, content)
  return { path, bytes: Buffer.byteLength(content), created: !existing, diff, added, removed }
}

/** Applies — or, with `dryRun`, only previews — a literal replacement in a file. */
async function editFileAt(root, params, { dryRun = false } = {}) {
  const target = await confinedPath(root, params.path)
  const before = await readTextFile(root, params.path)
  const oldText = String(params.oldText ?? '')
  const newText = String(params.newText ?? '')
  if (!oldText) throw new Error('oldText نباید خالی باشد.')

  const replaceAll = params.replaceAll === true
  const occurrences = before.content.split(oldText).length - 1
  if (occurrences === 0) throw new Error('متن موردنظر در فایل پیدا نشد.')
  if (occurrences > 1 && !replaceAll) {
    throw new Error(`متن موردنظر ${occurrences} بار تکرار شده است؛ بخش بزرگ‌تری بفرستید یا replaceAll را true کنید.`)
  }

  const next = replaceAll
    ? before.content.split(oldText).join(newText)
    : before.content.replace(oldText, newText)
  if (Buffer.byteLength(next) > MAX_FILE) throw new Error('فایل نهایی بیش از حد بزرگ است.')

  const { diff, added, removed } = unifiedDiff(before.path, before.content, next)
  if (!dryRun) await writeFile(target, next, 'utf8')
  return {
    path: before.path,
    replacements: replaceAll ? occurrences : 1,
    bytes: Buffer.byteLength(next),
    applied: !dryRun,
    diff,
    added,
    removed,
  }
}

async function deletePath(root, requested) {
  const target = await confinedPath(root, requested)
  if (target === root) throw new Error('حذف ریشه‌ی Workspace مجاز نیست.')
  const info = await stat(target)
  await rm(target, { recursive: info.isDirectory(), force: false })
  return { path: toRel(root, target), type: info.isDirectory() ? 'directory' : 'file' }
}

async function renamePath(root, from, to) {
  const source = await confinedPath(root, from)
  if (source === root) throw new Error('تغییر نام ریشه‌ی Workspace مجاز نیست.')
  const destination = await confinedPath(root, to, { create: true })
  if (await stat(destination).catch(() => null)) throw new Error('مقصد از قبل وجود دارد.')
  await mkdir(dirname(destination), { recursive: true })
  await rename(source, destination)
  return { from: toRel(root, source), to: toRel(root, destination) }
}

/* -------------------------------------------------------------------------- */
/*                                     git                                     */
/* -------------------------------------------------------------------------- */

const GIT_STATE = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed',
  C: 'copied', U: 'conflicted', '?': 'untracked', '!': 'ignored',
}

/** Parses `git status --porcelain=v1 -b` into rows the UI can render directly. */
async function gitStatus(root) {
  const result = await runFile('git', ['status', '--porcelain=v1', '-b', '--untracked-files=all'], root)
  if (!result.ok) throw new Error(result.stderr.trim() || 'اجرای git ناموفق بود.')

  const lines = result.stdout.split('\n').filter(Boolean)
  const hasHead = lines[0]?.startsWith('##')
  const head = hasHead ? lines[0].slice(3) : ''
  const branch = head.split('...')[0].trim() || 'HEAD'

  const files = []
  for (const line of lines.slice(hasHead ? 1 : 0)) {
    const index = line[0]
    const worktree = line[1]
    let path = line.slice(3).trim()
    let from
    if (path.includes(' -> ')) [from, path] = path.split(' -> ').map((part) => part.trim())
    files.push({
      path: path.replace(/^"|"$/g, ''),
      ...(from ? { from: from.replace(/^"|"$/g, '') } : {}),
      staged: index !== ' ' && index !== '?',
      index: GIT_STATE[index] ?? null,
      worktree: GIT_STATE[worktree] ?? null,
      untracked: index === '?',
    })
  }

  return {
    branch,
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(head)?.[1] ?? 0),
    files,
    clean: files.length === 0,
  }
}

async function gitLog(root, limit) {
  const count = Math.max(1, Math.min(Number(limit) || 15, 100))
  const unit = '\u001f'
  const result = await runFile(
    'git',
    ['log', `-${count}`, `--pretty=format:%H${unit}%h${unit}%an${unit}%ar${unit}%s${unit}%d`],
    root,
  )
  if (!result.ok) throw new Error(result.stderr.trim() || 'خواندن تاریخچه‌ی Git ناموفق بود.')
  const commits = result.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, short, author, when, subject, refs] = line.split(unit)
    return { hash, short, author, when, subject, refs: (refs || '').trim() }
  })
  return { commits }
}

async function gitBranches(root) {
  const result = await runFile('git', ['branch', '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)'], root)
  if (!result.ok) throw new Error(result.stderr.trim() || 'خواندن شاخه‌ها ناموفق بود.')
  const branches = result.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, head, upstream] = line.split('\t')
    return { name, current: head === '*', ...(upstream ? { upstream } : {}) }
  })
  return { branches }
}

async function gitHandler(method, params, root, options) {
  switch (method) {
    case 'git.status':
      return gitStatus(root)

    case 'git.diff': {
      const args = ['diff', '--no-ext-diff', '--unified=3']
      if (params.staged === true) args.push('--cached')
      if (typeof params.path === 'string' && params.path.trim()) {
        const safe = safeRelativePath(params.path)
        await confinedPath(root, safe)
        args.push('--', safe)
      }
      return runFile('git', args, root)
    }

    case 'git.log':
      return gitLog(root, params.limit)
    case 'git.branches':
      return gitBranches(root)
    case 'git.show':
      return runFile('git', ['show', '--stat', '--patch', String(params.ref ?? 'HEAD').slice(0, 120)], root)

    case 'git.add': {
      assertWritable(options)
      const requested = Array.isArray(params.paths) ? params.paths : [params.path]
      const safe = []
      for (const item of requested.filter(Boolean)) {
        const rel = safeRelativePath(String(item))
        await confinedPath(root, rel)
        safe.push(rel)
      }
      if (!safe.length) throw new Error('هیچ مسیری برای stage داده نشد.')
      return runFile('git', ['add', '--', ...safe], root)
    }

    case 'git.unstage': {
      assertWritable(options)
      const rel = params.path ? safeRelativePath(String(params.path)) : null
      return runFile('git', rel ? ['restore', '--staged', '--', rel] : ['reset'], root)
    }

    case 'git.commit': {
      assertWritable(options)
      const message = String(params.message ?? '').trim()
      if (message.length < 3) throw new Error('پیام commit خیلی کوتاه است.')
      if (message.length > 2000) throw new Error('پیام commit بیش از حد بلند است.')
      const args = params.all === true ? ['commit', '--all', '-m', message] : ['commit', '-m', message]
      return runFile('git', args, root)
    }

    case 'git.branch': {
      assertWritable(options)
      const name = String(params.name ?? '').trim()
      if (!/^[\w./-]{1,120}$/.test(name)) throw new Error('نام شاخه معتبر نیست.')
      return runFile('git', params.create === false ? ['checkout', name] : ['checkout', '-b', name], root)
    }

    case 'git.stash':
      assertWritable(options)
      return runFile('git', params.pop === true ? ['stash', 'pop'] : ['stash', 'push', '-u'], root)

    default:
      throw new Error(`متد Git ناشناخته است: ${method}`)
  }
}

/* -------------------------------------------------------------------------- */
/*                             background terminal                             */
/* -------------------------------------------------------------------------- */

const jobs = new Map()

function jobSummary(job) {
  return {
    id: job.id,
    workspace: job.workspace,
    command: job.command,
    cwd: job.cwd,
    running: job.running,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    bytes: job.output.length,
  }
}

function startJob(workspace, command, cwd, emit) {
  const [file, args] = shellArgs(command)
  const id = randomUUID()
  const child = spawn(file, args, { cwd, windowsHide: true })
  const job = {
    id, workspace: workspace.id, command, cwd: toRel(workspace.root, cwd), child, output: '',
    running: true, exitCode: null, startedAt: Date.now(), endedAt: null,
  }
  jobs.set(id, job)

  const append = (chunk) => {
    const text = chunk.toString('utf8')
    job.output = (job.output + text).slice(-MAX_JOB_BUFFER)
    emit('job.output', { workspace: job.workspace, id, chunk: text.slice(0, 8_000) })
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.on('error', (error) => append(`\n${error.message}\n`))
  child.on('close', (code) => {
    job.running = false
    job.exitCode = code ?? 0
    job.endedAt = Date.now()
    job.child = null
    emit('job.end', jobSummary(job))
  })

  // Finished jobs are dropped so a long session cannot grow without bound.
  if (jobs.size > 20) {
    for (const [key, value] of jobs) {
      if (!value.running && jobs.size > 20) jobs.delete(key)
    }
  }
  return jobSummary(job)
}

function readJob(id, offset = 0) {
  const job = jobs.get(String(id))
  if (!job) throw new Error('این اجرا پیدا نشد یا منقضی شده است.')
  const from = Math.max(0, Math.min(Number(offset) || 0, job.output.length))
  return { ...jobSummary(job), offset: from, output: job.output.slice(from) }
}

function killJob(id) {
  const job = jobs.get(String(id))
  if (!job) throw new Error('این اجرا پیدا نشد.')
  if (job.running && job.child) job.child.kill()
  return jobSummary(job)
}

/* -------------------------------------------------------------------------- */
/*                                   github                                    */
/* -------------------------------------------------------------------------- */

function assertGithubWrite(options) {
  if (!options.allowGithubWrite) throw new Error('تغییر در GitHub فعال نیست. پل را با --allow-github-write اجرا کنید.')
}

function limited(value, fallback = 20, max = 50) {
  return String(Math.max(1, Math.min(Number(value) || fallback, max)))
}

async function githubHandler(method, params, root, options) {
  switch (method) {
    case 'github.repo':
      return runJson('gh', ['repo', 'view', '--json', 'nameWithOwner,url,description,defaultBranchRef,isPrivate,stargazerCount'], root)

    case 'github.issues':
      return {
        items: await runJson('gh', [
          'issue', 'list', '--limit', limited(params.limit),
          '--state', params.state === 'closed' ? 'closed' : 'open',
          '--json', 'number,title,state,url,updatedAt,labels,author',
        ], root),
      }

    case 'github.issue':
      return runJson('gh', ['issue', 'view', String(Number(params.number) || 0), '--json', 'number,title,body,state,url,labels,comments,author'], root)

    case 'github.prs':
      return {
        items: await runJson('gh', [
          'pr', 'list', '--limit', limited(params.limit),
          '--json', 'number,title,state,url,isDraft,headRefName,baseRefName,updatedAt,author',
        ], root),
      }

    case 'github.pr':
      return runJson('gh', ['pr', 'view', String(Number(params.number) || 0), '--json', 'number,title,body,state,url,headRefName,baseRefName,files'], root)

    case 'github.checks':
      return runFile('gh', ['pr', 'checks', ...(params.number ? [String(Number(params.number))] : [])], root, 40_000)

    case 'github.createIssue': {
      assertGithubWrite(options)
      const title = String(params.title ?? '').trim()
      if (title.length < 3) throw new Error('عنوان Issue خیلی کوتاه است.')
      return runFile('gh', ['issue', 'create', '--title', title, '--body', String(params.body ?? '')], root, 30_000)
    }

    case 'github.comment': {
      assertGithubWrite(options)
      const body = String(params.body ?? '').trim()
      if (!body) throw new Error('متن نظر خالی است.')
      const target = params.kind === 'pr' ? 'pr' : 'issue'
      return runFile('gh', [target, 'comment', String(Number(params.number) || 0), '--body', body], root, 30_000)
    }

    case 'github.createPr': {
      assertGithubWrite(options)
      const title = String(params.title ?? '').trim()
      if (title.length < 3) throw new Error('عنوان Pull Request خیلی کوتاه است.')
      const args = ['pr', 'create', '--title', title, '--body', String(params.body ?? '')]
      if (params.draft === true) args.push('--draft')
      if (typeof params.base === 'string' && params.base.trim()) args.push('--base', params.base.trim())
      return runFile('gh', args, root, 60_000)
    }

    default:
      throw new Error(`متد GitHub ناشناخته است: ${method}`)
  }
}

/* -------------------------------------------------------------------------- */
/*                                  dispatch                                   */
/* -------------------------------------------------------------------------- */

async function handleRpc(method, params, ctx) {
  const { workspaces, options, emit } = ctx
  const workspace = resolveWorkspace(workspaces, params.workspace)
  const root = workspace.root

  if (method.startsWith('git.')) return gitHandler(method, params, root, options)
  if (method.startsWith('github.') && method !== 'github.status') return githubHandler(method, params, root, options)

  switch (method) {
    case 'system.health':
    case 'github.status':
      return healthStatus(workspaces, workspace, options)

    case 'workspace.children':
      return listChildren(root, params.path ?? '.')
    case 'workspace.list':
      return listTree(root, params.path ?? '.', params.depth)
    case 'workspace.read':
      return readTextFile(root, params.path, { offset: params.offset, limit: params.limit })
    case 'workspace.search':
      return searchWorkspace(root, params)
    case 'workspace.glob':
      return globWorkspace(root, params.pattern, params.path ?? '.')
    case 'workspace.stat': {
      const target = await confinedPath(root, params.path)
      const info = await stat(target)
      return {
        path: toRel(root, target),
        type: info.isDirectory() ? 'directory' : 'file',
        size: info.size,
        modifiedAt: Math.round(info.mtimeMs),
      }
    }

    case 'workspace.create':
      assertWritable(options)
      return writeFileAt(root, params.path, String(params.content ?? ''), { overwrite: false })
    case 'workspace.write':
      assertWritable(options)
      return writeFileAt(root, params.path, String(params.content ?? ''), { overwrite: true })
    case 'workspace.edit':
      assertWritable(options)
      return editFileAt(root, params)
    case 'workspace.preview':
      return editFileAt(root, params, { dryRun: true })
    case 'workspace.mkdir': {
      assertWritable(options)
      const target = await confinedPath(root, params.path, { create: true })
      await mkdir(target, { recursive: true })
      return { path: toRel(root, target) }
    }
    case 'workspace.delete':
      assertWritable(options)
      return deletePath(root, params.path)
    case 'workspace.rename':
      assertWritable(options)
      return renamePath(root, params.from, params.to)

    case 'editor.open': {
      const editors = await detectEditors(root)
      const requested = typeof params.editor === 'string' ? params.editor : null
      const editor = (requested && editors.find((item) => item.id === requested && item.cliAvailable))
        || editors.find((item) => item.workspaceMarker && item.cliAvailable)
        || editors.find((item) => item.cliAvailable)
      if (!editor) {
        throw new Error('CLI هیچ ادیتوری پیدا نشد. در VS Code دستور «Install code command in PATH» را اجرا کنید.')
      }
      const target = await confinedPath(root, params.path)
      const line = Number(params.line) || 0
      const args = line > 0 ? ['--reuse-window', '-g', `${target}:${line}`] : ['--reuse-window', target]
      const result = await runFile(editor.cli, args, root, 12_000)
      if (!result.ok) throw new Error(result.stderr.trim() || 'باز کردن فایل در ادیتور ناموفق بود.')
      return { opened: toRel(root, target), editor: editor.name, ...(line ? { line } : {}) }
    }

    case 'shell.run': {
      if (!options.allowShell) throw new Error('اجرای ترمینال فعال نیست. پل را با --allow-shell اجرا کنید.')
      const command = String(params.command ?? '').trim()
      if (!command || command.length > 4000) throw new Error('دستور ترمینال معتبر نیست.')
      const cwd = await confinedPath(root, params.cwd ?? '.')
      if (!(await stat(cwd)).isDirectory()) throw new Error('cwd باید یک پوشه باشد.')
      const timeout = Math.max(1_000, Math.min(Number(params.timeoutMs) || 60_000, 180_000))
      const [file, args] = shellArgs(command)
      return runFile(file, args, cwd, timeout)
    }

    case 'shell.start': {
      if (!options.allowShell) throw new Error('اجرای ترمینال فعال نیست. پل را با --allow-shell اجرا کنید.')
      const command = String(params.command ?? '').trim()
      if (!command || command.length > 4000) throw new Error('دستور ترمینال معتبر نیست.')
      const cwd = await confinedPath(root, params.cwd ?? '.')
      if (!(await stat(cwd)).isDirectory()) throw new Error('cwd باید یک پوشه باشد.')
      return startJob(workspace, command, cwd, emit)
    }

    case 'shell.poll':
      return readJob(params.id, params.offset)
    case 'shell.kill':
      return killJob(params.id)
    case 'shell.jobs':
      return {
        jobs: [...jobs.values()]
          .filter((job) => params.workspace === undefined || job.workspace === workspace.id)
          .map(jobSummary)
          .sort((a, b) => b.startedAt - a.startedAt),
      }

    default:
      throw new Error(`متد ناشناخته است: ${method}`)
  }
}

/* -------------------------------------------------------------------------- */
/*                                   server                                    */
/* -------------------------------------------------------------------------- */

const clients = new Set()
/** Ids of the roots with a live recursive watcher. */
const watchers = new Set()

function emit(type, payload) {
  if (clients.size === 0) return
  const frame = `data: ${JSON.stringify({ type, payload, at: Date.now() })}\n\n`
  for (const client of clients) client.write(frame)
}

function startWatcher(workspace) {
  try {
    const pending = new Map()
    const watcher = watch(workspace.root, { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) return
      const rel = String(filename).replaceAll('\\', '/')
      if (rel.split('/').some((part) => IGNORED.has(part))) return
      clearTimeout(pending.get(rel))
      pending.set(rel, setTimeout(() => {
        pending.delete(rel)
        // Fresh status next probe: a change may well be a branch switch.
        statusCache.delete(workspace.root)
        emit('fs.change', { workspace: workspace.id, path: rel })
      }, 220))
    })
    watcher.on('error', () => { watchers.delete(workspace.id) })
    watchers.add(workspace.id)
  } catch {
    watchers.delete(workspace.id)
  }
}

function cors(req, res) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
}

function json(req, res, status, body) {
  cors(req, res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('بدنه‌ی درخواست بیش از حد بزرگ است.')
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new Error('بدنه‌ی JSON معتبر نیست.')
  }
}

/* -------------------------------------------------------------------------- */
/*                                  self-test                                  */
/* -------------------------------------------------------------------------- */

async function selfTest() {
  const folder = await mkdtemp(join(tmpdir(), 'chat-bridge-'))
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  try {
    const root = await realpath(folder)
    await writeFile(join(root, 'ok.txt'), 'one\ntwo\nthree', 'utf8')

    check(inside(root, resolve(root, 'ok.txt')), 'inside() rejected a valid file')
    check(!inside(root, resolve(root, '..', 'escape.txt')), 'inside() accepted traversal')
    check((await readTextFile(root, 'ok.txt')).content === 'one\ntwo\nthree', 'read mismatch')

    let rejected = false
    try { await confinedPath(root, '../escape.txt') } catch { rejected = true }
    check(rejected, 'traversal was not rejected')

    const preview = await editFileAt(root, { path: 'ok.txt', oldText: 'two', newText: 'TWO' }, { dryRun: true })
    check(preview.diff.includes('-two') && preview.diff.includes('+TWO'), 'diff preview is wrong')
    check(preview.added === 1 && preview.removed === 1, 'diff counters are wrong')
    check((await readTextFile(root, 'ok.txt')).content.includes('two'), 'dry run mutated the file')

    await editFileAt(root, { path: 'ok.txt', oldText: 'two', newText: 'TWO' })
    check((await readTextFile(root, 'ok.txt')).content.includes('TWO'), 'edit was not applied')

    check(globToRegExp('**/*.ts').test('src/lib/api.ts'), 'glob failed on a nested match')
    check(!globToRegExp('src/*.ts').test('src/lib/api.ts'), 'glob matched across a separator')

    const { matches } = await searchWorkspace(root, { query: 'three' })
    check(matches.length === 1 && matches[0].line === 3, 'search returned the wrong line')

    await writeFileAt(root, 'nested/new.txt', 'hello', { overwrite: false })
    check((await readTextFile(root, 'nested/new.txt')).content === 'hello', 'create failed')
    await renamePath(root, 'nested/new.txt', 'nested/moved.txt')
    await deletePath(root, 'nested')
    check(!(await stat(join(root, 'nested')).catch(() => null)), 'delete failed')

    // --- multi-root routing ---------------------------------------------- //
    await mkdir(join(root, 'alpha'), { recursive: true })
    await mkdir(join(root, 'beta'), { recursive: true })
    await writeFile(join(root, 'alpha', 'who.txt'), 'alpha', 'utf8')
    await writeFile(join(root, 'beta', 'who.txt'), 'beta', 'utf8')

    const roots = await buildWorkspaces([join(root, 'alpha'), join(root, 'beta')])
    check(roots.length === 2, 'buildWorkspaces dropped a root')
    check(roots[0].id === 'alpha' && roots[1].id === 'beta', 'workspace ids are wrong')
    check((await buildWorkspaces([join(root, 'alpha'), join(root, 'alpha')])).length === 1, 'duplicate root was kept')

    check(resolveWorkspace(roots, undefined).id === 'alpha', 'missing workspace did not fall back to the first')
    check(resolveWorkspace(roots, 'beta').id === 'beta', 'resolve by id failed')
    check(resolveWorkspace(roots, roots[1].root).id === 'beta', 'resolve by path failed')

    let unknownRejected = false
    try { resolveWorkspace(roots, 'gamma') } catch { unknownRejected = true }
    check(unknownRejected, 'an unknown workspace was accepted')

    check((await readTextFile(roots[0].root, 'who.txt')).content === 'alpha', 'root A read the wrong file')
    check((await readTextFile(roots[1].root, 'who.txt')).content === 'beta', 'root B read the wrong file')

    let crossRejected = false
    try { await confinedPath(roots[0].root, '../beta/who.txt') } catch { crossRejected = true }
    check(crossRejected, 'traversal from one root into another was not rejected')

    await rm(join(root, 'alpha'), { recursive: true, force: true })
    await rm(join(root, 'beta'), { recursive: true, force: true })

    console.log('Bridge self-test passed: path jail, diffs, glob, search, mutations, and multi-root routing are working.')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/* -------------------------------------------------------------------------- */
/*                                    boot                                     */
/* -------------------------------------------------------------------------- */

const options = parseArgs(process.argv.slice(2))
if (options.selfTest) {
  await selfTest()
  process.exit(0)
}

if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
  throw new Error('Bridge port must be an integer between 1024 and 65535.')
}
const workspaces = await buildWorkspaces(options.workspaces)
for (const workspace of workspaces) startWatcher(workspace)

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    cors(req, res)
    res.writeHead(204)
    return res.end()
  }

  if (req.headers.authorization !== `Bearer ${options.token}`) {
    return json(req, res, 401, { ok: false, error: 'توکن پل محلی نامعتبر است.' })
  }

  try {
    if (req.method === 'GET' && req.url?.startsWith('/health')) {
      const requested = new URL(req.url, 'http://127.0.0.1').searchParams.get('workspace')
      const resolved = resolveWorkspace(workspaces, requested)
      return json(req, res, 200, { ok: true, result: await healthStatus(workspaces, resolved, options) })
    }

    if (req.method === 'GET' && req.url === '/events') {
      cors(req, res)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'ready', payload: { version: VERSION }, at: Date.now() })}\n\n`)
      clients.add(res)
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
      return
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      const request = await readBody(req)
      if (typeof request.method !== 'string') throw new Error('نام متد الزامی است.')
      const params = request.params && typeof request.params === 'object' ? request.params : {}
      const result = await handleRpc(request.method, params, { workspaces, options, emit })
      return json(req, res, 200, { ok: true, result })
    }

    return json(req, res, 404, { ok: false, error: 'مسیر پیدا نشد.' })
  } catch (error) {
    return json(req, res, 400, { ok: false, error: error instanceof Error ? error.message : 'خطای پل محلی' })
  }
})

server.listen(options.port, '127.0.0.1', () => {
  const caps = ['read']
  if (options.allowWrite) caps.push('write')
  if (options.allowShell) caps.push('shell')
  if (options.allowGithubWrite) caps.push('github-write')
  console.log(`Local bridge v${VERSION}: http://127.0.0.1:${options.port}`)
  console.log(`Workspaces:   ${workspaces.length}`)
  for (const workspace of workspaces) {
    console.log(`  ${workspace.id.padEnd(20)} ${workspace.root}${watchers.has(workspace.id) ? '' : '  (no watch)'}`)
  }
  console.log(`Token:        ${options.token}`)
  console.log(`Capabilities: ${caps.join(', ')} — shared by every workspace`)
})
