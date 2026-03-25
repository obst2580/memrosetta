import type { Lang } from '../i18n'
import { Section, SectionTitle } from './Section'

interface DemoProps {
  readonly lang: Lang
}

const TITLES = {
  en: {
    title: 'See It In Action',
    subtitle: 'Store memories in one session. Search from another. Any AI tool.',
  },
  ko: {
    title: '동작 확인',
    subtitle: '한 세션에서 기억을 저장. 다른 세션에서 검색. 어떤 AI 도구에서든.',
  },
} as const

interface StepContent {
  readonly label: string
  readonly tool: string
  readonly lines: readonly string[]
}

const STEPS: Record<Lang, readonly StepContent[]> = {
  en: [
    {
      label: 'Step 1: Store',
      tool: 'Claude Code',
      lines: [
        '$ memrosetta store \\',
        '    --content "Auth uses OAuth2 \\',
        '     with PKCE" \\',
        '    --type decision',
        '',
        'Stored: mem-abc123',
      ],
    },
    {
      label: 'Step 2: Search',
      tool: 'New Session',
      lines: [
        '$ memrosetta search \\',
        '    --query "auth decision"',
        '',
        '[0.95] Auth uses OAuth2',
        '  with PKCE (decision)',
        '[0.82] JWT tokens rotate',
        '  on every use (decision)',
      ],
    },
    {
      label: 'Step 3: Share',
      tool: 'Cursor',
      lines: [
        'Same query in Cursor',
        'gets the same results.',
        '',
        'One DB file.',
        'All tools share it.',
        '',
        '~/.memrosetta/memories.db',
      ],
    },
  ],
  ko: [
    {
      label: '1단계: 저장',
      tool: 'Claude Code',
      lines: [
        '$ memrosetta store \\',
        '    --content "인증에 OAuth2 \\',
        '     + PKCE 사용" \\',
        '    --type decision',
        '',
        'Stored: mem-abc123',
      ],
    },
    {
      label: '2단계: 검색',
      tool: '새 세션',
      lines: [
        '$ memrosetta search \\',
        '    --query "auth decision"',
        '',
        '[0.95] 인증에 OAuth2',
        '  + PKCE 사용 (decision)',
        '[0.82] JWT 토큰 매번',
        '  갱신 (decision)',
      ],
    },
    {
      label: '3단계: 공유',
      tool: 'Cursor',
      lines: [
        'Cursor에서 같은 쿼리 --',
        '같은 결과를 얻습니다.',
        '',
        'DB 파일 하나.',
        '모든 도구가 공유합니다.',
        '',
        '~/.memrosetta/memories.db',
      ],
    },
  ],
} as const

function TerminalCard({ step }: { readonly step: StepContent }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          </div>
          <span className="ml-2 font-mono text-xs text-zinc-500">
            {step.tool}
          </span>
        </div>
      </div>
      <div className="flex-1 bg-zinc-950 p-4">
        <pre className="overflow-x-auto">
          <code className="font-mono text-[13px] leading-relaxed text-zinc-300">
            {step.lines.join('\n')}
          </code>
        </pre>
      </div>
      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-2">
        <span className="font-mono text-xs font-medium text-zinc-400">
          {step.label}
        </span>
      </div>
    </div>
  )
}

export function Demo({ lang }: DemoProps) {
  const t = TITLES[lang]
  const steps = STEPS[lang]

  return (
    <Section id="demo" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <TerminalCard key={step.label} step={step} />
        ))}
      </div>
    </Section>
  )
}
