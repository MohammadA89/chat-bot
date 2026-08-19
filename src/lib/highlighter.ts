/**
 * A highlight.js core instance with only the grammars a chat assistant
 * realistically emits.
 *
 * We highlight inside the code-block component rather than through
 * `rehype-highlight`, because that plugin statically imports lowlight's
 * full `common` language set — roughly 400 kB that no bundler can shake out.
 */
import hljs from 'highlight.js/lib/core'
import { HLJS_LANGUAGES } from './languages'

for (const [name, grammar] of Object.entries(HLJS_LANGUAGES)) {
  hljs.registerLanguage(name, grammar)
}

hljs.configure({ ignoreUnescapedHTML: true })

const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  'c++': 'cpp',
  cs: 'csharp',
  golang: 'go',
  md: 'markdown',
  htm: 'html',
  text: 'plaintext',
  txt: 'plaintext',
}

export function resolveLanguage(raw: string): string {
  const lang = raw.toLowerCase()
  return ALIASES[lang] ?? lang
}

export interface Highlighted {
  html: string
  language: string
}

/**
 * Highlights `code`, falling back to auto-detection for unlabelled blocks and
 * to escaped plain text when nothing matches.
 */
export function highlight(code: string, lang: string): Highlighted {
  const language = resolveLanguage(lang)

  if (language && language !== 'plaintext' && hljs.getLanguage(language)) {
    try {
      const result = hljs.highlight(code, { language, ignoreIllegals: true })
      return { html: result.value, language }
    } catch {
      /* fall through to plain text */
    }
  }

  if (!language || language === 'text' || language === 'plaintext') {
    try {
      const result = hljs.highlightAuto(code)
      if (result.language && (result.relevance ?? 0) > 6) {
        return { html: result.value, language: result.language }
      }
    } catch {
      /* fall through to plain text */
    }
  }

  return { html: escapeHtml(code), language: language || 'text' }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
