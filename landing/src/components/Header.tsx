import type { Lang } from '../i18n'
import { content } from '../i18n'

const GITHUB_URL = 'https://github.com/obst2580/memrosetta'

interface HeaderProps {
  readonly lang: Lang
  readonly onLangChange: (lang: Lang) => void
}

export function Header({ lang, onLangChange }: HeaderProps) {
  const t = content[lang].nav

  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-b border-zinc-100 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <a href="#" className="font-mono text-sm font-semibold text-zinc-800">
          Mem<span className="text-amber-600">Rosetta</span>
        </a>

        <div className="flex items-center gap-4">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-800"
          >
            {t.github}
          </a>

          <div className="h-4 w-px bg-zinc-200" />

          <button
            onClick={() => onLangChange(lang === 'en' ? 'ko' : 'en')}
            className="rounded-md border border-zinc-200 px-2.5 py-1 font-mono text-xs text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700"
            aria-label="Switch language"
          >
            {lang === 'en' ? 'KO' : 'EN'}
          </button>
        </div>
      </div>
    </header>
  )
}
