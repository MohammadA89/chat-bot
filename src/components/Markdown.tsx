import { memo, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { IconCheck, IconCopy } from './Icons'
import { copyText } from '../lib/utils'
import { highlight } from '../lib/highlighter'

/** Pulls the raw text out of a rendered React node tree, for copy + highlight. */
function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (typeof node === 'object' && 'props' in (node as any)) {
    return nodeToText((node as any).props?.children)
  }
  return ''
}

/** Reads the ```lang fence off the inner <code> element. */
function fenceLanguage(node: ReactNode): string {
  const child = Array.isArray(node) ? node[0] : node
  const className: string = (child as any)?.props?.className ?? ''
  const match = /language-([\w+#-]+)/.exec(className)
  return match ? match[1] : ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)

  const code = nodeToText(children)
  const fence = fenceLanguage(children)
  const { html, language } = useMemo(() => highlight(code, fence), [code, fence])

  async function handleCopy() {
    if (await copyText(code)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{language}</span>
        <button className="code-copy" onClick={handleCopy} type="button">
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          <span>{copied ? 'کپی شد' : 'کپی'}</span>
        </button>
      </div>
      <pre>
        {/* highlight.js escapes its own output, and the source is model text, not HTML. */}
        <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

const components = {
  pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }: any) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}

function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Re-renders only when the text changes — streaming updates it many times a second. */
export const Markdown = memo(MarkdownImpl, (a, b) => a.content === b.content)
