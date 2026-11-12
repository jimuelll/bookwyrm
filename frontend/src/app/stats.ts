/** What a reader's quizzes say about one PDF, as GET /documents/{id}/stats sends it (backend/app/stats.py). */

/**
 * weak: under 60% right · learning: 60–79% · strong: 80% or more · unrated: too few answers to say.
 * Only each quiz's first attempt counts, so retaking a quiz never changes these.
 */
export type TopicLevel = 'weak' | 'learning' | 'strong' | 'unrated'

export interface TopicStat {
  topic: string
  right: number
  total: number
  /** right ÷ total, rounded */
  percent: number
  /** Every page a question on this topic came from */
  pages: number[]
  level: TopicLevel
}

/** One quiz's first attempt, for the scores-over-time line */
export interface Sitting {
  quiz_id: string
  finished_at: string
  score: number
  total: number
  percent: number
}

export interface DocumentStats {
  document_id: string
  document_title: string
  /** How many quizzes' first attempts are counted */
  quizzes_taken: number
  /** 0 to 1: the share of those that reached the pass mark (70%); null until one has been taken */
  passing_rate: number | null
  weak: TopicStat[]
  learning: TopicStat[]
  strong: TopicStat[]
  unrated: TopicStat[]
  /** Oldest first */
  history: Sitting[]
}

/** The pass mark the server uses for `passing_rate` (backend/app/stats.py PASS_MARK) */
export const PASS_PERCENT = 70
