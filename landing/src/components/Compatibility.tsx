import { Section, SectionTitle } from './Section'

const SUPPORTED_TOOLS = [
  { name: 'Claude Code', mcp: true, setup: 'One command', note: 'npx @memrosetta/claude-code init' },
  { name: 'Claude Desktop', mcp: true, setup: 'MCP config', note: 'Settings > Developer > MCP' },
  { name: 'Cursor', mcp: true, setup: 'MCP config', note: '.cursor/mcp.json' },
  { name: 'Windsurf', mcp: true, setup: 'MCP config', note: 'MCP settings' },
  { name: 'Cline (VS Code)', mcp: true, setup: 'MCP config', note: 'Extension settings' },
  { name: 'Continue (VS Code)', mcp: true, setup: 'MCP config', note: 'MCP config' },
  { name: 'ChatGPT / Copilot', mcp: false, setup: 'CLI / REST API', note: 'No MCP support yet' },
  { name: 'Custom apps', mcp: false, setup: 'npm install', note: '@memrosetta/core as library' },
]

export function Compatibility() {
  return (
    <Section id="compatibility" className="border-t border-zinc-100">
      <SectionTitle subtitle="One local database, shared across all your AI tools. Memories stored in Claude Code are searchable from Cursor, and vice versa.">
        Works Everywhere
      </SectionTitle>

      <div className="mx-auto max-w-2xl">
        <div className="mb-8 rounded-lg bg-zinc-50 p-6 font-mono text-sm leading-relaxed text-zinc-600">
          <p className="mb-2 text-zinc-400">{'// All tools share one database'}</p>
          <p>Claude Code ----{'>'}</p>
          <p>Claude Desktop --{'>'} ~/.memrosetta/memories.db</p>
          <p>Cursor ---------{'>'} (one shared SQLite file)</p>
          <p>Windsurf -------{'>'}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="pb-3 pr-4 font-medium text-zinc-400">Tool</th>
                <th className="pb-3 pr-4 font-medium text-zinc-400">MCP</th>
                <th className="pb-3 pr-4 font-medium text-zinc-400">Setup</th>
                <th className="pb-3 font-medium text-zinc-400">Note</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_TOOLS.map((tool, i) => (
                <tr key={i} className="border-b border-zinc-100">
                  <td className="py-3 pr-4 font-medium text-zinc-700">{tool.name}</td>
                  <td className="py-3 pr-4">
                    {tool.mcp ? (
                      <span className="text-emerald-600">Yes</span>
                    ) : (
                      <span className="text-zinc-400">No</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-zinc-600">{tool.setup}</td>
                  <td className="py-3 font-mono text-xs text-zinc-400">{tool.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Cross-tool memory sharing</p>
          <p className="mt-1 text-amber-700">
            Morning: Claude Code session about auth system &rarr; memories saved.{' '}
            Afternoon: Open Cursor for frontend &rarr; search "auth" &rarr; finds morning's decisions.{' '}
            No sync, no cloud. Same local file.
          </p>
        </div>
      </div>
    </Section>
  )
}
