# Product Requirements Document

**Working name:** Bookwyrm *(placeholder: swap in the final name)*
**Status:** Draft v0.1
**Owner:** Jimuel
**Last updated:** 2026-11-11

---

## 1. Overview

A web app that turns educational PDFs into quizzes. The user uploads a document, the system indexes it with retrieval-augmented generation (RAG), and an LLM generates questions grounded in the source text. Every question cites the page it came from and is checked by a verification pass before the user sees it. Results feed into per-topic progress tracking and spaced repetition.

**One-line pitch:** AI quizzes you can verify: every question cites its source page.

## 2. Problem Statement

- Students study from long PDFs (textbooks, lecture notes, modules) but have no fast way to test themselves on them.
- Asking a general chatbot for a quiz gives no guarantee the questions come from the actual material, and answers can be hallucinated.
- Manually writing practice questions is slow.

## 3. Goals

1. Generate accurate quizzes from any text-based educational PDF.
2. Make every question verifiable via a citation to the source page/passage.
3. Help users find and fix weak areas over time.
4. Be a portfolio-quality project demonstrating RAG, structured LLM output, and evaluation.

## 4. Non-Goals (v1)

- Multi-user classrooms, teacher dashboards, or grading workflows.
- Mobile native apps.
- Real-time collaboration.
- Training or fine-tuning custom models.
- Perfect OCR for poor-quality scans (optional stretch).

## 5. Target Users

| User | Need |
|---|---|
| Students | Self-test on lecture notes, modules and textbooks |
| Self-learners | Check understanding of PDFs and papers |
| (Stretch) Teachers | Quickly draft practice questions from material |

## 6. User Stories

- As a student, I upload a PDF so I can be quizzed on it.
- As a student, I choose a topic, page range, difficulty and question count so the quiz fits what I'm studying.
- As a student, I see the source page for each question so I can verify it and review the material.
- As a student, I get my score and see which topics I missed.
- As a student, I get follow-up quizzes on my weak topics.
- As a student, I can ask questions about the PDF when I don't understand an answer.
- As a student, I can export questions as flashcards.

## 7. Functional Requirements

### 7.1 Document ingestion (P0)
- Upload PDF (size limit configurable, e.g. 25 MB).
- Extract text per page; preserve page numbers and headings where possible.
- Chunk by heading/section, ~500-800 tokens with small overlap.
- Generate embeddings and store with chunk text and page reference.
- Show processing progress; run ingestion as a background job.
- Handle failures (empty text, corrupted file, unsupported scans) with clear messages.

### 7.2 Quiz generation (P0)
- Inputs: document, optional topic/page range, difficulty, question count, question types.
- Retrieve relevant chunks via vector similarity search.
- Prompt the LLM to return questions as JSON.
- Validate output against a Pydantic schema; retry on malformed output.
- Question types: multiple choice, true/false, fill-in-the-blank, short answer.
- Each question stores its source chunk ID and page number.

### 7.3 Verification pass (P0)
- A second LLM call checks each question: answerable from the cited source, one clearly correct answer, not ambiguous.
- Reject or regenerate failing questions.
- De-duplicate near-identical questions.

### 7.4 Taking a quiz (P0)
- One-question-at-a-time or full-page view.
- Auto-grade objective questions.
- AI-grade short answers against the source text, with a short explanation.
- Results page: score, correct answers, explanations, and source citations.

### 7.5 Source citations (P0)
- Each question and explanation shows the source page.
- Click a citation to view the source passage (stretch: PDF viewer jumps to the page).

### 7.6 Progress tracking (P1)
- Store attempts and per-question results.
- Tag questions by topic/section.
- Show weak topics and score history.
- "Quiz me on what I missed" generates a targeted follow-up quiz.

### 7.7 Spaced repetition (P2)
- Schedule missed questions for review using an SM-2-style algorithm.
- Daily review queue.

### 7.8 Chat with the PDF (P2)
- RAG Q&A over the document with cited answers.
- "Explain this answer" shortcut from the results page.

### 7.9 Export (P2)
- Anki-compatible CSV for flashcards.
- Quiz as PDF.

### 7.10 Accounts (P1)
- Sign up / log in (email + password or OAuth).
- Documents, quizzes and attempts are private to the user.

### 7.11 *New features*
> Add new feature ideas here. Include: description, user story, priority (P0-P2), acceptance criteria.

- [ ] _TBD_

## 8. Non-Functional Requirements

- **Accuracy:** target ≥ 90% of generated questions judged correct and answerable from the source (measured in the evaluation, see section 11).
- **Performance:** quiz of 10 questions generated in under ~20 seconds for an already-indexed document; ingestion of a 100-page PDF in under ~2 minutes.
- **Reliability:** failed LLM calls retried with backoff; jobs are resumable.
- **Security:** auth on all user data, file type and size validation, rate limiting on LLM endpoints, API keys only on the server.
- **Cost control:** cap tokens per request, cache embeddings, avoid re-embedding unchanged documents.
- **Privacy:** uploaded documents are only accessible to their owner; support document deletion.

## 9. Technical Approach

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the stack, pipelines, data model, API surface, security, evaluation harness and deployment.

## 10. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Hallucinated or wrong questions | Grounded retrieval, citations, verification pass, evaluation |
| Malformed LLM output | Schema validation + retries |
| Poor chunking splits concepts | Heading-aware chunking, overlap, tune and document sizes |
| Duplicate questions | Embedding-based de-duplication |
| Large PDFs are slow | Background jobs, progress UI, batching |
| LLM cost and rate limits | Free-tier providers, caching, request caps, backoff |
| Scanned PDFs have no text | Detect and warn; optional OCR |

## 11. Success Metrics / Evaluation

- **Question accuracy:** run on 3+ different PDFs, 50 questions each; manually label correct / answerable. Report the percentage and compare before and after the verification pass.
- **Citation accuracy:** percentage of questions whose cited page actually contains the answer.
- **Latency:** median time to generate a 10-question quiz.
- **Usability (stretch):** a few real users take quizzes and rate usefulness.

Publish results in the README.

## 12. Milestones

| # | Milestone | Scope |
|---|---|---|
| M1 | CLI proof of concept | PDF in, 5 validated questions out |
| M2 | Pipeline | Chunking, embeddings, pgvector, citations, verification pass |
| M3 | API + UI | Upload, generate, take quiz, results |
| M4 | Progress | Accounts, attempts, weak topics, follow-up quizzes |
| M5 | Extras | Chat, spaced repetition, exports |
| M6 | Ship | Deploy, README, demo GIF, architecture diagram, evaluation write-up |

## 13. Portfolio Highlights

- RAG with pgvector (embeddings, similarity search)
- Structured LLM output with schema validation and retries
- LLM-as-judge verification
- Measured evaluation with published numbers
- Background job processing
- Citation-first UX

## 14. Open Questions

- Final product name?
- Which LLM provider is the default (Gemini vs Groq)?
- Add a reranker in v1, or only after measuring baseline retrieval quality?
- Local embeddings or hosted?
- Hosted or self-hosted deployment?
- Support non-English PDFs (e.g. Filipino) in v1?
- Auth method: email/password only, or OAuth too?
