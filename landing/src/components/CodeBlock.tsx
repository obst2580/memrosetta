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
    <div className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          </div>
          <span className="ml-2 font-mono text-xs text-zinc-500">
            {language}
          </span>
        </div>
        {showCopy && (
          <button
            onClick={() => copy(code)}
            className="rounded px-2 py-0.5 font-mono text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        )}
      </div>
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-[13px] leading-relaxed text-zinc-300">
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
        className="group inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-950 px-4 py-2.5 font-mono text-sm text-zinc-300 transition-all hover:border-zinc-600"
      >
        <span className="text-zinc-500">$</span>
        <span className="select-all">{children}</span>
        <span className="text-xs text-zinc-600 transition-colors group-hover:text-zinc-400">
          {copied ? 'copied' : 'copy'}
        </span>
      </button>
    )
  }

  return (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm text-zinc-700">
      {children}
    </code>
  )
}
