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
    <section className="relative overflow-hidden px-6 pt-28 pb-20 md:px-8 md:pt-40 md:pb-32">
      {/* Background illustration */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35"
        style={{ backgroundImage: 'url(/hero-bg.png)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 via-white/80 to-white" />

      <div className="relative mx-auto max-w-5xl">
        <div className="grid gap-12 md:grid-cols-[1fr_auto] md:items-end">
          {/* Left column — asymmetric, left-aligned */}
          <div className="max-w-2xl">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 border-b border-amber-400/40 pb-1 text-xs font-medium tracking-wide text-amber-700 uppercase">
              <span className="h-1 w-4 bg-amber-500" />
              {t.badge}
            </div>

            {/* Title — solid color, no gradient */}
            <h1 className="mb-6 font-[Bricolage_Grotesque] text-5xl font-extrabold tracking-tight md:text-7xl lg:text-8xl" style={{ color: 'oklch(0.22 0.01 85)' }}>
              Mem<span style={{ color: 'oklch(0.52 0.14 65)' }}>Rosetta</span>
            </h1>

            {/* Subtitle — serif body */}
            <p className="mb-10 max-w-lg text-xl leading-relaxed font-medium" style={{ color: 'oklch(0.40 0.01 85)' }}>
              {t.subtitle}
            </p>

            {/* Install command */}
            <div className="mb-5">
              <InlineCode copyable>{t.install}</InlineCode>
            </div>

            {/* Actions row */}
            <div className="flex flex-wrap items-center gap-4">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-all hover:border-zinc-400 hover:shadow-sm"
              >
                <GitHubIcon />
                <span>GitHub</span>
              </a>
              <a
                href="https://login.liliplanet.net?redirect=https://memrosetta.liliplanet.net/auth/callback"
                className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ backgroundColor: 'oklch(0.52 0.14 65)' }}
              >
                Login / Sign Up
              </a>
            </div>
          </div>

          {/* Right column — compact stats, vertical */}
          <div className="hidden md:flex md:flex-col md:gap-6 md:border-l md:border-zinc-200 md:pl-8">
            <StatItem value={t.stats.mrr.value} label={t.stats.mrr.label} />
            <StatItem value={t.stats.cost.value} label={t.stats.cost.label} />
            <StatItem value={t.stats.setup.value} label={t.stats.setup.label} />
          </div>
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
      <span className="font-mono text-lg font-bold text-zinc-900">
        {value}
      </span>
      <span className="text-sm font-medium text-zinc-500">{label}</span>
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg
      className="h-5 w-5"
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
