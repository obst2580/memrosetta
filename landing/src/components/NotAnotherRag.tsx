import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

interface NotAnotherRagProps {
  readonly lang: Lang
}

export function NotAnotherRag({ lang }: NotAnotherRagProps) {
  const t = content[lang].notAnotherRag

  return (
    <Section id="not-rag" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="pb-3 pr-6 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400" />
              <th className="pb-3 pr-6 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.headers.rag}
              </th>
              <th className="pb-3 font-mono text-xs font-medium uppercase tracking-wider text-amber-600">
                {t.headers.memrosetta}
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-50">
                <td className="py-2.5 pr-6 text-zinc-700">
                  {row.feature}
                </td>
                <td className="py-2.5 pr-6 text-zinc-400">{row.rag}</td>
                <td className="py-2.5 text-zinc-700">{row.memrosetta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Explanation */}
      <div className="mt-6 rounded-lg border border-zinc-100 bg-zinc-50 p-5">
        <p className="text-sm leading-relaxed text-zinc-600">
          {t.explanation}
        </p>
      </div>

      {/* Visual comparison */}
      <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 md:grid-cols-2">
        {/* RAG side */}
        <div className="bg-white p-6">
          <h3 className="mb-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
            {t.ragLabel}
          </h3>
          <div className="space-y-2">
            {t.ragChunks.map((chunk, i) => (
              <div
                key={i}
                className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-400"
              >
                {chunk}
              </div>
            ))}
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              {t.ragNote}
            </p>
          </div>
        </div>

        {/* MemRosetta side */}
        <div className="bg-zinc-50 p-6">
          <h3 className="mb-4 font-mono text-xs font-medium uppercase tracking-wider text-amber-600">
            {t.memrosettaLabel}
          </h3>
          <div className="space-y-2">
            {t.memrosettaMemories.map((memory, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded border border-zinc-200 bg-white px-3 py-2"
              >
                <span className="mt-px rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  {memory.type}
                </span>
                <span className="font-mono text-xs text-zinc-700">
                  {memory.content}
                </span>
              </div>
            ))}
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              {t.memrosettaNote}
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}
