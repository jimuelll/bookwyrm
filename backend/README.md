# Bookwyrm backend

The FastAPI app and the generation pipeline, plus the M1 command-line tool that turns a PDF into
verified questions, each citing the page its answer is on. See the repository README for setup,
`docs/ARCHITECTURE.md` §4 for the design and `docs/DECISIONS.md` for why it is built this way.

```
app/
  main.py             the API and its routes
  cli.py              bookwyrm generate | chunks | embed-missing
  config.py           settings from env / .env
  documents.py        document store, ingestion job, embedding backfill
  storage.py          PDF files: private Supabase bucket, or a local folder without a key
  quotas.py           per-reader upload quotas and rate limits
  quizzes.py          quizzes, attempts and marking
  retrieval.py        topic search (keyword matches + nearest passages)
  stats.py            per-PDF stats (topic levels, passing rate, scores over time)
  profiles.py         display names
  core/               auth (Supabase JWT checks)
  db/                 models and session
  ingestion/          extract.py (PDF -> pages, sandboxed), chunk.py (pages -> passages with page marks)
  generation/         schemas, prompts, checks (evidence, duplicates), pipeline, scope
  providers/          gemini, groq, fallback, fake, factory, embeddings
migrations/           alembic (uv run alembic upgrade head)
tests/                mirrors app/; PDFs are generated in the tests, providers are faked at HTTP level
```

Pipeline: pick passages (spread over the document, or about a topic) → ask for 1.5x the questions →
validate the JSON shape → the quoted evidence must really be in the cited passage → a second model
call checks each question against only that passage → drop near-duplicates → keep N.
