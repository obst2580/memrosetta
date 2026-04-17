import { useState } from 'react'
import type { Lang } from './i18n'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Problem } from './components/Problem'
import { BrainScience } from './components/BrainScience'
import { ThreePaths } from './components/ThreePaths'
import { Compatibility } from './components/Compatibility'
import { QuickStart } from './components/QuickStart'
import { Footer } from './components/Footer'
import { AuthCallback } from './components/AuthCallback'

function App() {
  const [lang, setLang] = useState<Lang>('en')

  // Simple path-based routing for auth callback
  const path = window.location.pathname
  if (path === '/auth/callback') {
    return <AuthCallback />
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'oklch(0.99 0.005 85)' }}
    >
      <Header lang={lang} onLangChange={setLang} />
      <Hero lang={lang} />
      <Problem lang={lang} />
      <BrainScience lang={lang} />
      <ThreePaths lang={lang} />
      <Compatibility lang={lang} />
      <QuickStart lang={lang} />
      <Footer lang={lang} />
    </div>
  )
}

export default App
