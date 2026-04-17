import type { Lang } from '../i18n'
import { content } from '../i18n'

const LOGIN_URL =
  'https://login.liliplanet.net?redirect=https://memrosetta.liliplanet.net/auth/callback'
const GITHUB_URL = 'https://github.com/obst2580/memrosetta'
const SELF_HOST_DOCS = `${GITHUB_URL}#multi-device-sync-optional`

interface ThreePathsProps {
  readonly lang: Lang
}

export function ThreePaths({ lang }: ThreePathsProps) {
  const t = content[lang].threePaths

  const ctaHrefs = [
    GITHUB_URL, // Local only → GitHub readme
    SELF_HOST_DOCS, // Self-host → self-host section
    LOGIN_URL, // Hosted Cloud → login
  ]

  return (
    <section
      id="paths"
      className="relative px-6 py-24 md:px-8 md:py-32"
      style={{ backgroundColor: 'oklch(0.98 0.01 85)' }}
    >
      <div className="mx-auto max-w-6xl">
        {/* Heading */}
        <div className="mb-16 max-w-2xl">
          <div
            className="mb-4 font-mono text-[11px] tracking-[0.2em] uppercase"
            style={{ color: 'oklch(0.55 0.08 65)' }}
          >
            Three paths
          </div>
          <h2
            className="mb-6 font-[Bricolage_Grotesque] font-bold tracking-tight"
            style={{
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              lineHeight: 1.05,
              color: 'oklch(0.20 0.01 85)',
            }}
          >
            {t.title}
          </h2>
          <p
            className="font-[Source_Serif_4] leading-relaxed"
            style={{
              fontSize: 'clamp(1.05rem, 1.3vw, 1.15rem)',
              color: 'oklch(0.42 0.01 85)',
            }}
          >
            {t.subtitle}
          </p>
        </div>

        {/* Three columns */}
        <div className="grid gap-6 md:grid-cols-3">
          {t.paths.map((path, i) => (
            <PathCard
              key={i}
              name={path.name}
              subtitle={path.subtitle}
              body={path.body}
              auth={path.auth}
              cta={path.cta}
              href={ctaHrefs[i]}
              primary={path.primary}
            />
          ))}
        </div>

        {/* Footer note */}
        <p
          className="mt-10 max-w-3xl font-[Source_Serif_4] italic"
          style={{
            fontSize: '0.95rem',
            color: 'oklch(0.48 0.01 85)',
          }}
        >
          {t.note}
        </p>
      </div>
    </section>
  )
}

interface PathCardProps {
  readonly name: string
  readonly subtitle: string
  readonly body: string
  readonly auth: string
  readonly cta: string
  readonly href: string
  readonly primary: boolean
}

function PathCard({
  name,
  subtitle,
  body,
  auth,
  cta,
  href,
  primary,
}: PathCardProps) {
  const borderColor = primary ? 'oklch(0.75 0.12 70)' : 'oklch(0.88 0.01 85)'
  const bgColor = primary ? 'oklch(0.98 0.03 75)' : 'white'

  return (
    <article
      className="flex flex-col gap-6 rounded-lg border p-7 transition-all hover:shadow-sm"
      style={{
        borderColor,
        borderWidth: primary ? 2 : 1,
        backgroundColor: bgColor,
      }}
    >
      {/* Name + subtitle */}
      <header>
        <h3
          className="mb-1 font-[Bricolage_Grotesque] text-xl font-bold tracking-tight"
          style={{ color: 'oklch(0.20 0.01 85)' }}
        >
          {name}
        </h3>
        <p
          className="font-mono text-xs tracking-wide"
          style={{ color: 'oklch(0.50 0.05 65)' }}
        >
          {subtitle}
        </p>
      </header>

      {/* Body */}
      <p
        className="flex-1 font-[Source_Serif_4] leading-relaxed"
        style={{
          fontSize: '0.95rem',
          color: 'oklch(0.35 0.01 85)',
        }}
      >
        {body}
      </p>

      {/* Auth row — distinctive */}
      <div
        className="border-t pt-4"
        style={{ borderColor: 'oklch(0.92 0.01 85)' }}
      >
        <div
          className="mb-1 font-mono text-[10px] tracking-[0.15em] uppercase"
          style={{ color: 'oklch(0.55 0.01 85)' }}
        >
          Auth
        </div>
        <div
          className="font-[Source_Serif_4]"
          style={{
            fontSize: '0.9rem',
            color: 'oklch(0.28 0.01 85)',
          }}
        >
          {auth}
        </div>
      </div>

      {/* CTA */}
      <a
        href={href}
        target={href.startsWith('http') && !href.includes('login.liliplanet') ? '_blank' : undefined}
        rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
        className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-all ${
          primary ? 'text-white hover:opacity-90' : 'border hover:shadow-sm'
        }`}
        style={{
          backgroundColor: primary ? 'oklch(0.45 0.14 65)' : 'white',
          borderColor: primary ? 'transparent' : 'oklch(0.80 0.01 85)',
          color: primary ? 'white' : 'oklch(0.28 0.01 85)',
        }}
      >
        {cta}
        <span aria-hidden="true">→</span>
      </a>
    </article>
  )
}
