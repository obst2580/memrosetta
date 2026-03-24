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
    <Section id="comparison" className="border-t border-zinc-900">
      <SectionTitle subtitle="How MemRosetta compares to existing AI memory solutions.">
        Why MemRosetta?
      </SectionTitle>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="pb-3 pr-4 font-medium text-zinc-500" />
              <th className="pb-3 pr-4 font-mono text-xs font-medium text-zinc-500">
                Mem0
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium text-zinc-500">
                Zep
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium text-zinc-500">
                Letta
              </th>
              <th className="pb-3 font-mono text-xs font-medium text-amber-400">
                MemRosetta
              </th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((row, i) => (
              <tr key={i} className="border-b border-zinc-800/50">
                <td className="py-3 pr-4 font-medium text-zinc-300">
                  {row.feature}
                </td>
                <td className="py-3 pr-4 text-zinc-600">{row.mem0}</td>
                <td className="py-3 pr-4 text-zinc-600">{row.zep}</td>
                <td className="py-3 pr-4 text-zinc-600">{row.letta}</td>
                <td className="py-3 font-medium text-amber-400">
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
