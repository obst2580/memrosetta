import { InlineCode } from './CodeBlock'

const GITHUB_URL = 'https://github.com/obst2580/memrosetta'

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-24 md:px-12 md:pt-32 lg:px-24">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-1.5 text-sm text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Open source -- MIT License
        </div>

        {/* Title */}
        <h1 className="mb-6 text-5xl font-extrabold tracking-tight text-zinc-100 md:text-7xl">
          Mem
          <span className="text-amber-400">Rosetta</span>
        </h1>

        {/* Tagline */}
        <p className="mb-4 text-xl font-medium text-zinc-300 md:text-2xl">
          Your AI keeps forgetting. MemRosetta fixes that.
        </p>

        {/* Description */}
        <p className="mx-auto mb-10 max-w-2xl text-base text-zinc-500 md:text-lg">
          Persistent, searchable long-term memory for AI tools.
          Local SQLite, no LLM dependency, contradiction detection, cognitive-model forgetting.
        </p>

        {/* CTA */}
        <div className="mb-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <InlineCode copyable>npx @memrosetta/claude-code init</InlineCode>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-800"
          >
            <GitHubIcon />
            GitHub
          </a>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-zinc-500">
          <Stat label="MRR improvement" value="+324%" />
          <Stat label="LLM cost for core" value="$0" />
          <Stat label="Setup commands" value="1" />
        </div>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-lg font-semibold text-amber-400">
        {value}
      </span>
      <span>{label}</span>
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  )
}
