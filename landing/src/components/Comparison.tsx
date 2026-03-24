import { Section, SectionTitle } from './Section'

const FEATURES = [
  {
    feature: 'Local-first',
    mem0: 'Cloud',
    zep: 'Cloud',
    letta: 'Cloud + Local',
    memrosetta: 'Local (SQLite)',
  },
  {
    feature: 'LLM dependency',
    mem0: 'Required',
    zep: 'Required',
    letta: 'Required',
    memrosetta: 'None (core)',
  },
  {
    feature: 'Contradiction detection',
    mem0: 'No',
    zep: 'No',
    letta: 'No',
    memrosetta: 'Yes (NLI, local)',
  },
  {
    feature: 'Forgetting model',
    mem0: 'No',
    zep: 'No',
    letta: 'No',
    memrosetta: 'Yes (ACT-R)',
  },
  {
    feature: 'Time model',
    mem0: 'No',
    zep: 'No',
    letta: 'No',
    memrosetta: 'Yes (4 timestamps)',
  },
  {
    feature: 'Relational versioning',
    mem0: 'No',
    zep: 'No',
    letta: 'No',
    memrosetta: 'Yes (5 types)',
  },
  {
    feature: 'Open protocol',
    mem0: 'API only',
    zep: 'API only',
    letta: 'API only',
    memrosetta: 'CLI + MCP + API',
  },
  {
    feature: 'Install',
    mem0: 'Complex',
    zep: 'Complex',
    letta: 'Complex',
    memrosetta: 'One command',
  },
]

export function Comparison() {
  return (
    <Section id="comparison" className="border-t border-zinc-100">
      <SectionTitle subtitle="How MemRosetta compares to existing AI memory solutions.">
        Why MemRosetta?
      </SectionTitle>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="pb-3 pr-4 font-medium text-zinc-400" />
              <th className="pb-3 pr-4 font-mono text-xs font-medium text-zinc-400">
                Mem0
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium text-zinc-400">
                Zep
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium text-zinc-400">
                Letta
              </th>
              <th className="pb-3 font-mono text-xs font-medium text-amber-600">
                MemRosetta
              </th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100">
                <td className="py-3 pr-4 font-medium text-zinc-700">
                  {row.feature}
                </td>
                <td className="py-3 pr-4 text-zinc-400">{row.mem0}</td>
                <td className="py-3 pr-4 text-zinc-400">{row.zep}</td>
                <td className="py-3 pr-4 text-zinc-400">{row.letta}</td>
                <td className="py-3 font-medium text-amber-600">
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
