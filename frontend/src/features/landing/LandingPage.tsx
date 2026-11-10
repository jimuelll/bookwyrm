import { useTheme } from '../../hooks/useTheme'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { TopBar } from './TopBar'
import './landing.css'

export function LandingPage() {
  const { theme, toggle } = useTheme()
  return (
    <>
      <TopBar theme={theme} onToggleTheme={toggle} />
      <main>
        <Hero theme={theme} />
        <HowItWorks />
      </main>
    </>
  )
}
