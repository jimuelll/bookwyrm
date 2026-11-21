# Bookwyrm

Quizzes from PDFs, with a cited page for every answer. Frontend in `frontend/` (React, Vite), API and generation pipeline in `backend/` (FastAPI, uv).

## Docs are the spec

The docs are the source of truth. Code follows them, not the other way round.

- **`docs/PRD.md`**: what the product does. **`docs/ARCHITECTURE.md`**: how it is built. **`docs/DECISIONS.md`**: why, as one entry per decision. **`docs/DESIGN.md`**: how it looks.
- **Spec first.** A change to behavior updates the PRD and/or ARCHITECTURE in the same commit as the code. If the code and the docs disagree, one of them is a bug: fix it, don't leave it.
- **Make the smallest edit that keeps the main docs true.** Don't rewrite whole sections; mark what is built and what is still planned.
- **Real choices go in DECISIONS.md.** Add one when you pick between alternatives or differ from what the PRD planned: what was chosen, what it replaced, why, and when to revisit it. Number entries upward (next is D15), newest first.
- **DECISIONS.md is append-only.** Never change an old decision. Add a new entry that says "supersedes Dn", and add "superseded by Dm" to the old one.
- **Open questions** live in PRD §14 and ARCHITECTURE §15 until they are decided. Then they move to DECISIONS.md and leave the list.
- **Milestones** (PRD §12): start each new one with `specs/<milestone>/spec.md` (requirements as testable `WHEN …, THE SYSTEM SHALL …` criteria) and `tasks.md` (ordered build checklist). Write it when the milestone starts, not before.

## Checks

```bash
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest
```

## Commits

Conventional style (`feat:`, `fix:`, `docs:`, …). No `Co-Authored-By` or other AI-attribution lines in commits or PRs.
