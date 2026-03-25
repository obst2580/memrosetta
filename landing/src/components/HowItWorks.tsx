import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

interface HowItWorksProps {
  readonly lang: Lang
}

export function HowItWorks({ lang }: HowItWorksProps) {
  const t = content[lang].howItWorks

  return (
    <Section id="how-it-works" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      {/* Layers */}
      <div className="space-y-3">
        {t.layers.map((layer, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300"
          >
            <div className="flex gap-4">
              {/* Number */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-mono text-sm font-medium text-zinc-500">
                {layer.number}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <h3 className="mb-1 text-sm font-semibold text-zinc-800">
                  {layer.title}
                </h3>
                <p className="mb-3 text-sm leading-relaxed text-zinc-500">
                  {layer.description}
                </p>
                <div className="flex gap-4 font-mono text-xs text-zinc-400">
                  <span>
                    quality:{' '}
                    <span className={
                      i === 0
                        ? 'text-emerald-600'
                        : i === 1
                          ? 'text-amber-600'
                          : 'text-zinc-500'
                    }>
                      {layer.quality}
                    </span>
                  </span>
                  <span>
                    cost:{' '}
                    <span className={
                      i === 1 ? 'text-amber-600' : 'text-emerald-600'
                    }>
                      {layer.cost}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline flow */}
      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 px-5 py-4">
        <p className="font-mono text-xs text-zinc-500">
          {t.flow.map((step, i) => (
            <span key={i}>
              {i > 0 && (
                <span className="text-zinc-700">{' -> '}</span>
              )}
              <span className={i % 2 === 1 ? 'text-amber-500/80' : 'text-zinc-400'}>
                {step}
              </span>
            </span>
          ))}
        </p>
      </div>
    </Section>
  )
}
