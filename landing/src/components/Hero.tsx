import type { Lang } from '../i18n'
import { content } from '../i18n'
import { InlineCode } from './CodeBlock'

const GITHUB_URL = 'https://github.com/obst2580/memrosetta'
const LOGIN_URL =
  'https://login.liliplanet.net?redirect=https://memrosetta.liliplanet.net/auth/callback'

interface HeroProps {
  readonly lang: Lang
}

export function Hero({ lang }: HeroProps) {
  const t = content[lang].hero
  const isLoggedIn =
    typeof window !== 'undefined' &&
    Boolean(localStorage.getItem('memrosetta_token'))

  return (
    <section className="relative overflow-hidden px-6 pt-32 pb-24 md:px-8 md:pt-48 md:pb-40">
      {/* Background — neurons, very subtle */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25"
        style={{ backgroundImage: 'url(/hero-bg.png)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/85 to-white" />

      <div className="relative mx-auto max-w-4xl">
        {/* Meta line — badge above everything */}
        <div
          className="mb-10 font-mono text-[11px] tracking-[0.2em] uppercase"
          style={{ color: 'oklch(0.55 0.08 65)' }}
        >
          {t.badge}
        </div>

        {/* Title — oversized, editorial weight */}
        <h1
          className="mb-6 font-[Bricolage_Grotesque] font-extrabold tracking-tight"
          style={{
            fontSize: 'clamp(3.5rem, 9vw, 7rem)',
            lineHeight: 0.95,
            color: 'oklch(0.20 0.01 85)',
          }}
        >
          Mem<span style={{ color: 'oklch(0.52 0.14 65)' }}>Rosetta</span>
        </h1>

        {/* Tagline — serif, italic for editorial feel */}
        <p
          className="mb-10 max-w-3xl font-[Source_Serif_4] italic"
          style={{
            fontSize: 'clamp(1.5rem, 3vw, 2.25rem)',
            lineHeight: 1.3,
            color: 'oklch(0.32 0.02 65)',
          }}
        >
          {t.tagline}
        </p>

        {/* Subtitle — body prose */}
        <p
          className="mb-12 max-w-2xl font-[Source_Serif_4] leading-relaxed"
          style={{
            fontSize: 'clamp(1rem, 1.4vw, 1.2rem)',
            color: 'oklch(0.42 0.01 85)',
          }}
        >
          {t.subtitle}
        </p>

        {/* Install command */}
        <div className="mb-4">
          <InlineCode copyable>{t.install}</InlineCode>
        </div>

        {/* Byline under install */}
        <p
          className="mb-10 font-[Source_Serif_4] text-sm"
          style={{ color: 'oklch(0.55 0.01 85)' }}
        >
          {t.byline}
        </p>

        {/* Actions — minimal, horizontal */}
        <div className="flex flex-wrap items-center gap-3">
          {!isLoggedIn && (
            <a
              href={LOGIN_URL}
              className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: 'oklch(0.45 0.14 65)' }}
            >
              Get started
              <span aria-hidden="true">→</span>
            </a>
          )}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition-all hover:border-zinc-400 hover:shadow-sm"
          >
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <a
            href="#how"
            className="inline-flex items-center gap-2 px-2 py-2.5 text-sm font-medium transition-all hover:underline"
            style={{ color: 'oklch(0.42 0.05 65)' }}
          >
            How it remembers →
          </a>
        </div>
      </div>
    </section>
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
