import { useState } from 'react'
import { Section, SectionTitle } from './Section'
import { CodeBlock } from './CodeBlock'

type Tab = 'claude-code' | 'cursor' | 'cli'

const TAB_CONFIG: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor / MCP' },
  { id: 'cli', label: 'CLI' },
]

const CODE_SNIPPETS: Record<Tab, { code: string; language: string }> = {
  'claude-code': {
    language: 'bash',
    code: `# One command sets up everything
npx @memrosetta/claude-code init

# That's it. Restart Claude Code.
# Claude will automatically:
#   - Store memories during sessions (via MCP)
#   - Search past memories when needed (via MCP)
#   - Extract facts on session end (via Stop Hook)

# Check status
npx @memrosetta/claude-code status

# Remove integration
npx @memrosetta/claude-code reset`,
  },
  cursor: {
    language: 'json',
    code: `// Add to .mcp.json (project root or ~/.mcp.json)
{
  "mcpServers": {
    "memory-service": {
      "command": "npx",
      "args": ["-y", "@memrosetta/mcp"]
    }
  }
}

// Available MCP tools:
//   memrosetta_search  -- search past memories
//   memrosetta_store   -- save a memory
//   memrosetta_working_memory -- get top context
//   memrosetta_relate  -- link related memories
//   memrosetta_invalidate -- mark outdated`,
  },
  cli: {
    language: 'bash',
    code: `# Install globally
npm install -g @memrosetta/cli

# Store memories
memrosetta store --user alice \\
  --content "Prefers TypeScript over JavaScript" \\
  --type preference

# Search
memrosetta search --user alice \\
  --query "tech stack choices" \\
  --format text
# [0.95] Decided to use Tailwind CSS (decision)
# [0.88] Prefers TypeScript over JavaScript (preference)

# Working memory (top-priority context)
memrosetta working-memory --user alice

# Run maintenance (recompute activation scores)
memrosetta maintain --user alice`,
  },
}

export function QuickStart() {
  const [activeTab, setActiveTab] = useState<Tab>('claude-code')
  const snippet = CODE_SNIPPETS[activeTab]

  return (
    <Section id="quick-start" className="border-t border-zinc-100">
      <SectionTitle subtitle="Get started in under a minute.">
        Quick Start
      </SectionTitle>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-md px-4 py-2 font-mono text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-white text-amber-600 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Code block */}
      <CodeBlock code={snippet.code} language={snippet.language} />

      {/* Packages */}
      <div className="mt-10">
        <h3 className="mb-4 text-center text-sm font-medium text-zinc-400">
          Packages
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PACKAGES.map((pkg) => (
            <a
              key={pkg.name}
              href={`https://www.npmjs.com/package/${pkg.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-200 bg-white p-3 text-left transition-colors hover:border-amber-300 hover:shadow-sm"
            >
              <p className="font-mono text-xs text-amber-600">{pkg.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{pkg.description}</p>
            </a>
          ))}
        </div>
      </div>
    </Section>
  )
}

const PACKAGES = [
  { name: '@memrosetta/core', description: 'Memory engine (SQLite + FTS5 + vector + NLI)' },
  { name: '@memrosetta/embeddings', description: 'Local embeddings + NLI contradiction' },
  { name: '@memrosetta/mcp', description: 'MCP server for AI tool integration' },
  { name: '@memrosetta/claude-code', description: 'Claude Code integration (hooks + init)' },
  { name: '@memrosetta/cli', description: 'Command-line interface' },
  { name: '@memrosetta/api', description: 'REST API (Hono)' },
  { name: '@memrosetta/llm', description: 'LLM fact extraction (optional)' },
  { name: '@memrosetta/obsidian', description: 'Obsidian vault sync' },
]
