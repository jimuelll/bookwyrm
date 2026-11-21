# Decisions

**Related:** [PRD.md](./PRD.md), [ARCHITECTURE.md](./ARCHITECTURE.md)

Decisions that have been made, newest first. Each says what was chosen, why, and when to look at it again. Where the build differs from what the PRD first planned, the entry says so. Open questions stay in the PRD (§14) and the architecture doc (§15) until they are decided; then they move here.

---

## D14. Passing rate instead of a weighted confidence score (2026-11-12)

**Chosen:** a PDF's headline number is the **passing rate**: the share of the reader's counted sittings that scored 70% or more (`PASS_MARK` in `app/stats.py`). Only the **first finished attempt at each quiz** counts; retakes are practice and change nothing.
**Instead of:** the "passing confidence rate" first planned in the PRD, a 3-2-1 weighted average of the last 3 scores, retakes included.
**Why:** counting retakes lets a reader raise their number by memorising the same fixed question set. A pass/fail share is also easier to explain on the page than a weighted average.
**Revisit when:** readers want a number that reacts faster to recent improvement.

## D13. Topic ratings need 3 answers; weak under 60%, strong at 80% (2026-11-12)

**Chosen:** a topic with fewer than 3 answered questions is "unrated"; otherwise weak below 60%, strong at 80% or more, "learning" between. Topics are the question writer's labels, merged ignoring case and spacing only. Constants at the top of `app/stats.py`.
**Why:** one wrong answer out of one is 0% but isn't evidence.
**Revisit when:** labels for the same idea split a topic in two often enough to matter (merge by embedding then).

## D12. Stats are computed when read, from attempts (2026-11-12)

**Chosen:** `GET /documents/{id}/stats` works the numbers out from the reader's stored attempts and answers each time. There are no `document_stats`, `topic_stats` or `score_history` tables yet.
**Why:** simplest correct thing while quizzes never expire and there is no History.
**Consequence:** deleting a PDF deletes its quizzes (cascade), and with them its stats. **This must change before quiz expiry (M4) or History ships:** both need stats folded into their own tables at submit time (ARCHITECTURE §4.5).

## D11. Topic review quizzes are ordinary quizzes with a topic (2026-11-12)

**Chosen:** "review this topic" calls the normal `POST /documents/{id}/quizzes` with `topic`, medium difficulty, multiple choice, and no `count`, so the server suggests a number that suits how much the PDF says about the topic. There is no separate `topic-quizzes` endpoint and no `kind` column.
**Why:** the normal pipeline already narrows passages and questions to a topic; a second endpoint would duplicate it.
**Consequence:** a topic quiz's first attempt counts toward the passing rate like any quiz. If topic quizzes should be kept out of it (as PRD 7.7 first planned), add `kind` then.

## D10. Topic search is keyword ∪ nearest passages, no RRF (2026-11-12)

**Chosen:** a topic's passages are the union of keyword matches (BM25-style weighting) and the nearest passages by cosine similarity (top 12, at least `SEMANTIC_MIN_SIMILARITY` = 0.58, a measured floor so "nothing about that" can still happen). Topic vectors are cached. Code: `app/retrieval.py`, `app/generation/scope.py`.
**Instead of:** hybrid ranking with Reciprocal Rank Fusion and an optional reranker.
**Why:** a quiz's scope is a *set* of passages, not a ranked list, so fusion of ranks buys nothing yet.
**Revisit when:** chat (ranked answers) or the evaluation needs a ranking.

## D9. Gemini embeddings, best effort, no vector index (2026-11-12)

**Chosen:** `gemini-embedding-001`, 768 numbers per passage, stored in `chunks.embedding` (pgvector, migration `0006`) with the model's name. Passages are embedded as documents, topics as queries. If there is no key or the call fails, the book still becomes `ready` and topics fall back to keywords; `bookwyrm embed-missing` fills the gaps later. A blank `EMBEDDING_MODEL` means the default. No HNSW index.
**Why:** every search is inside one document (a few hundred rows), where an exact scan is fast and exact. Best effort keeps an outage from failing uploads.
**Revisit when:** searches span documents, or a local/multilingual model is tested in the evaluation.

## D8. Only objective question types in the app (2026-11-12)

**Chosen:** the API accepts `mcq`, `true_false` and `fill_blank` (`ObjectiveType` in `app/quizzes.py`). `short_answer` exists in the generation schema and the CLI but isn't offered in the app.
**Why:** these can be marked without a model call. Short answers need AI grading (ARCHITECTURE §4.3), which isn't built.
**Revisit when:** short-answer grading is built.

## D7. Generation progress and rate limits live in process memory (2026-11-12)

**Chosen:** quiz progress (`ProgressBoard`), the upload rate limit and the quiz rate limit are kept in the API process's memory. On startup, unfinished documents are marked `failed` ("interrupted, upload it again").
**Why:** there is one API process; a shared store or a `jobs` table would be infrastructure without a measured need.
**Revisit when:** a second API process runs. Then: Redis/Postgres or Cloudflare rules for limits, and the `jobs` table for resumable work.

## D6. PDF parsing in a sandboxed, spawned process (2026-11-12)

**Chosen:** `inspect_pdf` and `extract_pages` run in a separate spawned process, one file per process, with a wall-clock timeout, a memory cap on Linux (`RLIMIT_AS`), at most 2 at once, and one warm spare. Details in ARCHITECTURE §9.
**Why:** MuPDF is C code parsing untrusted input; a crash or a PDF bomb must only end the child.
**Revisit when:** Windows production needs a memory cap (Job Object).

## D5. Per-reader upload quotas (2026-11-12)

**Chosen:** 50 documents and 500 MB per reader (413), 10 upload attempts per 10 minutes (429 with `Retry-After`), checked before the body is read and again under a per-reader lock. Details in ARCHITECTURE §9.
**Why:** storage and parsing cost money and can be abused.

## D4. JSON mode + Pydantic + re-ask, not provider-native schemas (M1, 2026-11-11)

**Chosen:** ask for JSON, validate with Pydantic, and re-ask with the validation error on a malformed reply. Providers are called over REST with httpx; no vendor SDKs, no Instructor.
**Why:** works the same on Groq and Gemini, and keeps dependencies small.
**Revisit when:** the evaluation shows a malformed-reply rate high enough to justify native schemas.

## D3. Groq primary, Gemini fallback (M1, 2026-11-11)

**Chosen:** Groq writes and checks questions; once Groq fails, Gemini is used for the rest of that run (if `GEMINI_API_KEY` is set). `LLM_PROVIDER=fake` runs the whole pipeline with no key.
**Why:** both have free tiers; the fallback keeps a run alive through rate limits.
**Revisit when:** the evaluation shows Gemini is as accurate, or Groq's free tier is too limiting.

## D2. Supabase for Auth, Postgres (pgvector) and Storage (2026-11-11)

**Chosen:** one Supabase project. Auth: email + password (with confirmation and reset) and Google, PKCE flow; the API verifies the JWTs itself. Every `public` table has RLS on with no policies, so only the backend's connection can touch them. PDFs go to a private bucket, `<user id>/<document id>.pdf`.
**Why:** no password storage or OAuth plumbing of our own; one platform and permissions model; free tier.
**Revisit when:** free-tier limits bite, or we need more providers or teams.

## D1. Product decisions from the PRD's open questions (2026-11-11)

- **LLM provider:** Groq primary, Gemini fallback; the evaluation compares them (D3).
- **Auth:** email/password and Google OAuth (PRD 7.10).
- **Quiz expiry keeps the PDF:** it stays in the library with its stats (PRD 7.6).
- **Long-term progress:** per-PDF stats outlive quizzes; deleted PDFs move to History (PRD 7.6). *Not built yet; see D12.*
- **Leaderboard ties:** shared rank, 1, 1, 3 (PRD 7.11).
- **Creator on their own leaderboard:** yes (PRD 7.11).
- **Review-mode shares:** each taker sees only their own weak topics; the link shares the PDF read-only; takers build their own stats (PRD 7.11).
- **No scheduled spaced repetition:** one-off topic review quizzes started by the reader instead (PRD 7.7; built as D11).
- **Passing confidence:** first decided as a 3-2-1 weighted average of the last 3 scores; replaced by the passing rate (D14).
