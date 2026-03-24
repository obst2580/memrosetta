const GITHUB_URL = 'https://github.com/obst2580/memrosetta'
const NPM_URL = 'https://www.npmjs.com/org/memrosetta'

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 px-6 py-12 md:px-12 lg:px-24">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center gap-6 text-center">
          {/* Logo */}
          <h2 className="text-xl font-bold text-zinc-700">
            Mem<span className="text-amber-500">Rosetta</span>
          </h2>

          <p className="max-w-md text-sm text-zinc-500">
            Persistent, searchable long-term memory for AI tools.
            Local-first. No LLM required. Open source.
          </p>

          {/* Links */}
          <div className="flex gap-6 text-sm">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 transition-colors hover:text-amber-500"
            >
              GitHub
            </a>
            <a
              href={NPM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 transition-colors hover:text-amber-500"
            >
              npm
            </a>
            <a
              href={`${GITHUB_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 transition-colors hover:text-amber-500"
            >
              MIT License
            </a>
          </div>

          {/* Bottom */}
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Memory + Rosetta: unlocking AI memory, one fact at a time.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
