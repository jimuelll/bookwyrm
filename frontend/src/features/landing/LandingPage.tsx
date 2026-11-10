import { useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { TopBar } from './TopBar'
import './landing.css'

export function LandingPage() {
  const { theme, toggle } = useTheme()
  // The hero's Upload button starts on screen; the bar's copy stays hidden until it scrolls away.
  const [heroCtaVisible, setHeroCtaVisible] = useState(true)
  return (
    <>
      <TopBar theme={theme} onToggleTheme={toggle} showCta={!heroCtaVisible} />
      <main>
        <Hero theme={theme} onCtaVisibleChange={setHeroCtaVisible} />
        <HowItWorks />
      </main>
    </>
  )
}
