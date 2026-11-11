import { useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../auth/authContext'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { TopBar } from './TopBar'
import './landing.css'

export function LandingPage() {
  const { theme, toggle } = useTheme()
  const { requireAuth } = useAuth()
  // The hero's Upload button starts on screen; the bar's copy stays hidden until it scrolls away.
  const [heroCtaVisible, setHeroCtaVisible] = useState(true)

  // Uploading needs an account (PRD 7.10): logged out, this opens the login modal first.
  const startUpload = () =>
    requireAuth(() => {
      // TODO(upload): open the upload + quiz configuration flow once it exists.
    }, 'You need an account to upload a PDF.')

  return (
    <>
      <TopBar theme={theme} onToggleTheme={toggle} showCta={!heroCtaVisible} onUpload={startUpload} />
      <main>
        <Hero theme={theme} onCtaVisibleChange={setHeroCtaVisible} onUpload={startUpload} />
        <HowItWorks />
      </main>
    </>
  )
}
