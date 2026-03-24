import { Section, SectionTitle } from './Section'

const LAYERS = [
  {
    number: '1',
    title: 'Claude stores directly during session',
    description:
      'Claude Code acts as both the LLM and the memory author. When it encounters an important fact, decision, or preference, it stores it via MCP in real time.',
    quality: 'Best quality',
    cost: '$0',
    qualityColor: 'text-emerald-400',
    costColor: 'text-emerald-400',
  },
  {
    number: '2',
    title: 'Stop Hook + LLM extraction on session end',
    description:
      'When a session ends, the Stop Hook sends the transcript to an LLM for fact extraction. Catches anything Claude missed during the session.',
    quality: 'Good',
    cost: 'Needs API key',
    qualityColor: 'text-amber-400',
    costColor: 'text-amber-400',
  },
  {
    number: '3',
    title: 'Stop Hook + rule-based fallback',
    description:
      'No API key? No problem. Pattern matching extracts decisions, preferences, and facts from the transcript. Zero external dependencies.',
    quality: 'Basic',
    cost: '$0',
    qualityColor: 'text-zinc-400',
    costColor: 'text-emerald-400',
  },
]

export function HowItWorks() {
  return (
    <Section id="how-it-works" className="border-t border-zinc-900">
      <SectionTitle subtitle="Three layers of memory capture, in priority order. Every session contributes to your AI's long-term knowledge.">
        How It Works
      </SectionTitle>

      {/* Pipeline diagram */}
      <div className="relative space-y-4">
        {LAYERS.map((layer, i) => (
          <div key={i} className="relative">
            {/* Connector line */}
            {i < LAYERS.length - 1 && (
              <div className="absolute left-[27px] top-full z-0 h-4 w-px bg-zinc-800" />
            )}

            <div className="relative flex gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700">
              {/* Number */}
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 font-mono text-sm font-semibold text-amber-400">
                {layer.number}
              </div>

              {/* Content */}
              <div className="flex-1 text-left">
                <h3 className="mb-1 text-base font-semibold text-zinc-200">
                  {layer.title}
                </h3>
                <p className="mb-3 text-sm leading-relaxed text-zinc-500">
                  {layer.description}
                </p>
                <div className="flex gap-4 text-xs">
                  <span>
                    Quality:{' '}
                    <span className={`font-medium ${layer.qualityColor}`}>
                      {layer.quality}
                    </span>
                  </span>
                  <span>
                    Cost:{' '}
                    <span className={`font-medium ${layer.costColor}`}>
                      {layer.cost}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Flow summary */}
      <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <p className="font-mono text-xs leading-relaxed text-zinc-500">
          <span className="text-zinc-400">Session active</span>
          {'  ->  '}
          <span className="text-amber-400">Claude stores via MCP</span>
          {'  ->  '}
          <span className="text-zinc-400">Session ends</span>
          {'  ->  '}
          <span className="text-amber-400">Stop Hook extracts remaining</span>
          {'  ->  '}
          <span className="text-zinc-400">~/.memrosetta/memories.db</span>
        </p>
      </div>
    </Section>
  )
}
