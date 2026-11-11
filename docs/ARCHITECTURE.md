# Architecture

**Project:** Bookwyrm *(working name)*
**Status:** Draft v0.1
**Related:** [PRD.md](./PRD.md)

This document describes how the system is built and why. The PRD describes what it does.

---

## 1. Design Principles

1. **Grounded over fluent.** Every generated question must trace to a source passage. If it can't be traced, it doesn't ship.
2. **Validate everything the LLM returns.** Treat the model as an unreliable external service: schema-check, retry, and verify.
3. **Measure, don't guess.** Chunk size, retrieval method and model choice are decided by the evaluation, not by feel.
4. **Boring infrastructure.** One database, one backend service, one frontend. Add components only when a measured problem requires them.
5. **Swappable providers.** LLM and embedding vendors sit behind interfaces so models can be compared and replaced.

## 2. System Overview

```
┌──────────────┐  log in / sign up    ┌───────────────────────────┐
│   React SPA  │ ───────────────────► │ Supabase Auth             │
│ (Vite, TS)   │ ◄── access token ─── │ email+password · Google   │
│              │                      └───────────────────────────┘
│              │   HTTPS + Bearer     ┌───────────────────────────┐
│              │ ───────────────────► │      FastAPI (API)        │
│              │ ◄─────────────────── │ token check · routes      │
└──────────────┘     JSON / SSE       └─────────────┬─────────────┘
                                                    │
                     ┌──────────────────────────────┼──────────────────────────┐
                     │                              │                          │
              ┌──────▼──────┐              ┌────────▼────────┐        ┌────────▼────────┐
              │ Ingestion   │              │ Quiz generation │        │  Chat / Q&A     │
              │ worker      │              │ service         │        │  service        │
              └──────┬──────┘              └────────┬────────┘        └────────┬────────┘
                     │                              │                          │
                     └───────────────┬──────────────┴──────────────────────────┘
                                     │
                     ┌───────────────▼────────────────┐        ┌──────────────────────┐
                     │ Supabase Postgres + pgvector   │        │ LLM / Embedding      │
                     │ users · docs · chunks · quizzes│        │ providers (Gemini,   │
                     │ attempts · review schedule     │        │ Groq, local)         │
                     └───────────────┬────────────────┘        └──────────────────────┘
                                     │
                              ┌──────▼──────┐
                              │ Supabase    │  (original PDFs,
                              │ Storage     │   private bucket)
                              └─────────────┘
```

**Deployment shape:** a single FastAPI app (API + background workers in the same codebase) and one **Supabase** project providing Auth, Postgres (with pgvector) and Storage. The frontend is a static build served by a CDN.

**Who does what in auth:** the browser talks to Supabase Auth directly to sign up, log in, confirm email and reset passwords, and gets a short-lived **access token** (a JWT signed by Supabase). It sends that token to our API as `Authorization: Bearer ...`. The API never sees passwords; it only checks the token's signature (with the project's public keys), expiry, issuer and audience, and takes the user id from its `sub` claim.

## 3. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React, TypeScript, Vite, React Router, TanStack Query, Tailwind | Fast iteration; React Router for pages; server state handled by TanStack Query |
| Backend | Python 3.12, FastAPI, Pydantic v2 | Strongest AI/PDF ecosystem; typed schemas double as validation |
| Database | Supabase Postgres + pgvector | One store for relational data and vectors; supports hybrid search; managed, with a free tier |
| PDF parsing | PyMuPDF (Docling/Unstructured if layout or tables need it) | Fast, page-accurate extraction |
| LLM / embeddings | Gemini (primary) and Groq (fallback) behind a provider interface, called over REST with httpx | Free tiers; swappable for comparison; no vendor SDKs to keep in step |
| Structured output | Instructor / provider-native structured output + Pydantic | Fewer hand-rolled retries |
| Jobs | FastAPI background tasks → Postgres-backed queue → ARQ/Celery + Redis only if needed | Start simple, upgrade on evidence |
| Migrations | Alembic (`backend/migrations/`), run with `uv run alembic upgrade head` | Standard with SQLAlchemy; the same files build every database (Supabase, CI) |
| ORM / DB access | SQLAlchemy 2.x (async) + pgvector adapter | |
| Auth | Supabase Auth: email + password (with email confirmation and password reset) and Google OAuth, PKCE flow; FastAPI checks its JWTs with PyJWT | No password storage or OAuth plumbing of our own; login gates every feature (PRD 7.10) |
| File storage | Supabase Storage, private bucket | Same project and permissions model as the database |
| Evaluation | Custom harness + Ragas where useful | |
| Tooling | uv or Poetry, Ruff, mypy, pytest; ESLint, Vitest on the frontend | |

## 4. Core Pipelines

### 4.1 Ingestion

```
Upload → validate → store file → create document (status=queued)
      → extract text per page → detect structure (headings)
      → chunk → embed (batched) → insert chunks → status=ready
```

**Steps**
1. **Validate:** MIME type and magic bytes, size limit, page-count limit, reject encrypted PDFs.
2. **Extract:** per-page text with page numbers. If a page yields almost no text, flag it as likely scanned. Warn the user, or route to OCR if enabled.
3. **Structure:** use font size/weight or the PDF outline (bookmarks) to infer headings. Attach a `heading_path` (for example `Chapter 3 > Photosynthesis > Light reactions`) to each chunk.
4. **Chunk:** split within sections, target 500-800 tokens, 10-15% overlap, never split mid-sentence. Keep tables and lists intact where possible. Chunk parameters live in config so the evaluation can vary them.
5. **Embed:** batch requests, retry with backoff, and store the model name and dimension on each chunk so re-embedding is possible when the model changes.
6. **Index:** insert into `chunks`; create the vector index (HNSW) and the full-text index.

**Status machine:** `queued → extracting → chunking → embedding → ready | failed`. Each transition is persisted so the UI can show progress and a failed job can resume from the last good step.

**Idempotency:** a content hash (SHA-256) of the file lets the system detect re-uploads and skip re-embedding.

### 4.2 Retrieval

**Hybrid search** combines two signals:
- **Vector similarity** (cosine) over chunk embeddings for meaning.
- **Full-text search** (`tsvector`) for exact terms, names and formulas that embeddings can blur.

Results are merged with **Reciprocal Rank Fusion (RRF)**. An optional **reranker** (cross-encoder) reorders the top N candidates. Each of these is a switch in config, so the evaluation can measure what it buys.

**Filters:** `document_id`, `page` range, and `heading_path` prefix. A user choosing "pages 40-60" or "Chapter 3" narrows retrieval before ranking.

**Whole-document coverage:** for "quiz me on the whole document," similarity search around a query is the wrong tool. Instead, sample chunks across the document (cluster the embeddings or stratify by section) so questions cover the material evenly.

### 4.3 Quiz Generation

```
config (topic, pages, difficulty, count, types)
   → select chunks (retrieval or stratified sampling)
   → generate candidates (over-generate ~1.5x)
   → validate schema → check citation exists
   → verify (LLM-as-judge) → de-duplicate
   → pick final N → persist quiz (the set is fixed from here on)
```

**Generation prompt rules**
- Provide only the selected chunks as context, each tagged with an ID and page.
- Require every question to return `source_chunk_id` and a short `evidence` quote from that chunk.
- Forbid using outside knowledge.
- Return JSON matching the schema; no prose.

**Question schema (Pydantic, abbreviated)**

```python
class Question(BaseModel):
    type: Literal["mcq", "true_false", "fill_blank", "short_answer"]
    prompt: str
    options: list[str] | None      # mcq only
    answer: str
    explanation: str
    topic: str
    difficulty: Literal["easy", "medium", "hard"]
    source_chunk_id: UUID
    evidence: str                  # verbatim span from the source chunk
```

**Programmatic checks (cheap, run first)**
- Schema valid; option count and uniqueness correct for MCQ.
- `source_chunk_id` is one of the provided chunks.
- `evidence` actually appears in that chunk's text (fuzzy-match tolerance). This catches fabricated citations without another LLM call.

**Verification pass (LLM-as-judge)**
A separate call receives the question, the answer and only the cited chunk, and returns: `answerable_from_source`, `single_correct_answer`, `ambiguous`, plus a reason. Failing questions are dropped and replaced from the over-generated pool.

**De-duplication**
Embed each question prompt and drop any whose cosine similarity to an already-accepted question exceeds a threshold.

**Short-answer grading**
At attempt time, a grading call compares the user's answer to the reference answer and the cited chunk, returns correct / partial / incorrect and a one-line explanation. Objective types are graded deterministically.

### 4.4 Modes, Sharing and Expiry

- **Mode** is stored on the quiz (`review` | `quiz`). Starting an attempt on a `quiz`-mode quiz fails with `409 Conflict` if the user already has one; a unique index on `(quiz_id, user_id)` for quiz-mode attempts enforces it in the database too.
- **Fixed set, shuffled per attempt:** questions are stored once per quiz. Starting an attempt stores a random `question_order` and per-question `option_order` on the attempt, so a retake (or another taker) sees a new order. Grading maps the shown order back to the stored answer, so answers are compared by option ID, never by position.
- **Share link:** `/s/{share_token}` where the token is 128+ bits of randomness (not the quiz ID), so links can't be guessed. Resolving a token requires an authenticated user and a quiz with `expires_at > now()`; otherwise `401` (log in) or `410 Gone` (expired).
- **Expiry:** `expires_at = created_at + lifetime`, lifetime capped at 7 days by the API and by a `CHECK` constraint. Every read also checks `expires_at`, so an expired quiz is unreachable even before cleanup runs.
- **Cleanup job:** a scheduled task (every ~15 minutes) hard-deletes expired quizzes; questions, attempts and answers cascade. The document is untouched, and nothing is lost from its stats because they were already updated at submit time (4.5).
- **Results / weak topics:** computed per attempt by grouping answers by question `topic` and source page; the lowest-accuracy topics are listed with their pages as "study more".
- **Leaderboard:** a query over `attempts` for one quiz-mode quiz, ranked with `RANK() OVER (ORDER BY score DESC)` so equal scores share a rank (1, 1, 3). The creator's own attempt is included. No global leaderboard table.

### 4.5 PDF Stats, History and Topic Review Quizzes

- Every answer is stored with `is_correct`, `topic` and `question_id` (until its quiz expires).
- **Stats are folded in at submit time.** When an attempt is submitted, its per-topic correct/total counts are added to `topic_stats` and its score to `score_history`, all keyed by `stats_id`. Because stats never read from `answers` later, expiring quizzes and deleting attempts loses nothing.
- **Weak / strong topics:** accuracy per topic from `topic_stats`, with a minimum-sample threshold; lowest are weak, highest are strong.
- **Passing confidence rate:** from `score_history`, the last 3 full-quiz scores (0-100) newest first, weighted 3, 2, 1: `Σ wᵢ·scoreᵢ / Σ wᵢ` over the attempts that exist. Returned with the attempt count so the UI can show "based on 3 attempts".
- **Shared takers** get their own `document_stats` row for the owner's document (`user_id` = the taker). Their stats are updated the same way as the owner's.
- **History:** `document_stats.document_id` is `ON DELETE SET NULL` and the row keeps a `title` snapshot. Deleting a document cascades to chunks, file and quizzes; its stats row stays with `document_id = NULL` and is shown in History. Deleting a history entry deletes the stats row and its children.
- **Topic review quizzes:** `POST /documents/{id}/topic-quizzes` with a `topic` (and the `source_quiz_id` it came from, if any) runs the 4.3 pipeline restricted to that topic's `heading_path` / page range, about 5 questions, `kind = 'topic'`, private (`share_token` NULL). Nothing is scheduled.
  - The first submitted attempt on a topic quiz updates `topic_stats`; later attempts are graded and shown but write no stats.
  - Topic quizzes never write to `score_history`, so they never affect the passing confidence rate.
  - The results page offers "retake this topic quiz" (new attempt, new shuffle) and "retake the review quiz" (only if `source_quiz_id` still exists and hasn't expired).

### 4.6 Chat with the PDF

Standard RAG: retrieve with the same hybrid search, answer from the chunks only, return citations (page and chunk), and say "not found in the document" when retrieval is weak. Streamed to the client over Server-Sent Events. "Explain this answer" pre-fills the question's source chunk as context.

## 5. Data Model

```
auth.users                    -- managed by Supabase Auth (email, password hash, Google identity)
profiles(id REFERENCES auth.users ON DELETE CASCADE, display_name varchar(40) CHECK 1-40 chars,
         created_at, updated_at)   -- RLS on, no policies: only the backend reads/writes it
      -- our own per-user data; every user_id below is an auth.users id

documents(id, user_id, title, file_path, content_hash, page_count,
          status, error, created_at)

chunks(id, document_id, page_start, page_end, heading_path, text,
       token_count, embedding vector(N), embedding_model, tsv tsvector)

quizzes(id, user_id, document_id, config jsonb, status,
        mode ('review' | 'quiz'), kind ('full' | 'topic'),
        topic NULL, source_quiz_id NULL REFERENCES quizzes ON DELETE SET NULL,
        share_token UNIQUE, expires_at,
        created_at)   -- CHECK (expires_at <= created_at + interval '7 days')

questions(id, quiz_id, type, prompt, options jsonb, answer, explanation,
          topic, difficulty, source_chunk_id, evidence,
          verified bool, verifier_notes)

attempts(id, quiz_id, user_id, score, question_order jsonb, option_order jsonb,
         started_at, finished_at)   -- orders shuffled per attempt

answers(id, attempt_id, question_id, response, is_correct, grade,
        feedback, answered_at)


document_stats(id, user_id, document_id NULL REFERENCES documents ON DELETE SET NULL,
               title, created_at, archived_at NULL)
      -- document_id NULL = the PDF was deleted; the row is a History entry

topic_stats(stats_id, topic, heading_path, page_start, page_end, correct, total, updated_at)

score_history(id, stats_id, mode ('review' | 'quiz'), score, taken_at)   -- full quizzes only

jobs(id, document_id, type, status, step, attempts, last_error, updated_at)
```

**Indexes**
- `chunks`: HNSW on `embedding` (cosine), GIN on `tsv`, B-tree on `(document_id, page_start)`.
- `documents`: unique `(user_id, content_hash)`.
- `answers`: `(attempt_id)`, and `(question_id)` for topic analytics.
- `quizzes`: unique `share_token`; B-tree on `expires_at` for the cleanup job.
- `attempts`: unique `(quiz_id, user_id)` where the quiz is in quiz mode (one attempt only); `(quiz_id, score DESC)` for the leaderboard.
- `users`: unique `email`; unique `google_sub`.
- `document_stats`: unique `(user_id, document_id)`; `(user_id) WHERE document_id IS NULL` for History.
- `topic_stats`: primary key `(stats_id, topic)`.

**Multi-tenancy:** every user-owned table carries `user_id` (directly or via a parent) and every query filters by it. The one exception is a shared quiz: any authenticated user holding a valid, unexpired `share_token` can read its questions and leaderboard and create their own attempts; in a **review-mode** quiz they can also read the original PDF file (read-only stream, `GET /s/{share_token}/document`) while the token is valid. Quiz-mode tokens never grant the document. No share ever exposes chunks or embeddings. Consider Postgres row-level security as a hardening step.

## 6. API Surface

| Method | Path | Purpose |
|---|---|---|
| — | (Supabase Auth) | Sign up, log in, Google, email confirmation, password reset, log out: handled by Supabase from the browser, not by our API |
| GET | `/auth/me` | The user the bearer token belongs to (proves the token check works) |
| GET | `/profile` | The reader's display name (or a suggestion from their Google name / email, with `chosen: false`) |
| PUT | `/profile` | Set the display name; the server tidies and validates it (`422` with a reason) |
| GET | `/health` | Liveness check, no login |
| POST | `/documents` | Upload PDF (starts ingestion job) |
| GET | `/documents`, `/documents/{id}` | List and status/progress |
| DELETE | `/documents/{id}` | Delete document, chunks, file and quizzes; its stats move to History |
| POST | `/documents/{id}/quizzes` | Generate quiz from config (includes `mode` and `lifetime_hours` ≤ 168) |
| GET | `/s/{share_token}` | Resolve a share link to its quiz (auth required; `410` if expired) |
| GET | `/s/{share_token}/document` | Read-only PDF for review-mode shares (`403` for quiz mode, `410` if expired) |
| GET | `/quizzes/{id}/leaderboard` | Per-quiz leaderboard (quiz mode only) |
| GET | `/quizzes/{id}` | Fetch quiz with questions (no answers until submitted) |
| POST | `/quizzes/{id}/attempts` | Start attempt |
| POST | `/attempts/{id}/submit` | Submit answers, grade, return results |
| GET | `/documents/{id}/stats` | A PDF's weak/strong topics, passing confidence and score history |
| GET | `/history` | Stats of deleted PDFs (title + stats only) |
| DELETE | `/history/{stats_id}` | Remove a history entry |
| POST | `/documents/{id}/topic-quizzes` | One-off short quiz on a weak topic |
| POST | `/documents/{id}/chat` | RAG Q&A (SSE stream) |
| GET | `/quizzes/{id}/export?format=anki\|pdf` | Export |

Long operations (ingestion, quiz generation for large counts) return `202 Accepted` with a job ID; the client polls `GET /jobs/{id}` or subscribes to an SSE stream.

**Every endpoint except `/health` requires a valid Supabase access token** (`401` otherwise).

**All database writes go through the API.** The browser only talks to Supabase for logging in; it never reads or writes tables directly. Validation (e.g. display-name rules) therefore lives in one place, on the server, and the user id always comes from the verified token, never from the request body. The backend connects to Postgres through Supabase's session pooler with `DATABASE_URL` (server-only: it contains the database password and bypasses RLS).

**Never leak answers early:** the quiz fetch endpoint omits `answer`, `explanation` and `evidence` until the attempt is submitted.

## 7. Provider Abstraction

```python
class LLMProvider(Protocol):
    async def generate(self, messages, *, schema=None, temperature=0.2) -> Any: ...

class EmbeddingProvider(Protocol):
    dim: int
    model: str
    async def embed(self, texts: list[str]) -> list[list[float]]: ...
```

- Implementations: Gemini, Groq, and a local option (for example sentence-transformers or Ollama).
- Selected via config; the model name is recorded on chunks and quizzes for reproducibility.
- Centralized retry with exponential backoff and jitter, timeouts, and rate-limit handling in one place.
- Per-request token and cost accounting logged for each call.

## 8. Evaluation Harness

Lives in `/eval` and runs from the command line, independent of the web app.

1. **Dataset:** 3+ PDFs from different subjects (for example a science chapter, a history chapter, a programming text).
2. **Generate:** 50 questions per PDF under a given configuration.
3. **Label:** hand-label each question as correct and answerable (Y/N), citation correct (Y/N), and ambiguous (Y/N). Store labels in versioned CSV/JSON.
4. **Metrics:** accuracy, citation accuracy, duplicate rate, retrieval hit rate, latency, token cost.
5. **Experiments (each changes one variable):**
   - Chunk size and overlap.
   - Vector only vs hybrid vs hybrid + rerank.
   - Verification pass on vs off.
   - Provider/model comparison.
6. **Report:** results table committed to `docs/EVALUATION.md` and summarized in the README.

Use an LLM judge to scale, but validate it against the human labels on a sample and report their agreement.

## 9. Security

- **Uploads:** type and size validation, store outside the web root, randomized filenames, no execution of file content, page and time limits on parsing to prevent resource exhaustion.
- **Prompt injection:** PDF text is untrusted. Delimit it clearly in prompts, instruct the model to ignore instructions inside the document, validate outputs against schema, and never give the model tools or secrets.
- **Auth:** Supabase Auth stores and hashes passwords and runs Google OAuth; the Google client secret lives in the Supabase dashboard, never in our code. The browser uses the **PKCE** flow: emailed links and the Google redirect carry a one-time code that only the browser that started the flow can redeem (on `/auth/callback` or `/auth/reset`), instead of tokens in the URL. New accounts must confirm their email. After login, redirects only go to same-site paths (`safeNext`), never to a URL taken from the link, to prevent open redirects.
- **Token checks (API):** every request's JWT is verified with an explicit algorithm allow-list (ES256/RS256 via the project's JWKS, cached; HS256 only if a legacy `SUPABASE_JWT_SECRET` is set), and must have `aud = authenticated`, our project's `iss`, and an unexpired `exp`. The public anon key (itself a JWT with `aud = anon`) is rejected. 401 responses don't say why a token failed. The frontend's login gate is only UX.
- **Browser keys:** only the Supabase publishable (anon) key is in the frontend; the service-role key never leaves the server. Every table in `public` (which Supabase's Data API exposes to browsers) has Row Level Security enabled with no policies, so browsers can't touch it even with the anon key; only the backend's database connection can.
- **Authorization:** ownership checks on every document, quiz and attempt; shared quizzes are reachable only through an unguessable, unexpired share token, and the shared PDF only through a review-mode token.
- **Expiry:** expired quizzes are rejected on read and hard-deleted by the cleanup job.
- **Secrets:** provider keys server-side only, loaded from environment, never logged.
- **Rate limiting:** per-user limits on uploads, generation and chat to control cost and abuse.
- **Privacy:** delete cascades (document → chunks → file → quizzes); only the title and aggregate stats are kept as a History entry until the user deletes it; do not send documents to a provider the user has not been told about.

## 10. Observability

- Structured JSON logs with request ID, user ID and job ID.
- Per-call LLM logging: model, latency, token counts, retry count, outcome.
- Job status and error persisted in `jobs`.
- Basic metrics (request latency, job duration, failure rate); Sentry or equivalent for errors.
- A debug view (admin/dev only) showing the retrieved chunks and prompt for any generated question. It's very helpful when tuning quality.

## 11. Performance and Cost

- Batch embeddings; cache by content hash so identical text is never embedded twice.
- Over-generate only as much as the evaluation says is needed.
- Use a cheaper model for verification and de-duplication and a stronger one for generation, if the evaluation supports it.
- Stream chat responses; generate quizzes asynchronously with progress.
- HNSW parameters (`m`, `ef_construction`, `ef_search`) tuned against recall and latency on real data.

## 12. Repository Structure

```
bookwyrm/
├── README.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── EVALUATION.md
│   └── DECISIONS.md
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── api/            # routers
│   │   ├── core/           # auth (Supabase JWT checks), later security, logging
│   │   ├── db/             # models, session, migrations (alembic)
│   │   ├── ingestion/      # extract, structure, chunk, embed
│   │   ├── retrieval/      # vector, fulltext, fusion, rerank
│   │   ├── generation/     # prompts, schemas, verify, dedupe
│   │   ├── grading/
│   │   ├── progress/       # stats, confidence, topic quizzes
│   │   ├── providers/      # llm + embedding interfaces and impls
│   │   └── jobs/
│   ├── tests/
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── app/            # router layout, app bar, account menu, login-required wrapper
│   │   ├── features/       # one folder per page/area: landing, about, auth, library (later quiz, results, ...)
│   │   ├── components/
│   │   ├── api/            # typed client
│   │   └── hooks/
│   └── package.json
├── eval/
│   ├── datasets/
│   ├── labels/
│   ├── run_eval.py
│   └── results/
├── docker-compose.yml      # optional local postgres+pgvector (offline database tests)
└── .env.example
```

## 13. Testing Strategy

- **Unit:** chunking, citation/evidence matching, RRF, passing confidence, schema validation.
- **Integration:** ingestion → retrieval → generation against a small fixture PDF using a **fake provider** that returns canned outputs, so tests are deterministic and free.
- **API tests:** auth, ownership, answer-hiding before submission.
- **Contract tests:** each real provider implementation against the interface (run manually or nightly, since they cost money and need keys).
- **Frontend:** Vitest and React Testing Library for components; one end-to-end happy path (Playwright) covering upload → quiz → results.
- **Evaluation** is separate from tests: it measures quality, tests check correctness.

## 14. Deployment

- **Local:** a hosted Supabase dev project (free tier) for Auth, Postgres and Storage; backend (`uv run uvicorn app.main:app --reload`) and frontend (`npm run dev`) run on the host with hot reload. `docker-compose.yml` keeps an optional local Postgres + pgvector for offline database tests.
- **Frontend: Cloudflare Workers (static assets).** `frontend/wrangler.jsonc` serves `dist/` with `not_found_handling: single-page-application`, so `/about` or `/auth/callback?code=...` get `index.html` and React Router takes over. `frontend/public/_headers` adds security headers (no framing, nosniff, strict referrer) and a one-year cache for hashed `/assets/*`. Cloudflare builds from GitHub on every push to `main`; `VITE_*` values are **build variables** there, because Vite bakes them into the files at build time.
- **Backend and data:** backend container on Fly.io, Railway or Render (or Cloudflare later); for now the deployed site reuses the dev Supabase project, with the live address added to its redirect URLs. A separate production Supabase project comes before real users.
- **CI:** GitHub Actions running lint, type-check and tests on every push; migrations applied on deploy.

## 15. Key Decisions and Open Questions

| Decision | Current choice | Revisit when |
|---|---|---|
| Vector store | pgvector in Postgres | Index size or recall becomes a bottleneck |
| Retrieval | Hybrid (vector + full-text, RRF) | Evaluation shows vector-only is as good |
| Reranker | Optional, off by default | Evaluation shows a meaningful gain |
| Job system | Background tasks / DB queue | Jobs need scheduling, priorities or heavy parallelism |
| Platform | Supabase for Auth, Postgres (pgvector) and Storage | Free-tier limits bite, or we need something Supabase can't do |
| Auth | Supabase Auth (email + Google), PKCE, email confirmation; API verifies JWTs | Adding more providers or teams |
| Quiz lifetime | Max 7 days, then hard delete | Users need longer-lived quizzes or history |
| OCR | Out of scope for v1 | Users upload scanned documents |
| Embedding model | Hosted default, local option | Cost, privacy or non-English quality demands change |
| LLM provider | Gemini primary; Groq used for the rest of a run once Gemini fails | The evaluation shows Groq is as accurate, or Gemini's free tier is too limiting |
| Structured output (M1) | JSON mode + Pydantic validation + re-ask with the error, not provider-native schemas | Malformed-reply rate is high enough in the evaluation to justify native schemas |
| Non-English (e.g. Filipino) | Not guaranteed in v1 | A multilingual embedding model is tested in the evaluation |

Record each real decision, with the evidence behind it, in `docs/DECISIONS.md` as the project progresses.
