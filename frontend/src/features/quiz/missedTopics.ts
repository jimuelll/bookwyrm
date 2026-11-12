import type { AttemptQuestion } from '../../app/quizzes'

/** A topic the reader missed questions on, and the pages those questions came from. */
export interface MissedTopic {
  topic: string
  pages: number[]
}

/**
 * The topics of the questions that were answered wrong or skipped, in the order they first appear. Two
 * wrong answers on the same topic are one thing to study, not two. Questions are matched by their topic
 * label, which the question writer chose; labels are compared ignoring case so "ATP" and "atp" merge.
 */
export function missedTopics(questions: AttemptQuestion[]): MissedTopic[] {
  const byTopic = new Map<string, MissedTopic>()
  for (const q of questions) {
    if (!q.result || q.result.is_correct) continue
    const key = q.topic.trim().toLowerCase()
    const entry = byTopic.get(key) ?? { topic: q.topic.trim(), pages: [] }
    if (!entry.pages.includes(q.result.page)) entry.pages.push(q.result.page)
    byTopic.set(key, entry)
  }
  return [...byTopic.values()].map((t) => ({ ...t, pages: [...t.pages].sort((a, b) => a - b) }))
}
