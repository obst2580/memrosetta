import type { Lang } from '../i18n'
import { Section, SectionTitle } from './Section'

interface DemoProps {
  readonly lang: Lang
}

const TITLES = {
  en: {
    title: 'See It In Action',
    subtitle: 'Store memories in one session. Search from another. Any AI tool.',
  },
  ko: {
    title: '동작 확인',
    subtitle: '한 세션에서 기억을 저장. 다른 세션에서 검색. 어떤 AI 도구에서든.',
  },
} as const

export function Demo({ lang }: DemoProps) {
  const t = TITLES[lang]

  return (
    <Section id="demo" className="border-t border-zinc-100">
      <SectionTitle subtitle={t.subtitle}>
        {t.title}
      </SectionTitle>

      <div className="overflow-hidden rounded-lg border border-zinc-200 shadow-lg">
        <img
          src="/demo.svg"
          alt="MemRosetta CLI demo: store, search, and share memories across sessions"
          className="w-full"
          loading="lazy"
        />
      </div>
    </Section>
  )
}
