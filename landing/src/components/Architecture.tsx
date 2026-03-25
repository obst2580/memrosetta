import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

interface ArchitectureProps {
  readonly lang: Lang
}

export function Architecture({ lang }: ArchitectureProps) {
  const t = content[lang].architecture

  return (
    <Section id="architecture" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      {/* Package list */}
      <div className="space-y-3">
        {t.packages.map((pkg, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300"
          >
            <h3 className="mb-1.5 font-mono text-sm font-semibold text-zinc-800">
              {pkg.name}
            </h3>
            <p className="text-sm leading-relaxed text-zinc-500">
              {pkg.description}
            </p>
          </div>
        ))}
      </div>

      {/* Dependency graph */}
      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 px-5 py-4">
        <p className="font-mono text-xs text-zinc-500">
          <span className="text-zinc-600">{'// dependency flow'}</span>
        </p>
        <p className="mt-1 font-mono text-xs text-zinc-400">
          {t.dependencyGraph}
        </p>
      </div>
    </Section>
  )
}
