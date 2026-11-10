# Bookwyrm

**Quizzes from your PDFs, with the page for every answer.**

Bookwyrm turns educational PDFs (textbooks, modules, lecture notes) into quizzes you can trust. Upload a document and it writes questions only from what is actually in it, checks each question with a second pass, and shows you the page and passage every answer came from. When you miss something, it tracks the topic and brings those questions back so you can review what you got wrong.

## Why

- Studying from long PDFs makes it hard to test yourself.
- A general chatbot can make up questions that aren't in your material, and answers it can't back up.
- Writing practice questions by hand is slow.

Bookwyrm keeps every question grounded in your document and shows its source, so you can always check it.

## What it does

- **Upload a PDF.** It is read page by page, keeping headings and page numbers.
- **Get a cited quiz.** Multiple choice, true/false, fill-in-the-blank and short answer, each linked to its page.
- **Verified questions.** A second check rejects questions that are ambiguous or not answerable from the source.
- **Review what you missed.** See your weak topics and get follow-up quizzes on just those pages.

## Status

Early development. The landing page is built in `frontend/`; the backend (ingestion, retrieval, quiz generation) is next.

## Docs

- [PRD.md](./PRD.md): what Bookwyrm does and why
- [ARCHITECTURE.md](./ARCHITECTURE.md): how it is built
- [DESIGN.md](./DESIGN.md): how it looks and feels
# bookwyrm
