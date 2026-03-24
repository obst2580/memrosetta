import { Hero } from './components/Hero'
import { Problem } from './components/Problem'
import { HowItWorks } from './components/HowItWorks'
import { NotAnotherRag } from './components/NotAnotherRag'
import { Architecture } from './components/Architecture'
import { Comparison } from './components/Comparison'
import { QuickStart } from './components/QuickStart'
import { Footer } from './components/Footer'

function App() {
  return (
    <div className="min-h-screen">
      <Hero />
      <Problem />
      <HowItWorks />
      <NotAnotherRag />
      <Architecture />
      <Comparison />
      <QuickStart />
      <Footer />
    </div>
  )
}

export default App
