import type { Lang } from '../i18n'
import { content } from '../i18n'

const GITHUB_URL = 'https://github.com/obst2580/memrosetta'
const NPM_URL = 'https://www.npmjs.com/org/memrosetta'

interface FooterProps {
  readonly lang: Lang
}

export function Footer({ lang }: FooterProps) {
  const t = content[lang].footer

  return (
    <footer className="border-t border-zinc-100 px-6 py-12 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <h2 className="mb-2 font-mono text-sm font-semibold text-zinc-800">
              Mem<span className="text-amber-600">Rosetta</span>
            </h2>
            <p className="text-sm leading-relaxed text-zinc-400">
              {t.tagline}
            </p>
          </div>

          <div className="flex gap-6 text-sm">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 transition-colors hover:text-zinc-700"
            >
              GitHub
            </a>
            <a
              href={NPM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 transition-colors hover:text-zinc-700"
            >
              npm
            </a>
            <a
              href={`${GITHUB_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 transition-colors hover:text-zinc-700"
            >
              MIT License
            </a>
          </div>
        </div>

        <div className="mt-8 border-t border-zinc-100 pt-6">
          <p className="text-xs text-zinc-400">
            {t.motto}
          </p>
        </div>
      </div>
    </footer>
  )
}
