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
    <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/80">
      {language && (
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <span className="font-mono text-xs text-zinc-500">{language}</span>
          {showCopy && (
            <button
              onClick={() => copy(code)}
              className="rounded px-2 py-1 font-mono text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-sm leading-relaxed text-zinc-300">
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
        className="group inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2.5 font-mono text-sm text-amber-400 transition-all hover:border-amber-500/50 hover:bg-zinc-800"
      >
        <span className="select-all">{children}</span>
        <span className="text-xs text-zinc-500 transition-colors group-hover:text-zinc-400">
          {copied ? '[copied]' : '[copy]'}
        </span>
      </button>
    )
  }

  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-sm text-amber-400">
      {children}
    </code>
  )
}
