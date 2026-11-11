import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './app/AppLayout'
import { RequireLogin } from './app/RequireLogin'
import { AboutPage } from './features/about/AboutPage'
import { AuthProvider } from './features/auth/AuthProvider'
import { LandingPage } from './features/landing/LandingPage'
import { LibraryPage } from './features/library/LibraryPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route
              path="library"
              element={
                <RequireLogin title="Log in to see your library">
                  <LibraryPage />
                </RequireLogin>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
