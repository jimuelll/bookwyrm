import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, useApi } from '../../app/api'
import type { Quiz } from '../../app/quizzes'

/**
 * Start a short quiz on one topic of a PDF, then go and watch it being written. Used wherever the app
 * points at a weak spot ("what to study" after a quiz, the progress page).
 *
 * No `count` is sent: the server picks a number that suits how much the PDF says about the topic, so a
 * topic with little material never fails for being asked too much of.
 */
export function useTopicQuiz(documentId: string) {
  const api = useApi()
  const navigate = useNavigate()
  const [starting, setStarting] = useState<string | null>(null) // the topic being started
  const [problem, setProblem] = useState<string | null>(null)

  async function start(topic: string) {
    setStarting(topic)
    setProblem(null)
    try {
      const body = { topic, difficulty: 'medium', types: ['mcq'] }
      const quiz = await api<Quiz>(`/documents/${documentId}/quizzes`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      navigate(`/quizzes/${quiz.id}`)
    } catch (err) {
      setStarting(null)
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  return { start, starting, problem }
}
