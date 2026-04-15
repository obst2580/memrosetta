import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'

interface SupportedTool {
  readonly name: string
  readonly mcp: boolean
  readonly setup: string
  readonly note: {
    readonly en: string
    readonly ko: string
  }
}

const SUPPORTED_TOOLS: readonly SupportedTool[] = [
  {
    name: 'Claude Code',
    mcp: true,
    setup: 'memrosetta init --claude-code',
    note: {
      en: 'MCP + enforced Stop hook',
      ko: 'MCP + 강제 Stop hook',
    },
  },
  {
    name: 'Claude Desktop',
    mcp: true,
    setup: 'memrosetta init --mcp',
    note: {
      en: 'Shared local DB client',
      ko: '공유 로컬 DB 클라이언트',
    },
  },
  {
    name: 'Cursor',
    mcp: true,
    setup: 'memrosetta init --cursor',
    note: {
      en: 'MCP + optional device sync',
      ko: 'MCP + 선택적 기기 sync',
    },
  },
  {
    name: 'Windsurf',
    mcp: true,
    setup: 'memrosetta init --mcp',
    note: {
      en: 'MCP + optional device sync',
      ko: 'MCP + 선택적 기기 sync',
    },
  },
  {
    name: 'Codex',
    mcp: true,
    setup: 'memrosetta init --codex',
    note: {
      en: 'MCP + optional device sync',
      ko: 'MCP + 선택적 기기 sync',
    },
  },
  {
    name: 'Gemini',
    mcp: true,
    setup: 'memrosetta init --gemini',
    note: {
      en: 'MCP + optional device sync',
      ko: 'MCP + 선택적 기기 sync',
    },
  },
  {
    name: 'Cline (VS Code)',
    mcp: true,
    setup: 'memrosetta init --mcp',
    note: {
      en: 'MCP + optional device sync',
      ko: 'MCP + 선택적 기기 sync',
    },
  },
  {
    name: 'Continue (VS Code)',
    mcp: true,
    setup: 'memrosetta init --mcp',
    note: {
      en: 'MCP + optional device sync',
      ko: 'MCP + 선택적 기기 sync',
    },
  },
  {
    name: 'ChatGPT / Copilot',
    mcp: false,
    setup: 'CLI / REST API',
    note: {
      en: 'Use sync via CLI or API',
      ko: 'CLI 또는 API로 sync',
    },
  },
  {
    name: 'Custom apps',
    mcp: false,
    setup: 'npm install @memrosetta/core',
    note: {
      en: 'Embed core or sync client',
      ko: 'core 또는 sync-client 내장',
    },
  },
]

interface CompatibilityProps {
  readonly lang: Lang
}

export function Compatibility({ lang }: CompatibilityProps) {
  const t = content[lang].compatibility
  const localNote =
    lang === 'ko'
      ? '(기본은 로컬 공유, 같은 --user로 기기 연결)'
      : '(shared locally by default, same --user connects devices)'
  const syncServerLabel =
    lang === 'ko'
      ? 'optional sync server'
      : 'optional sync server'
  const remoteDeviceLabel =
    lang === 'ko'
      ? '다른 기기 ~/.memrosetta/memories.db'
      : 'other device ~/.memrosetta/memories.db'
  const syncFlowLabel =
    lang === 'ko'
      ? '같은 논리 사용자 ID, pull은 로컬 memories에 적용'
      : 'same logical user id, pull applies into local memories'
  const mcpEnabledLabel = lang === 'ko' ? '지원' : 'Yes'

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
        <p className="mt-3 text-zinc-600">
          <span>{syncServerLabel}</span>
          <span className="px-2 text-zinc-500">{'<->'}</span>
          <span className="text-zinc-300">{remoteDeviceLabel}</span>
        </p>
        <p className="text-zinc-600">{syncFlowLabel}</p>
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
              <th className="pb-3 pl-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
                {t.table.headers.note}
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
                    <span className="text-emerald-600">{mcpEnabledLabel}</span>
                  ) : (
                    <span className="text-zinc-400">--</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 font-mono text-xs text-zinc-500">
                  {tool.setup}
                </td>
                <td className="py-2.5 text-xs text-zinc-500">
                  {tool.note[lang]}
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
