/** Quizzes as the API sends them (backend/app/quizzes.py). */

export type QuizStatus = 'generating' | 'ready' | 'failed'
/** The types a program can mark by itself; short answers come once the server can judge them. */
export type QuestionType = 'mcq' | 'true_false' | 'fill_blank'
export type Difficulty = 'easy' | 'medium' | 'hard'

/**
 * How far a quiz being written has got. It is written in rounds: the model writes a batch of candidate
 * questions, then each is checked against its page; a later round replaces the ones that failed.
 */
export interface QuizProgress {
  stage: 'writing' | 'checking'
  /** 0 to 1 for a progress bar; never goes down, and never reaches 1 (status "ready" is the finish) */
  fraction: number
  round: number
  wanted: number
  /** Questions that have passed every check so far */
  kept: number
  /** Written this round, and how many of those have been checked */
  candidates: number
  checked: number
}

export interface Quiz {
  id: string
  document_id: string
  document_title: string
  status: QuizStatus
  /** Why it failed, written for the reader; null unless status is "failed" */
  error: string | null
  /** How many questions were asked for */
  count: number
  /** The one topic it is about; null when it covers the whole PDF */
  topic: string | null
  /** How many it has: every one passed the checks, so this can be fewer than `count` */
  question_count: number
  difficulty: Difficulty
  types: QuestionType[]
  created_at: string
  /** Only while status is "generating", once the work has begun */
  progress?: QuizProgress | null
}

/**
 * How much of a PDF a quiz would be written from (all of it, or what it says about one topic), and how
 * many questions suit that much material. From GET /documents/{id}/quiz-scope.
 */
export interface QuizScope {
  /** The topic as the server understood it; null for the whole PDF */
  topic: string | null
  /** 0: nothing in the PDF mentions the topic */
  passages: number
  page_first: number | null
  page_last: number | null
  suggested_count: number
  max_count: number
}

export interface QuizOption {
  id: string
  text: string
}

/** Only sent once the attempt has been submitted: until then the browser never holds an answer. */
export interface QuestionResult {
  /** What the reader answered: an option id, "True"/"False", or the text they typed; null if skipped */
  response: string | null
  is_correct: boolean
  answer: string
  correct_option_id: string | null
  explanation: string
  page: number
  /** The sentence(s) on that page that prove the answer */
  evidence: string
}

export interface AttemptQuestion {
  id: string
  type: QuestionType
  prompt: string
  /** Multiple choice only, in this attempt's shuffled order */
  options: QuizOption[] | null
  topic: string
  result: QuestionResult | null
}

/** One sitting of a quiz: the questions in this attempt's order, and the marks once it's submitted. */
export interface Attempt {
  id: string
  quiz_id: string
  document_id: string
  document_title: string
  total: number
  score: number | null
  finished: boolean
  questions: AttemptQuestion[]
}

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  true_false: 'True or false',
  fill_blank: 'Fill in the blank',
}

export const questions = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`
