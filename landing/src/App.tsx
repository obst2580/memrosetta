import { useState } from 'react'
import type { Lang } from './i18n'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Problem } from './components/Problem'
import { QuickStart } from './components/QuickStart'
import { Compatibility } from './components/Compatibility'
import { HowItWorks } from './components/HowItWorks'
import { NotAnotherRag } from './components/NotAnotherRag'
import { Features } from './components/Features'
import { Architecture } from './components/Architecture'
import { Comparison } from './components/Comparison'
import { Footer } from './components/Footer'

function App() {
  const [lang, setLang] = useState<Lang>('en')

  return (
    <div className="min-h-screen bg-white">
      <Header lang={lang} onLangChange={setLang} />
      <Hero lang={lang} />
      <Problem lang={lang} />
      <QuickStart lang={lang} />
      <Compatibility lang={lang} />
      <HowItWorks lang={lang} />
      <NotAnotherRag lang={lang} />
      <Features lang={lang} />
      <Architecture lang={lang} />
      <Comparison lang={lang} />
      <Footer lang={lang} />
    </div>
  )
}

export default App
