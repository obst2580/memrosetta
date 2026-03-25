import type { Lang } from '../i18n'
import { content } from '../i18n'
import { InlineCode } from './CodeBlock'

const GITHUB_URL = 'https://github.com/obst2580/memrosetta'

interface HeroProps {
  readonly lang: Lang
}

export function Hero({ lang }: HeroProps) {
  const t = content[lang].hero

  return (
    <section className="relative overflow-hidden px-6 pt-28 pb-16 md:px-8 md:pt-36 md:pb-24">
      {/* Background illustration */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-50"
        style={{ backgroundImage: 'url(/hero-bg.png)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 via-white/60 to-white" />

      <div className="relative mx-auto max-w-3xl">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {t.badge}
        </div>

        {/* Title */}
        <h1 className="mb-4 text-5xl font-extrabold tracking-tight text-zinc-900 md:text-7xl">
          Mem
          <span className="bg-gradient-to-r from-amber-500 to-amber-700 bg-clip-text text-transparent">Rosetta</span>
        </h1>

        {/* Subtitle */}
        <p className="mb-8 max-w-xl text-lg text-zinc-500 md:text-xl">
          {t.subtitle}
        </p>

        {/* Install command */}
        <div className="mb-8">
          <InlineCode copyable>{t.install}</InlineCode>
        </div>

        {/* GitHub link */}
        <div className="mb-12">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-800"
          >
            <GitHubIcon />
            <span>GitHub</span>
            <span className="text-zinc-300">/</span>
            <span className="font-mono text-xs">obst2580/memrosetta</span>
          </a>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-8 border-t border-zinc-100 pt-8 text-sm">
          <StatItem
            value={t.stats.mrr.value}
            label={t.stats.mrr.label}
          />
          <StatItem
            value={t.stats.cost.value}
            label={t.stats.cost.label}
          />
          <StatItem
            value={t.stats.setup.value}
            label={t.stats.setup.label}
          />
        </div>
      </div>
    </section>
  )
}

function StatItem({
  value,
  label,
}: {
  readonly value: string
  readonly label: string
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-lg font-semibold text-zinc-900">
        {value}
      </span>
      <span className="text-zinc-400">{label}</span>
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
