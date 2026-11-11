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

Early development. The frontend (landing, About, login modal, Library placeholder) is in `frontend/`. The backend's first milestone (M1) is in `backend/`: a command-line tool that turns a PDF into verified, page-cited questions. The web API, database and embeddings come next (M2).

## Run it locally

Requires Node 22+, [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for the backend), and a free [Supabase](https://supabase.com) project.

```bash
cp .env.example .env                 # backend values: SUPABASE_URL, GEMINI_API_KEY, ...
# frontend values go in frontend/.env.local: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_URL
cd frontend && npm install && npm run dev
cd backend && uv sync && uv run alembic upgrade head   # create/update the database tables (needs DATABASE_URL)
cd backend && uv run uvicorn app.main:app --reload     # API on http://localhost:8000
```

### Set up Supabase (one time)

1. Create a project at supabase.com. In **Project Settings → API**, copy the **Project URL** and the **publishable (anon) key**:
   - `frontend/.env.local`: `VITE_SUPABASE_URL=<url>` and `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>`
   - `.env`: `SUPABASE_URL=<url>`
   - Never put the **secret / service_role** key in the frontend.
2. **Authentication → URL Configuration:** Site URL `http://localhost:5173`; add the redirect URL `http://localhost:5173/**` (covers `/auth/callback` and `/auth/reset`).
3. **Authentication → Sign In / Providers → Email:** keep "Confirm email" on.
4. **Google sign-in:** in Google Cloud Console create an OAuth client ID (type *Web application*) with the authorized redirect URI shown on Supabase's Google provider page (`https://<project>.supabase.co/auth/v1/callback`). Paste the client ID and secret into **Authentication → Providers → Google** and enable it.
5. Supabase's built-in email sender is rate-limited (a few emails per hour) and meant for testing; set up custom SMTP before real users.

Check the API sees your login: log in on the site, then in the browser console run
`(await (await fetch('http://localhost:8000/auth/me', {headers: {Authorization: 'Bearer ' + JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token}})).json())`.

### Deploy the frontend (Cloudflare Workers)

The repo is ready: `frontend/wrangler.jsonc` (serve `dist/`, send unknown paths to `index.html`) and `frontend/public/_headers` (security + caching headers). One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository**, connect GitHub and pick this repo.
2. Settings: **Root directory** `frontend`, **Build command** `npm run build`, **Deploy command** `npx wrangler deploy` (the default).
3. **Build variables** (not runtime variables: Vite copies them into the files while building): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and later `VITE_API_URL`.
4. Deploy. The site appears at `https://bookwyrm.<your-subdomain>.workers.dev`; every push to `main` redeploys.
5. **Supabase → Authentication → URL Configuration:** add `https://bookwyrm.<your-subdomain>.workers.dev/**` to Redirect URLs (keep the localhost one). Set Site URL to the live address once it's the main one.
6. **Google Cloud → your OAuth client:** optionally add the live address to *Authorized JavaScript origins*. The redirect URI stays the same (it's Supabase's callback, and the Supabase project hasn't changed).

Try the production build locally with Cloudflare's runtime: `cd frontend && npm run build && npx wrangler dev` (http://localhost:8787).

### Backend (M1: PDF in, verified questions out)

```bash
cd backend
uv sync
uv run bookwyrm generate path/to/notes.pdf --count 5
uv run bookwyrm generate notes.pdf --types mcq,true_false --difficulty hard --pages 10-40 --json quiz.json
uv run bookwyrm chunks notes.pdf   # see how the PDF was split into passages
```

Gemini is the primary model and Groq the fallback (used when Gemini fails, if `GROQ_API_KEY` is set). Set `LLM_PROVIDER=fake` to try the whole pipeline with no key: it writes simple questions straight from the text.

Checks (the same ones CI runs on every push and pull request):

```bash
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest
```

## Docs

- [PRD](./docs/PRD.md): what Bookwyrm does and why
- [Architecture](./docs/ARCHITECTURE.md): how it is built
- [Design](./docs/DESIGN.md): how it looks and feels
