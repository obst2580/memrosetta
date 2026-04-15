import type { Lang } from '../i18n'
import { Section, SectionTitle } from './Section'

interface UsageProps {
  readonly lang: Lang
}

const CONTENT = {
  en: {
    title: 'What Actually Happens',
    subtitle: 'The recent sync and enforce releases make memory capture automatic across sessions, tools, and machines.',
    steps: [
      {
        label: 'Monday evening -- enforced capture',
        tool: 'Claude Code',
        description: 'You work in Claude Code as usual. Important facts can still be stored live via MCP, but when the session ends the Stop hook now runs `memrosetta enforce stop` to catch anything the model did not explicitly save. Capture becomes structural, not a checklist the model might forget.',
        lines: [
          { speaker: 'You', text: '"Ship sync with a shared logical user id."' },
          { speaker: 'Claude', text: 'Understood. I\'ll use syncUserId instead of the OS username.' },
          { speaker: '', text: '(during the session: Claude can store memories via MCP)', dim: true },
          { speaker: 'Stop hook', text: 'memrosetta enforce stop -> STORED: decision(mem-...)' },
          { speaker: '', text: '(last assistant turn normalized, atomic memories extracted)', dim: true },
          { speaker: '', text: '' },
          { speaker: '', text: 'You close the terminal. Capture still runs.', dim: true },
        ],
        highlight: 'The session can end; the hook still enforces memory capture.',
      },
      {
        label: 'Tuesday morning -- another laptop',
        tool: 'Claude Code (Windows)',
        description: 'On another machine the OS username is different, but you configure the same logical sync user: `memrosetta sync enable --server ... --user alice`. `sync now` pushes and pulls, and pulled ops are applied into the local `memories` table, so the fresh session can search yesterday\'s decisions immediately.',
        lines: [
          { speaker: 'You', text: 'memrosetta sync enable --server https://sync.example.com --user alice' },
          { speaker: 'CLI', text: 'Configured syncUserId=alice' },
          { speaker: 'You', text: 'memrosetta sync now' },
          { speaker: 'CLI', text: 'push ok, pull ok -- 3 memories applied locally' },
          { speaker: 'You', text: '"What did we decide about sync identities?"' },
          { speaker: 'Claude', text: '"We use a shared logical user id via --user.' },
          { speaker: '', text: ' OS usernames can differ per machine."' },
        ],
        highlight: 'Different OS usernames, same person, same memory stream.',
      },
      {
        label: 'Tuesday afternoon -- CLI write and safe backfill',
        tool: 'CLI + Cursor',
        description: 'Manual CLI writes now join the same sync pipeline as MCP writes. If this device already had old local memories before sync was enabled, `memrosetta sync backfill` enqueues them once with deterministic op ids, and MCP clients stay current because the background loop now runs push plus pull.',
        lines: [
          { speaker: 'You', text: 'memrosetta store --user alice --type fact --content "keywords use space-joined format"' },
          { speaker: 'CLI', text: 'Stored locally + sync op queued' },
          { speaker: 'You', text: 'memrosetta sync backfill' },
          { speaker: 'CLI', text: 'Existing rows enqueued; duplicates ignored via deterministic op ids' },
          { speaker: '', text: '(Cursor\'s MCP loop later runs push + pull in background)', dim: true },
          { speaker: 'Cursor', text: '"I can see the normalized keyword note from the other device."' },
          { speaker: '', text: '' },
          { speaker: '', text: 'CLI writes, history backfill, and MCP clients now converge.', dim: true },
        ],
        highlight: 'CLI writes, historical backfill, and MCP clients converge on the same graph.',
      },
    ],
    footer: 'Local-first still means local by default. When you want another machine, run `memrosetta sync enable --server <url> --user <shared-id>` on each device; pull, backfill, and background sync are now safe to repeat.',
    setup: {
      title: 'Start local, add sync later:',
      command: 'npm install -g memrosetta && memrosetta init --claude-code',
    },
  },
  ko: {
    title: '실제로 이런 일이 일어납니다',
    subtitle: '최근 sync와 enforce 릴리즈로 세션, 도구, 기기 전반의 기억 캡처가 자동화됩니다.',
    steps: [
      {
        label: '월요일 저녁 -- 강제 캡처',
        tool: 'Claude Code',
        description: '평소처럼 Claude Code로 일합니다. 중요한 사실은 세션 중 MCP로 바로 저장될 수 있고, 세션이 끝날 때는 Stop hook이 `memrosetta enforce stop`을 실행해 모델이 명시적으로 저장하지 못한 내용까지 잡아냅니다. 기억 캡처가 더 이상 "기억나면 하는 일"이 아니라 구조가 됩니다.',
        lines: [
          { speaker: '나', text: '"sync는 공유 논리 user id로 가자."' },
          { speaker: 'Claude', text: '알겠습니다. OS username 대신 syncUserId를 쓰겠습니다.' },
          { speaker: '', text: '(세션 중: Claude가 MCP로 메모리를 저장할 수 있음)', dim: true },
          { speaker: 'Stop hook', text: 'memrosetta enforce stop -> STORED: decision(mem-...)' },
          { speaker: '', text: '(마지막 assistant 응답을 정규화하고 atomic memory 추출)', dim: true },
          { speaker: '', text: '' },
          { speaker: '', text: '터미널을 닫아도 캡처는 계속 실행됨.', dim: true },
        ],
        highlight: '세션이 끝나도 hook이 기억 캡처를 강제합니다.',
      },
      {
        label: '화요일 오전 -- 다른 노트북',
        tool: 'Claude Code (Windows)',
        description: '다른 기기에서는 OS username이 달라도 같은 논리 sync 사용자를 설정하면 됩니다: `memrosetta sync enable --server ... --user alice`. `sync now`가 push와 pull을 수행하고, pull한 op를 로컬 `memories` 테이블에 적용하므로 새 세션에서도 어제 결정을 바로 검색할 수 있습니다.',
        lines: [
          { speaker: '나', text: 'memrosetta sync enable --server https://sync.example.com --user alice' },
          { speaker: 'CLI', text: 'syncUserId=alice 로 설정 완료' },
          { speaker: '나', text: 'memrosetta sync now' },
          { speaker: 'CLI', text: 'push ok, pull ok -- 3개 memory 로컬 적용' },
          { speaker: '나', text: '"sync identity는 어떻게 하기로 했지?"' },
          { speaker: 'Claude', text: '"공유 논리 user id를 --user로 설정합니다.' },
          { speaker: '', text: ' 기기별 OS username은 달라도 됩니다."' },
        ],
        highlight: 'OS username이 달라도, 같은 사람이라면 같은 기억 스트림을 씁니다.',
      },
      {
        label: '화요일 오후 -- CLI 쓰기와 안전한 backfill',
        tool: 'CLI + Cursor',
        description: '이제 수동 CLI 쓰기도 MCP 쓰기와 같은 sync 파이프라인에 들어갑니다. sync를 켜기 전에 이 기기에 쌓여 있던 예전 로컬 기억이 있다면 `memrosetta sync backfill`이 deterministic op id로 한 번씩만 enqueue합니다. 그리고 MCP 클라이언트는 백그라운드 루프에서 push 다음 pull까지 수행해 최신 상태를 따라갑니다.',
        lines: [
          { speaker: '나', text: 'memrosetta store --user alice --type fact --content "keywords는 공백 결합 포맷 사용"' },
          { speaker: 'CLI', text: '로컬 저장 완료 + sync op enqueue' },
          { speaker: '나', text: 'memrosetta sync backfill' },
          { speaker: 'CLI', text: '기존 행 enqueue 완료, deterministic op id로 중복 무시' },
          { speaker: '', text: '(나중에 Cursor의 MCP 루프가 백그라운드에서 push + pull 수행)', dim: true },
          { speaker: 'Cursor', text: '"다른 기기에서 온 keywords 정규화 메모리가 보입니다."' },
          { speaker: '', text: '' },
          { speaker: '', text: 'CLI 쓰기, 히스토리 backfill, MCP 클라이언트가 이제 한 그래프로 수렴.', dim: true },
        ],
        highlight: 'CLI 쓰기, 과거 히스토리, MCP 클라이언트가 이제 같은 그래프로 합쳐집니다.',
      },
    ],
    footer: '로컬 우선이라는 기본은 그대로입니다. 다른 기기까지 이어야 하면 각 기기에서 `memrosetta sync enable --server <url> --user <shared-id>`를 실행하세요. 이제 pull, backfill, 백그라운드 sync를 반복해도 더 안전합니다.',
    setup: {
      title: '먼저 로컬로 시작하고, 나중에 sync 추가:',
      command: 'npm install -g memrosetta && memrosetta init --claude-code',
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
