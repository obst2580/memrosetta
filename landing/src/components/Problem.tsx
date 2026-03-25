import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

interface ProblemProps {
  readonly lang: Lang
}

export function Problem({ lang }: ProblemProps) {
  const t = content[lang].problem

  return (
    <Section id="problem" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      <div className="grid gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 md:grid-cols-2">
        {/* Session 1 -- acquired */}
        <div className="bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs font-medium text-zinc-600">
              {t.scenarios[0].session}
            </span>
            <span className="text-xs text-zinc-400">
              {t.scenarios[0].label}
            </span>
          </div>
          <div className="space-y-3">
            {t.scenarios[0].items.map((item, i) => (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-zinc-300">
                  {'>'}
                </span>
                <p className="text-sm leading-relaxed text-zinc-600">
                  {item}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Session 2 -- forgotten */}
        <div className="bg-zinc-50 p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded bg-red-50 px-2 py-0.5 font-mono text-xs font-medium text-red-500">
              {t.scenarios[1].session}
            </span>
            <span className="text-xs text-zinc-400">
              {t.scenarios[1].label}
            </span>
          </div>
          <div className="space-y-3">
            {t.scenarios[1].items.map((item, i) => (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-red-300">
                  {'?'}
                </span>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {item}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-400">
        {t.resolution}
      </p>
    </Section>
  )
}
