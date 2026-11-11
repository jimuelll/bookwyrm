# Bookwyrm backend

Milestone M1: a command-line tool that turns a PDF into verified questions, each citing the page its
answer is on. See the repository README for setup and `docs/ARCHITECTURE.md` §4 for the design.

```
app/
  cli.py              bookwyrm generate | chunks
  config.py           settings from env / .env
  ingestion/          extract.py (PDF -> pages), chunk.py (pages -> passages with page marks)
  generation/         schemas, prompts, checks (evidence, duplicates), pipeline (generate -> check -> verify)
  providers/          gemini, groq, fallback, fake, factory
tests/                mirrors app/; PDFs are generated in the tests, providers are faked at HTTP level
```

Pipeline: pick passages spread over the document → ask for 1.5x the questions → validate the JSON
shape → the quoted evidence must really be in the cited passage → a second model call checks each
question against only that passage → drop near-duplicates → keep N.
