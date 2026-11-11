# Bookwyrm

**Quizzes from your PDFs, with the page for every answer.**

Bookwyrm turns educational PDFs (textbooks, modules, lecture notes) into quizzes you can trust. Upload a document and it writes questions only from what is actually in it, checks each question with a second pass, and shows you the page and passage every answer came from. When you miss something, it tracks the topic and gives you a short quiz on just those pages so you can review what you got wrong.

## Why

- Studying from long PDFs makes it hard to test yourself.
- A general chatbot can make up questions that aren't in your material, and answers it can't back up.
- Writing practice questions by hand is slow.

Bookwyrm keeps every question grounded in your document and shows its source, so you can always check it.

## What it does

- **Upload a PDF.** It is read page by page, keeping headings and page numbers.
- **Get a cited quiz.** Multiple choice, true/false, fill-in-the-blank and short answer, each linked to its page.
- **Verified questions.** A second check rejects questions that are ambiguous or not answerable from the source.
- **See what to study.** Your score as a percentage plus the topics and pages you need to review.
- **Review or quiz mode.** Review mode for unlimited practice on weak topics; quiz mode for a one-time attempt with a leaderboard for that quiz.
- **Share by link.** Classmates log in to take your quiz while it is valid (you choose how long, up to 7 days, then the quiz is deleted; the PDF stays).
- **Stats per PDF.** Weak and strong topics and a passing confidence rate for each PDF in your library. Delete a PDF and its stats move to History.

An account (email or Google) is required for all of it.

## Status

Early development. The landing page is built in `frontend/`; the backend (ingestion, retrieval, quiz generation) is next.

## Run it locally

Requires Node 22+ (and, once the backend lands, Docker and Python 3.12).

```bash
cp .env.example .env          # then fill in the values
docker compose up -d          # Postgres + pgvector
cd frontend && npm install && npm run dev
```

Checks (the same ones CI runs on every push and pull request):

```bash
cd frontend
npm run lint && npm run typecheck && npm test && npm run build
```

## Docs

- [PRD](./docs/PRD.md): what Bookwyrm does and why
- [Architecture](./docs/ARCHITECTURE.md): how it is built
- [Design](./docs/DESIGN.md): how it looks and feels
