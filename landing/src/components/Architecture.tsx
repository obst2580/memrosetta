import { Section, SectionTitle } from './Section'

export function Architecture() {
  return (
    <Section id="architecture" className="border-t border-zinc-100">
      <SectionTitle subtitle="Cognitive-science-inspired memory management. Not just storage -- intelligent retrieval and lifecycle.">
        Architecture
      </SectionTitle>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hybrid Search */}
        <ArchCard title="Hybrid Search">
          <DiagramBlock>
            <DiagramLine text='Query: "What CSS framework did we choose?"' color="text-zinc-700" />
            <DiagramLine text="  |" color="text-zinc-300" />
            <DiagramLine text='  +-- FTS5 BM25 --> keyword: "CSS", "framework"' color="text-emerald-600" />
            <DiagramLine text="  +-- Vector KNN --> semantic similarity" color="text-sky-600" />
            <DiagramLine text="  +-- RRF Merge --> combined ranking" color="text-amber-600" />
            <DiagramLine text="  |" color="text-zinc-300" />
            <DiagramLine text="  +-- Activation Weight --> boost frequent memories" color="text-purple-600" />
          </DiagramBlock>
          <p className="mt-3 text-xs text-zinc-500">
            Reciprocal Rank Fusion combines keyword and semantic results for better recall than either alone.
          </p>
        </ArchCard>

        {/* Memory Tiers */}
        <ArchCard title="Memory Tiers">
          <div className="space-y-3">
            <TierBlock
              tier="Hot"
              label="Working memory"
              detail="Always loaded, ~3K tokens"
              barWidth="w-full"
              barColor="bg-amber-500"
            />
            <TierBlock
              tier="Warm"
              label="Recent memory"
              detail="Last 30 days, activation decays"
              barWidth="w-2/3"
              barColor="bg-amber-400"
            />
            <TierBlock
              tier="Cold"
              label="Long-term"
              detail="Compressed, low activation"
              barWidth="w-1/3"
              barColor="bg-amber-300"
            />
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Memories flow between tiers based on ACT-R activation scores. Cold memories are compressed to save tokens.
          </p>
        </ArchCard>

        {/* ACT-R Formula */}
        <ArchCard title="ACT-R Activation">
          <div className="rounded border border-zinc-200 bg-zinc-50 p-4 text-center">
            <p className="font-mono text-sm text-zinc-700">
              A(i) = sigmoid( ln( sum( t_j ^ -0.5 ) ) + salience )
            </p>
          </div>
          <div className="mt-3 space-y-1 text-xs text-zinc-500">
            <p>
              <span className="font-mono text-zinc-600">t_j</span> = time since
              j-th access (recency + frequency)
            </p>
            <p>
              <span className="font-mono text-zinc-600">salience</span> = base
              importance of the memory
            </p>
            <p>
              Memories accessed often stay hot. Rarely used memories naturally decay -- just like human memory.
            </p>
          </div>
        </ArchCard>

        {/* Contradiction Detection */}
        <ArchCard title="Contradiction Detection">
          <DiagramBlock>
            <DiagramLine text='New: "Hourly rate is $50"' color="text-zinc-700" />
            <DiagramLine text="  |" color="text-zinc-300" />
            <DiagramLine text="  +-- NLI model (local, 71M params)" color="text-zinc-500" />
            <DiagramLine text="  |   entailment / neutral / contradiction" color="text-zinc-400" />
            <DiagramLine text="  |" color="text-zinc-300" />
            <DiagramLine text='  +-- Found: "Hourly rate is $40"' color="text-red-600" />
            <DiagramLine text='  +-- Auto-link: contradicts relation' color="text-amber-600" />
          </DiagramBlock>
          <p className="mt-3 text-xs text-zinc-500">
            Natural Language Inference runs locally. No LLM needed. Contradictions are linked, not silently ignored.
          </p>
        </ArchCard>
      </div>

      {/* Relations */}
      <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-6">
        <h3 className="mb-4 text-sm font-semibold text-zinc-700">
          Relational Versioning
        </h3>
        <div className="font-mono text-xs leading-loose text-zinc-500">
          <p>
            <span className="text-zinc-700">"Hourly rate is $50"</span>
            {'  --['}
            <span className="text-red-500">contradicts</span>
            {']-->  '}
            <span className="text-zinc-700">"Hourly rate is $40"</span>
          </p>
          <p>
            <span className="text-zinc-700">"Uses React 18"</span>
            {'  --['}
            <span className="text-amber-500">updates</span>
            {']-->  '}
            <span className="text-zinc-700">"Uses React 19"</span>
          </p>
          <p>
            <span className="text-zinc-700">"Chose PostgreSQL"</span>
            {'  --['}
            <span className="text-sky-500">derives</span>
            {']-->  '}
            <span className="text-zinc-700">"Need pgvector extension"</span>
          </p>
          <p>
            <span className="text-zinc-700">"Prefers dark mode"</span>
            {'  --['}
            <span className="text-emerald-500">supports</span>
            {']-->  '}
            <span className="text-zinc-700">"Uses Dracula theme"</span>
          </p>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          5 relation types: updates, extends, derives, contradicts, supports
        </p>
      </div>
    </Section>
  )
}

function ArchCard({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6">
      <h3 className="mb-4 font-mono text-sm font-medium text-amber-600">
        {title}
      </h3>
      {children}
    </div>
  )
}

function DiagramBlock({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-loose">
      {children}
    </div>
  )
}

function DiagramLine({
  text,
  color,
}: {
  readonly text: string
  readonly color: string
}) {
  return <p className={color}>{text}</p>
}

function TierBlock({
  tier,
  label,
  detail,
  barWidth,
  barColor,
}: {
  readonly tier: string
  readonly label: string
  readonly detail: string
  readonly barWidth: string
  readonly barColor: string
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-zinc-700">
            {tier}
          </span>
          <span className="text-xs text-zinc-500">{label}</span>
        </div>
        <span className="text-[10px] text-zinc-400">{detail}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-100">
        <div className={`h-2 rounded-full ${barColor} ${barWidth}`} />
      </div>
    </div>
  )
}
