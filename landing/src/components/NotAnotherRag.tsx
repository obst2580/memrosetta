import { Section, SectionTitle } from './Section'

const COMPARISON_ROWS = [
  {
    feature: 'Storage unit',
    rag: '~400 token text chunks',
    memrosetta: 'One fact = one memory',
  },
  {
    feature: 'Updates',
    rag: 'Re-index entire document',
    memrosetta: 'updates relation, old version preserved',
  },
  {
    feature: 'Contradictions',
    rag: 'Both versions returned, AI guesses',
    memrosetta: 'Auto-detected by NLI model',
  },
  {
    feature: 'Time awareness',
    rag: 'None',
    memrosetta: '4 timestamps: learned, documented, event, invalidated',
  },
  {
    feature: 'Forgetting',
    rag: 'Everything equal weight',
    memrosetta: 'ACT-R: frequently used memories rank higher',
  },
]

export function NotAnotherRag() {
  return (
    <Section id="not-rag" className="border-t border-zinc-100">
      <SectionTitle subtitle="Traditional RAG chops documents into text chunks and searches by similarity. MemRosetta is fundamentally different.">
        Not Another RAG
      </SectionTitle>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="pb-3 pr-6 font-medium text-zinc-400" />
              <th className="pb-3 pr-6 font-mono text-xs font-medium text-zinc-400">
                RAG (chunk-based)
              </th>
              <th className="pb-3 font-mono text-xs font-medium text-amber-600">
                MemRosetta (atomic)
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100">
                <td className="py-3 pr-6 font-medium text-zinc-700">
                  {row.feature}
                </td>
                <td className="py-3 pr-6 text-zinc-400">{row.rag}</td>
                <td className="py-3 text-zinc-700">{row.memrosetta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Visual diagram */}
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {/* RAG side */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6">
          <h3 className="mb-4 font-mono text-sm font-medium text-zinc-400">
            RAG approach
          </h3>
          <div className="space-y-2">
            {['Chunk 1: "...API uses Spring Boot with Post..."', 'Chunk 2: "...greSql, deployed on Azure. We al..."', 'Chunk 3: "...so decided to use approach B fo..."'].map(
              (chunk, i) => (
                <div
                  key={i}
                  className="rounded border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-400"
                >
                  {chunk}
                </div>
              ),
            )}
            <p className="mt-3 text-xs text-zinc-400">
              Text split arbitrarily. Facts span multiple chunks.
              Updates require re-indexing. No concept of time or validity.
            </p>
          </div>
        </div>

        {/* MemRosetta side */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h3 className="mb-4 font-mono text-sm font-medium text-amber-600">
            MemRosetta approach
          </h3>
          <div className="space-y-2">
            {[
              { content: 'API uses Spring Boot + PostgreSQL on Azure', type: 'fact' },
              { content: 'Decided: approach B for auth system', type: 'decision' },
              { content: 'Fix: batch size must be 4', type: 'fact' },
            ].map((memory, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded border border-amber-200 bg-white px-3 py-2"
              >
                <span className="mt-px rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                  {memory.type}
                </span>
                <span className="font-mono text-xs text-zinc-700">
                  {memory.content}
                </span>
              </div>
            ))}
            <p className="mt-3 text-xs text-zinc-500">
              One fact = one memory. Each has type, timestamps, keywords, relations.
              Updates create links, contradictions are auto-detected.
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}
