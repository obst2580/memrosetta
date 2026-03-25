import type { Lang } from '../i18n'
import { Section, SectionTitle } from './Section'

interface UsageProps {
  readonly lang: Lang
}

const CONTENT = {
  en: {
    title: 'What Actually Happens',
    subtitle: 'A real workflow across sessions and tools.',
    steps: [
      {
        label: 'Monday morning',
        tool: 'Claude Code',
        lines: [
          { speaker: 'You', text: '"Let\'s use OAuth2 with PKCE for auth."' },
          { speaker: 'Claude', text: '(stores decision via MCP)', dim: true },
          { speaker: 'You', text: '"API rate limit: 100 req/min per user."' },
          { speaker: 'Claude', text: '(stores fact via MCP)', dim: true },
          { speaker: '', text: 'Session ends. Terminal closed.', dim: true },
        ],
      },
      {
        label: 'Tuesday',
        tool: 'New Claude Code session',
        lines: [
          { speaker: 'You', text: '"What did we decide about auth?"' },
          { speaker: 'Claude', text: '(searches MemRosetta)', dim: true },
          { speaker: 'Claude', text: '"OAuth2 with PKCE. JWT tokens rotate on every use."' },
          { speaker: '', text: 'Found from Monday. Automatically.', dim: true },
        ],
      },
      {
        label: 'Tuesday afternoon',
        tool: 'Cursor',
        lines: [
          { speaker: 'You', text: '"What\'s the auth setup for the API?"' },
          { speaker: 'Cursor', text: '(searches same MemRosetta DB)', dim: true },
          { speaker: 'Cursor', text: '"OAuth2 + PKCE, rate limit 100 req/min."' },
          { speaker: '', text: 'Same memories. Different tool.', dim: true },
        ],
      },
    ],
    footer: 'One SQLite file. All your AI tools share it. No cloud. No config.',
  },
  ko: {
    title: '실제로 이런 일이 일어납니다',
    subtitle: '세션과 도구를 넘나드는 실제 워크플로우.',
    steps: [
      {
        label: '월요일 오전',
        tool: 'Claude Code',
        lines: [
          { speaker: '나', text: '"인증은 OAuth2 + PKCE로 가자."' },
          { speaker: 'Claude', text: '(MCP로 결정 사항 저장)', dim: true },
          { speaker: '나', text: '"API rate limit은 사용자당 분당 100회로."' },
          { speaker: 'Claude', text: '(MCP로 사실 저장)', dim: true },
          { speaker: '', text: '세션 종료. 터미널 닫음.', dim: true },
        ],
      },
      {
        label: '화요일',
        tool: '새 Claude Code 세션',
        lines: [
          { speaker: '나', text: '"인증 어떻게 하기로 했지?"' },
          { speaker: 'Claude', text: '(MemRosetta 검색)', dim: true },
          { speaker: 'Claude', text: '"OAuth2 + PKCE로 결정. JWT 토큰 매번 갱신."' },
          { speaker: '', text: '월요일 세션에서 자동으로 찾아옴.', dim: true },
        ],
      },
      {
        label: '화요일 오후',
        tool: 'Cursor',
        lines: [
          { speaker: '나', text: '"API 인증 설정이 어떻게 돼?"' },
          { speaker: 'Cursor', text: '(같은 MemRosetta DB 검색)', dim: true },
          { speaker: 'Cursor', text: '"OAuth2 + PKCE, rate limit 분당 100회."' },
          { speaker: '', text: '같은 기억. 다른 도구.', dim: true },
        ],
      },
    ],
    footer: 'SQLite 파일 하나. 모든 AI 도구가 공유. 클라우드 없음. 설정 없음.',
  },
} as const

export function Usage({ lang }: UsageProps) {
  const t = CONTENT[lang]

  return (
    <Section id="usage" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      <div className="space-y-4">
        {t.steps.map((step, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-zinc-200">
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              </div>
              <span className="ml-2 font-mono text-xs text-zinc-500">{step.tool}</span>
              <span className="ml-auto font-mono text-xs text-amber-600/70">{step.label}</span>
            </div>
            <div className="bg-zinc-950 px-4 py-3 font-mono text-sm leading-relaxed">
              {step.lines.map((line, j) => {
                const isDim = 'dim' in line && line.dim;
                return (
                  <p key={j} className={isDim ? 'text-zinc-600' : 'text-zinc-300'}>
                    {line.speaker && (
                      <span className={isDim ? 'text-zinc-600' : 'text-amber-500/80'}>
                        {line.speaker}:{' '}
                      </span>
                    )}
                    {line.text}
                  </p>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-sm font-medium text-zinc-500">
        {t.footer}
      </p>
    </Section>
  )
}
