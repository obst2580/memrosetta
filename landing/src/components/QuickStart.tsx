import { useState } from 'react'
import type { Lang } from '../i18n'
import { content } from '../i18n'
import { Section, SectionTitle } from './Section'
import { CodeBlock } from './CodeBlock'

type Tab = 'claude-code' | 'cursor' | 'codex' | 'gemini' | 'cli'

const TAB_ORDER: readonly Tab[] = ['claude-code', 'cursor', 'codex', 'gemini', 'cli']

interface QuickStartProps {
  readonly lang: Lang
}

const PACKAGES = [
  { name: '@memrosetta/core', en: 'Memory engine: SQLite + FTS5 + vector + NLI', ko: '메모리 엔진: SQLite + FTS5 + 벡터 + NLI' },
  { name: '@memrosetta/embeddings', en: 'Local embeddings (bge-small-en-v1.5) + NLI', ko: '로컬 임베딩 (bge-small-en-v1.5) + NLI' },
  { name: '@memrosetta/mcp', en: 'MCP server for AI tool integration', ko: 'AI 도구 연동용 MCP 서버' },
  { name: '@memrosetta/claude-code', en: 'Claude Code integration (hooks + init)', ko: 'Claude Code 통합 (hooks + init)' },
  { name: '@memrosetta/cli', en: 'Command-line interface', ko: '커맨드라인 인터페이스' },
  { name: '@memrosetta/api', en: 'REST API (Hono)', ko: 'REST API (Hono)' },
  { name: '@memrosetta/llm', en: 'LLM fact extraction (optional)', ko: 'LLM 사실 추출 (옵션)' },
  { name: '@memrosetta/obsidian', en: 'Obsidian vault sync', ko: '옵시디언 볼트 동기화' },
]

export function QuickStart({ lang }: QuickStartProps) {
  const [activeTab, setActiveTab] = useState<Tab>('claude-code')
  const t = content[lang].quickStart
  const snippet = t.code[activeTab]

  return (
    <Section id="quick-start" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-2 font-mono text-sm transition-colors ${
              activeTab === tab
                ? 'border-amber-500 text-zinc-900'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            {t.tabs[tab]}
          </button>
        ))}
      </div>

      {/* Code block */}
      <CodeBlock code={snippet.code} language={snippet.language} />

      {/* Packages */}
      <div className="mt-14">
        <h3 className="mb-4 font-mono text-xs font-medium uppercase tracking-wider text-zinc-400">
          {t.packages.title}
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {PACKAGES.map((pkg) => (
            <a
              key={pkg.name}
              href={`https://www.npmjs.com/package/${pkg.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-3 rounded-md border border-zinc-100 px-4 py-3 transition-colors hover:border-zinc-200 hover:bg-zinc-50"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs text-zinc-700 group-hover:text-amber-600">
                  {pkg.name}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {lang === 'en' ? pkg.en : pkg.ko}
                </p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </Section>
  )
}
