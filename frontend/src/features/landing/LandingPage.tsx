import { usePageTitle, useShell, useStartUpload } from '../../app/shell'
import { useAuth } from '../auth/authContext'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import './landing.css'

export function LandingPage() {
  const { theme, setHeroCtaVisible } = useShell()
  const { user } = useAuth()
  const startUpload = useStartUpload()
  usePageTitle('Quizzes from your PDFs')

  // Logged out, the hero's button is "Get started": it opens the modal on sign-up, then continues on.
  const onCta = () =>
    user ? startUpload() : startUpload({ mode: 'signup', reason: 'Create an account to turn your PDFs into quizzes.' })

  return (
    <main>
      <Hero theme={theme} loggedIn={!!user} onCtaVisibleChange={setHeroCtaVisible} onCta={onCta} />
      <HowItWorks />
    </main>
  )
}
