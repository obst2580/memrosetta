import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

interface ComparisonProps {
  readonly lang: Lang
}

export function Comparison({ lang }: ComparisonProps) {
  const t = content[lang].comparison

  return (
    <Section id="comparison" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="pb-3 pr-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400" />
              <th className="pb-3 pr-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.headers.mem0}
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.headers.zep}
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.headers.letta}
              </th>
              <th className="pb-3 font-mono text-xs font-medium uppercase tracking-wider text-amber-600">
                {t.headers.memrosetta}
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-50">
                <td className="py-2.5 pr-4 text-zinc-700">
                  {row.feature}
                </td>
                <td className="py-2.5 pr-4 text-zinc-400">{row.mem0}</td>
                <td className="py-2.5 pr-4 text-zinc-400">{row.zep}</td>
                <td className="py-2.5 pr-4 text-zinc-400">{row.letta}</td>
                <td className="py-2.5 font-medium text-zinc-800">
                  {row.memrosetta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
