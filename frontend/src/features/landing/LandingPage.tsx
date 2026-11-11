import { Navigate } from 'react-router'
import { usePageTitle, useShell, useStartUpload } from '../../app/shell'
import { useAuth } from '../auth/authContext'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import './landing.css'

export function LandingPage() {
  const { theme } = useShell()
  const { user } = useAuth()
  const startUpload = useStartUpload()
  usePageTitle('Quizzes from your PDFs')

  // The landing page is for visitors; a logged-in reader's home is their Library.
  if (user) return <Navigate to="/library" replace />

  // "Get started" opens the modal on sign-up, then continues to the Library.
  const getStarted = () =>
    startUpload({ mode: 'signup', reason: 'Create an account to turn your PDFs into quizzes.' })

  return (
    <main>
      <Hero theme={theme} onCta={getStarted} />
      <HowItWorks />
    </main>
  )
}
