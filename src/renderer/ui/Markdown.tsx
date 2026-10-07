import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useDeferredValue, useMemo } from 'react'

/** Structural tags only: no images (remote fetches), forms, styles or custom elements. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

// No `class` or `style`: model text must not be able to wear the app's own components.
const ALLOWED_ATTR = ['href', 'title', 'start', 'colspan', 'rowspan']

type Purifier = ReturnType<typeof DOMPurify>
let purifier: Purifier | null | undefined

/** One private instance, so the link hook below cannot leak into anything else. Null where there is no DOM. */
function getPurifier(): Purifier | null {
  if (purifier !== undefined) return purifier
  purifier = typeof window === 'undefined' ? null : DOMPurify(window)
  if (!purifier?.isSupported) return (purifier = null)
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  return purifier
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Markdown to safe HTML. Only http, https and mailto links survive; scripts and handlers never do. */
export function renderMarkdown(text: string): string {
  const purify = getPurifier()
  if (!purify) return `<pre>${escapeHtml(text)}</pre>`
  const raw = marked.parse(text, { async: false, gfm: true, breaks: false })
  return purify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
}

const CACHE_LIMIT = 64
const cache = new Map<string, string>()

function parsed(text: string): string {
  const hit = cache.get(text)
  if (hit !== undefined) {
    cache.delete(text)
    cache.set(text, hit)
    return hit
  }
  const html = renderMarkdown(text)
  cache.set(text, html)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return html
}

const CARET = '<span class="caret" aria-hidden="true"></span>'
const LAST_CLOSE = /<\/(?:p|li|h[1-6]|td|th)>\s*(?:<\/(?:ul|ol|tr|tbody|thead|table|blockquote)>\s*)*$/

/** Put the streaming caret at the end of the last line of text instead of under the block. */
function withCaret(html: string): string {
  const m = LAST_CLOSE.exec(html)
  return m ? html.slice(0, m.index) + CARET + html.slice(m.index) : html + CARET
}

export function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  // While text streams in, React may skip intermediate states instead of parsing every delta.
  const deferred = useDeferredValue(text)
  const html = useMemo(() => {
    const out = parsed(deferred)
    return caret ? withCaret(out) : out
  }, [deferred, caret])
  // Safe: `html` is the DOMPurify output above (or escaped text), never the raw model text.
  return <div className="md selectable" dangerouslySetInnerHTML={{ __html: html }} />
}
