/** Parsing for the unified diffs the bridge and `git diff` return. */

export interface DiffRow {
  type: 'add' | 'del' | 'context' | 'hunk' | 'meta'
  text: string
  /** Line number in the original file, when the row exists there. */
  oldLine?: number
  /** Line number in the new file, when the row exists there. */
  newLine?: number
}

export interface DiffFile {
  path: string
  rows: DiffRow[]
  added: number
  removed: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Splits a unified diff into per-file row lists with both line numbers
 * resolved, which is all the renderer needs.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let oldLine = 0
  let newLine = 0

  const start = (path: string): DiffFile => {
    const file: DiffFile = { path, rows: [], added: 0, removed: 0 }
    files.push(file)
    current = file
    return file
  }
  const ensure = (): DiffFile => current ?? start('file')

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      start(line.split(' b/').pop()?.trim() || 'file')
      continue
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/^b\//, '').trim()
      const file = ensure()
      if (file.path === 'file' || file.path.startsWith('a/')) file.path = path
      continue
    }
    if (line.startsWith('--- ')) {
      if (!current) start(line.slice(4).replace(/^a\//, '').trim())
      continue
    }

    const file = ensure()
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      file.rows.push({ type: 'hunk', text: line })
      continue
    }

    if (line.startsWith('+')) {
      file.rows.push({ type: 'add', text: line.slice(1), newLine })
      file.added += 1
      newLine += 1
    } else if (line.startsWith('-')) {
      file.rows.push({ type: 'del', text: line.slice(1), oldLine })
      file.removed += 1
      oldLine += 1
    } else if (line.startsWith(' ')) {
      file.rows.push({ type: 'context', text: line.slice(1), oldLine, newLine })
      oldLine += 1
      newLine += 1
    } else if (line.trim()) {
      file.rows.push({ type: 'meta', text: line })
    }
  }

  return files.filter((file) => file.rows.length > 0)
}

/** `+12 −3`-style summary used in tool cards and the changes list. */
export function diffStat(files: DiffFile[]): { added: number; removed: number } {
  return files.reduce(
    (total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }),
    { added: 0, removed: 0 },
  )
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  cjs: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'xml', xml: 'xml',
  md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash',
  ps1: 'powershell', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
}

/** Best-effort grammar name for a workspace path, for the file viewer. */
export function languageForPath(path: string): string {
  const name = path.split('/').pop() ?? ''
  if (name.startsWith('.env')) return 'bash'
  if (name === 'Dockerfile') return 'dockerfile'
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext'
}

/** Human-readable byte size, e.g. «۱٫۲ کیلوبایت» handled by the caller's digits. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
