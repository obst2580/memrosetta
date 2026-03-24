import { useCopyToClipboard } from '../hooks/useCopyToClipboard'

interface CodeBlockProps {
  readonly code: string
  readonly language?: string
  readonly showCopy?: boolean
}

export function CodeBlock({
  code,
  language = 'bash',
  showCopy = true,
}: CodeBlockProps) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
      {language && (
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
          <span className="font-mono text-xs text-zinc-400">{language}</span>
          {showCopy && (
            <button
              onClick={() => copy(code)}
              className="rounded px-2 py-1 font-mono text-xs text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-sm leading-relaxed text-zinc-700">
          {code}
        </code>
      </pre>
    </div>
  )
}

interface InlineCodeProps {
  readonly children: string
  readonly copyable?: boolean
}

export function InlineCode({ children, copyable = false }: InlineCodeProps) {
  const { copied, copy } = useCopyToClipboard()

  if (copyable) {
    return (
      <button
        onClick={() => copy(children)}
        className="group inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-2.5 font-mono text-sm text-amber-600 transition-all hover:border-amber-400 hover:bg-amber-50"
      >
        <span className="select-all">{children}</span>
        <span className="text-xs text-zinc-400 transition-colors group-hover:text-zinc-500">
          {copied ? '[copied]' : '[copy]'}
        </span>
      </button>
    )
  }

  return (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm text-amber-600">
      {children}
    </code>
  )
}
