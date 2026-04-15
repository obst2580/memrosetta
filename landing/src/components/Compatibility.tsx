import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

const SUPPORTED_TOOLS = [
  { name: 'Claude Code', mcp: true, setup: 'memrosetta init --claude-code' },
  { name: 'Claude Desktop', mcp: true, setup: 'memrosetta init --mcp' },
  { name: 'Cursor', mcp: true, setup: 'memrosetta init --cursor' },
  { name: 'Windsurf', mcp: true, setup: 'memrosetta init --mcp' },
  { name: 'Codex', mcp: true, setup: 'memrosetta init --codex' },
  { name: 'Gemini', mcp: true, setup: 'memrosetta init --gemini' },
  { name: 'Cline (VS Code)', mcp: true, setup: 'memrosetta init --mcp' },
  { name: 'Continue (VS Code)', mcp: true, setup: 'memrosetta init --mcp' },
  { name: 'ChatGPT / Copilot', mcp: false, setup: 'CLI / REST API' },
  { name: 'Custom apps', mcp: false, setup: 'npm install @memrosetta/core' },
]

interface CompatibilityProps {
  readonly lang: Lang
}

export function Compatibility({ lang }: CompatibilityProps) {
  const t = content[lang].compatibility
  const localNote =
    lang === 'ko'
      ? '(기본은 로컬 공유, 기기 간은 선택적 동기화)'
      : '(shared locally by default, optional sync across devices)'

  return (
    <Section id="compatibility" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      {/* Shared DB diagram */}
      <div className="mb-8 rounded-lg border border-zinc-200 bg-zinc-950 p-5 font-mono text-sm leading-relaxed text-zinc-400">
        <p className="text-zinc-600">{t.diagramComment}</p>
        <p className="mt-2">
          <span className="text-zinc-300">Claude Code</span>
          {'    ----+'}
        </p>
        <p>
          <span className="text-zinc-300">Claude Desktop</span>
          {'  --+'}
          <span className="text-amber-500/80">
            {'--> ~/.memrosetta/memories.db'}
          </span>
        </p>
        <p>
          <span className="text-zinc-300">Cursor</span>
          {'           --+     '}
          <span className="text-zinc-600">{localNote}</span>
        </p>
        <p>
          <span className="text-zinc-300">Windsurf</span>
          {'         --+'}
        </p>
        <p>
          <span className="text-zinc-300">Codex</span>
          {'            --+'}
        </p>
        <p>
          <span className="text-zinc-300">Gemini</span>
          {'           --+'}
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="pb-3 pr-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.table.headers.tool}
              </th>
              <th className="pb-3 pr-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.table.headers.mcp}
              </th>
              <th className="pb-3 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.table.headers.setup}
              </th>
            </tr>
          </thead>
          <tbody>
            {SUPPORTED_TOOLS.map((tool, i) => (
              <tr
                key={i}
                className="border-b border-zinc-50"
              >
                <td className="py-2.5 pr-4 text-zinc-700">
                  {tool.name}
                </td>
                <td className="py-2.5 pr-4 font-mono text-xs">
                  {tool.mcp ? (
                    <span className="text-emerald-600">Yes</span>
                  ) : (
                    <span className="text-zinc-400">--</span>
                  )}
                </td>
                <td className="py-2.5 font-mono text-xs text-zinc-500">
                  {tool.setup}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cross-tool note */}
      <div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm font-medium text-zinc-700">
          {t.sharing.title}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-500">
          {t.sharing.description}
        </p>
      </div>
    </Section>
  )
}
