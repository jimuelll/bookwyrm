import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './app/AppLayout'
import { RequireLogin } from './app/RequireLogin'
import { AboutPage } from './features/about/AboutPage'
import type { AuthBackend } from './features/auth/authBackend'
import { AuthCallbackPage } from './features/auth/AuthCallbackPage'
import { AuthProvider } from './features/auth/AuthProvider'
import { LandingPage } from './features/landing/LandingPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { LibraryPage } from './features/library/LibraryPage'
import { AttemptPage } from './features/quiz/AttemptPage'
import { QuizPage } from './features/quiz/QuizPage'
import { QuizSetupPage } from './features/quiz/QuizSetupPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StatsPage } from './features/stats/StatsPage'

/** `authBackend` defaults to Supabase; tests pass an in-memory fake. */
export default function App({ authBackend }: { authBackend?: AuthBackend }) {
  return (
    <BrowserRouter>
      <AuthProvider backend={authBackend}>
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
            {/* the quiz loop: ask for one from a book, wait for it and begin, answer it and see the marks */}
            <Route
              path="library/:documentId/quiz"
              element={
                <RequireLogin title="Log in to write a quiz">
                  <QuizSetupPage />
                </RequireLogin>
              }
            />
            <Route
              path="library/:documentId/stats"
              element={
                <RequireLogin title="Log in to see your progress">
                  <StatsPage />
                </RequireLogin>
              }
            />
            <Route
              path="quizzes/:quizId"
              element={
                <RequireLogin title="Log in to take this quiz">
                  <QuizPage />
                </RequireLogin>
              }
            />
            <Route
              path="attempts/:attemptId"
              element={
                <RequireLogin title="Log in to take this quiz">
                  <AttemptPage />
                </RequireLogin>
              }
            />
            <Route
              path="settings"
              element={
                <RequireLogin title="Log in to see your settings">
                  <SettingsPage />
                </RequireLogin>
              }
            />
            <Route path="auth/callback" element={<AuthCallbackPage />} />
            <Route path="auth/reset" element={<ResetPasswordPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
