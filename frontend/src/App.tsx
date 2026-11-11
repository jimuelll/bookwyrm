import { AuthProvider } from './features/auth/AuthProvider'
import { LandingPage } from './features/landing/LandingPage'

export default function App() {
  return (
    <AuthProvider>
      <LandingPage />
    </AuthProvider>
  )
}
