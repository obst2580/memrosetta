import type { Lang } from '../i18n'
import { content } from '../i18n'

interface BrainScienceProps {
  readonly lang: Lang
}

export function BrainScience({ lang }: BrainScienceProps) {
  const t = content[lang].brainScience

  return (
    <section
      id="how"
      className="relative px-6 py-24 md:px-8 md:py-32"
      style={{ backgroundColor: 'oklch(0.985 0.005 85)' }}
    >
      <div className="mx-auto max-w-5xl">
        {/* Section heading — editorial */}
        <div className="mb-20 max-w-2xl">
          <div
            className="mb-4 font-mono text-[11px] tracking-[0.2em] uppercase"
            style={{ color: 'oklch(0.55 0.08 65)' }}
          >
            How it remembers
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

        {/* Three pillars — vertical stack with big numbers */}
        <div className="space-y-20">
          {t.pillars.map((pillar, i) => (
            <Pillar
              key={i}
              number={String(i + 1).padStart(2, '0')}
              label={pillar.label}
              title={pillar.title}
              body={pillar.body}
              citations={pillar.citations}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

interface PillarProps {
  readonly number: string
  readonly label: string
  readonly title: string
  readonly body: string
  readonly citations: string
}

function Pillar({ number, label, title, body, citations }: PillarProps) {
  return (
    <article className="grid gap-6 md:grid-cols-[120px_1fr] md:gap-12">
      {/* Left — number + label, aligned top */}
      <div className="flex flex-col items-start">
        <div
          className="font-[Bricolage_Grotesque] font-extrabold tabular-nums"
          style={{
            fontSize: 'clamp(2.25rem, 4vw, 3rem)',
            lineHeight: 1,
            color: 'oklch(0.75 0.12 70)',
          }}
        >
          {number}
        </div>
        <div
          className="mt-2 font-mono text-[10px] tracking-[0.2em] uppercase"
          style={{ color: 'oklch(0.55 0.01 85)' }}
        >
          {label}
        </div>
      </div>

      {/* Right — title + body + citations */}
      <div className="max-w-2xl">
        <h3
          className="mb-4 font-[Bricolage_Grotesque] font-bold tracking-tight"
          style={{
            fontSize: 'clamp(1.35rem, 2vw, 1.75rem)',
            lineHeight: 1.2,
            color: 'oklch(0.20 0.01 85)',
          }}
        >
          {title}
        </h3>
        <p
          className="mb-4 font-[Source_Serif_4] leading-relaxed"
          style={{
            fontSize: 'clamp(1rem, 1.2vw, 1.1rem)',
            color: 'oklch(0.35 0.01 85)',
          }}
        >
          {body}
        </p>
        <div
          className="font-mono text-xs italic"
          style={{ color: 'oklch(0.58 0.05 65)' }}
        >
          {citations}
        </div>
      </div>
    </article>
  )
}
