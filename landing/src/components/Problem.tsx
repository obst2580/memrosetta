import { Section, SectionTitle } from './Section'

const SESSION_1 = [
  { role: 'user', text: '"Our API uses Spring Boot with PostgreSQL, deployed on Azure..."' },
  { role: 'user', text: '"Let\'s go with approach B for the auth system"' },
  { role: 'user', text: '(3 hours debugging) "The fix was changing the batch size to 4"' },
]

const SESSION_2 = [
  { role: 'ai', text: '"What tech stack are we using?"' },
  { role: 'ai', text: '"What did we decide about auth?"' },
  { role: 'ai', text: '(same bug) starts from scratch' },
]

export function Problem() {
  return (
    <Section id="problem" className="border-t border-zinc-900">
      <SectionTitle subtitle="Every new session starts from zero. Decisions, preferences, hard-won debugging knowledge -- all gone.">
        The Forgetting Problem
      </SectionTitle>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Session 1 */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-medium text-emerald-400">
              SESSION 1
            </span>
            <span className="text-xs text-zinc-600">Knowledge acquired</span>
          </div>
          <div className="space-y-3">
            {SESSION_1.map((msg, i) => (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 font-mono text-xs text-zinc-600">
                  {'>'}
                </span>
                <p className="text-sm leading-relaxed text-zinc-300">
                  {msg.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Session 2 */}
        <div className="rounded-lg border border-red-500/20 bg-red-950/10 p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded bg-red-500/10 px-2 py-0.5 font-mono text-xs font-medium text-red-400">
              SESSION 2
            </span>
            <span className="text-xs text-zinc-600">All forgotten</span>
          </div>
          <div className="space-y-3">
            {SESSION_2.map((msg, i) => (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 font-mono text-xs text-red-500/60">
                  {'?'}
                </span>
                <p className="text-sm leading-relaxed text-red-400/80">
                  {msg.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Arrow + solution hint */}
      <div className="mt-10 text-center">
        <div className="mb-3 text-zinc-600">
          <svg
            className="mx-auto h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3"
            />
          </svg>
        </div>
        <p className="text-sm text-zinc-500">
          With MemRosetta, Session 2 picks up exactly where Session 1 left off.
        </p>
      </div>
    </Section>
  )
}
