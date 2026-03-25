import type { Lang } from '../i18n'
import { Section, SectionTitle } from './Section'

interface UsageProps {
  readonly lang: Lang
}

const CONTENT = {
  en: {
    title: 'What Actually Happens',
    subtitle: 'Install once. Your AI tools remember everything from every session, automatically.',
    steps: [
      {
        label: 'Monday morning',
        tool: 'Claude Code',
        description: 'You\'re working in Claude Code as usual. You make technical decisions, discuss architecture, debug issues. You don\'t do anything special -- just work normally. Behind the scenes, Claude automatically stores important decisions and facts to MemRosetta via MCP. You never notice.',
        lines: [
          { speaker: 'You', text: '"Let\'s use OAuth2 with PKCE for auth."' },
          { speaker: 'Claude', text: 'Understood. I\'ll implement OAuth2 with PKCE.' },
          { speaker: '', text: '(Claude silently stores this decision to MemRosetta)', dim: true },
          { speaker: 'You', text: '"API rate limit should be 100 req/min per user."' },
          { speaker: 'Claude', text: 'Got it. I\'ll add rate limiting middleware.' },
          { speaker: '', text: '(fact stored automatically)', dim: true },
          { speaker: '', text: '' },
          { speaker: '', text: 'You close the terminal. Session is gone.', dim: true },
        ],
        highlight: 'Zero effort from you. Claude decides what\'s worth remembering.',
      },
      {
        label: 'Tuesday -- completely new session',
        tool: 'Claude Code (fresh)',
        description: 'Next day. You start a new Claude Code session. The AI has zero context -- it\'s a blank slate. But when you ask about yesterday\'s work, Claude searches MemRosetta and finds your decisions instantly. No copy-pasting. No "handoff document". No NotebookLM workaround.',
        lines: [
          { speaker: 'You', text: '"What did we decide about the auth system?"' },
          { speaker: '', text: '(Claude searches MemRosetta -- finds 2 results from Monday)', dim: true },
          { speaker: 'Claude', text: '"We decided on OAuth2 with PKCE for authentication.' },
          { speaker: '', text: ' JWT refresh tokens rotate on every use.' },
          { speaker: '', text: ' API rate limit is 100 req/min per user."' },
          { speaker: '', text: '' },
          { speaker: '', text: 'All from yesterday. Found automatically.', dim: true },
        ],
        highlight: 'New session, full context. Like the conversation never ended.',
      },
      {
        label: 'Tuesday afternoon -- different tool',
        tool: 'Cursor',
        description: 'You switch to Cursor for frontend work. Different tool, different AI. But it connects to the same MemRosetta database on your machine. When you ask about the backend API, Cursor finds the same decisions Claude stored yesterday. One file, all tools.',
        lines: [
          { speaker: 'You', text: '"What\'s the auth configuration for the API?"' },
          { speaker: '', text: '(Cursor searches the same ~/.memrosetta/memories.db)', dim: true },
          { speaker: 'Cursor', text: '"The API uses OAuth2 with PKCE.' },
          { speaker: '', text: ' Rate limit: 100 requests per minute per user."' },
          { speaker: '', text: '' },
          { speaker: '', text: 'Same memories. Same DB. Different tool.', dim: true },
        ],
        highlight: 'Claude Code, Cursor, Claude Desktop -- all share one memory.',
      },
    ],
    footer: 'One SQLite file on your machine. All your AI tools read and write to it. No cloud. No server. No configuration beyond the initial setup.',
    setup: {
      title: 'Setup takes 10 seconds:',
      command: 'npm install -g @memrosetta/cli && memrosetta init --claude-code',
    },
  },
  ko: {
    title: '실제로 이런 일이 일어납니다',
    subtitle: '한번 설치하면, AI 도구가 모든 세션의 모든 것을 자동으로 기억합니다.',
    steps: [
      {
        label: '월요일 오전',
        tool: 'Claude Code',
        description: '평소처럼 Claude Code로 작업합니다. 기술 결정을 내리고, 아키텍처를 논의하고, 버그를 잡습니다. 특별한 건 아무것도 안 합니다 -- 그냥 일합니다. 뒤에서 Claude가 자동으로 중요한 결정과 사실을 MCP를 통해 MemRosetta에 저장합니다. 알아채지도 못합니다.',
        lines: [
          { speaker: '나', text: '"인증은 OAuth2 + PKCE로 가자."' },
          { speaker: 'Claude', text: '알겠습니다. OAuth2 + PKCE로 구현하겠습니다.' },
          { speaker: '', text: '(Claude가 이 결정을 MemRosetta에 자동 저장)', dim: true },
          { speaker: '나', text: '"API rate limit은 사용자당 분당 100회로."' },
          { speaker: 'Claude', text: '네, rate limiting 미들웨어를 추가하겠습니다.' },
          { speaker: '', text: '(사실 자동 저장)', dim: true },
          { speaker: '', text: '' },
          { speaker: '', text: '터미널을 닫음. 세션 사라짐.', dim: true },
        ],
        highlight: '사용자가 할 일은 없습니다. Claude가 뭘 기억할지 알아서 판단합니다.',
      },
      {
        label: '화요일 -- 완전히 새로운 세션',
        tool: 'Claude Code (새 세션)',
        description: '다음 날. 새 Claude Code 세션을 시작합니다. AI는 컨텍스트가 제로 -- 백지 상태입니다. 하지만 어제 작업에 대해 물어보면, Claude가 MemRosetta를 검색해서 결정 사항을 즉시 찾아냅니다. 복붙 없음. "인수인계서" 없음. NotebookLM 우회도 없음.',
        lines: [
          { speaker: '나', text: '"인증 어떻게 하기로 했지?"' },
          { speaker: '', text: '(Claude가 MemRosetta 검색 -- 월요일 결과 2건 발견)', dim: true },
          { speaker: 'Claude', text: '"인증은 OAuth2 + PKCE로 결정했습니다.' },
          { speaker: '', text: ' JWT refresh token은 매번 갱신합니다.' },
          { speaker: '', text: ' API rate limit은 사용자당 분당 100회입니다."' },
          { speaker: '', text: '' },
          { speaker: '', text: '어제 세션에서 자동으로 찾아옴.', dim: true },
        ],
        highlight: '새 세션인데 모든 맥락이 있습니다. 대화가 끊기지 않은 것처럼.',
      },
      {
        label: '화요일 오후 -- 다른 도구',
        tool: 'Cursor',
        description: '프론트엔드 작업을 위해 Cursor로 전환합니다. 다른 도구, 다른 AI. 하지만 같은 MemRosetta 데이터베이스를 사용합니다. 백엔드 API에 대해 물어보면, Cursor가 어제 Claude가 저장한 결정을 찾아냅니다. 파일 하나, 모든 도구.',
        lines: [
          { speaker: '나', text: '"API 인증 설정이 어떻게 돼?"' },
          { speaker: '', text: '(Cursor가 같은 ~/.memrosetta/memories.db 검색)', dim: true },
          { speaker: 'Cursor', text: '"OAuth2 + PKCE 인증.' },
          { speaker: '', text: ' Rate limit: 사용자당 분당 100회."' },
          { speaker: '', text: '' },
          { speaker: '', text: '같은 기억. 같은 DB. 다른 도구.', dim: true },
        ],
        highlight: 'Claude Code, Cursor, Claude Desktop -- 모두 하나의 기억을 공유합니다.',
      },
    ],
    footer: '내 컴퓨터의 SQLite 파일 하나. 모든 AI 도구가 읽고 씁니다. 클라우드 없음. 서버 없음. 초기 설정 외에 설정할 것 없음.',
    setup: {
      title: '설정은 10초면 끝:',
      command: 'npm install -g @memrosetta/cli && memrosetta init --claude-code',
    },
  },
} as const

export function Usage({ lang }: UsageProps) {
  const t = CONTENT[lang]

  return (
    <Section id="usage" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      <div className="space-y-8">
        {t.steps.map((step, i) => (
          <div key={i}>
            {/* Description */}
            <div className="mb-3">
              <p className="text-sm leading-relaxed text-zinc-600">
                {step.description}
              </p>
            </div>

            {/* Terminal card */}
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                </div>
                <span className="ml-2 font-mono text-xs text-zinc-500">{step.tool}</span>
                <span className="ml-auto font-mono text-xs text-amber-600/70">{step.label}</span>
              </div>
              <div className="bg-zinc-950 px-4 py-3 font-mono text-[13px] leading-relaxed">
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

            {/* Highlight */}
            <p className="mt-2 text-sm font-medium text-amber-700">
              {step.highlight}
            </p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-10 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-center">
        <p className="text-sm text-zinc-500">{t.footer}</p>
        <p className="mt-3 text-xs font-medium text-zinc-400">{t.setup.title}</p>
        <code className="mt-1 inline-block rounded bg-zinc-900 px-3 py-1.5 font-mono text-xs text-amber-400">
          {t.setup.command}
        </code>
      </div>
    </Section>
  )
}
