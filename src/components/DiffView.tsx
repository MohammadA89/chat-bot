import { useMemo } from 'react'
import { parseUnifiedDiff } from '../lib/diff'
import { highlight } from '../lib/highlighter'
import { toFa } from '../lib/utils'

interface DiffViewProps {
  /** A unified diff, as produced by the bridge or by `git diff`. */
  diff: string
  /** Hides the per-file header when the surrounding UI already names the file. */
  compact?: boolean
}

/** Renders a unified diff as a numbered, colour-coded review view. */
export function DiffView({ diff, compact }: DiffViewProps) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff])

  if (files.length === 0) return <p className="panel-empty">تغییری برای نمایش نیست.</p>

  return (
    <div className="diff-view">
      {files.map((file) => (
        <div className="diff-file" key={file.path}>
          {!compact && (
            <div className="diff-file-head">
              <span className="diff-path">{file.path}</span>
              <span className="diff-stat">
                <b className="add">+{toFa(file.added)}</b>
                <b className="del">−{toFa(file.removed)}</b>
              </span>
            </div>
          )}
          <div className="diff-body" dir="ltr">
            {file.rows.map((row, index) => (
              <div className={`diff-row ${row.type}`} key={index}>
                <span className="diff-gutter">{row.oldLine ?? ''}</span>
                <span className="diff-gutter">{row.newLine ?? ''}</span>
                <span className="diff-sign">
                  {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
                </span>
                <code className="diff-text">{row.text || ' '}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface CodeViewProps {
  content: string
  language: string
  /** Highlights this 1-based line, e.g. a search hit the user clicked. */
  activeLine?: number
}

/** Read-only file viewer with line numbers and syntax highlighting. */
export function CodeView({ content, language, activeLine }: CodeViewProps) {
  // Each line is highlighted on its own so the gutter can sit beside it without
  // spans spilling across rows. Multi-line constructs lose a little colour.
  const lines = useMemo(
    () => content.split('\n').map((line) => highlight(line, language).html || '&nbsp;'),
    [content, language],
  )

  return (
    <div className="code-view" dir="ltr">
      {lines.map((html, index) => (
        <div className={`code-line${activeLine === index + 1 ? ' active' : ''}`} key={index}>
          <span className="code-gutter">{index + 1}</span>
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ))}
    </div>
  )
}
