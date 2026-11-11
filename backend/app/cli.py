"""Command-line entry point (milestone M1): a PDF in, verified questions out.

uv run bookwyrm generate notes.pdf --count 5
uv run bookwyrm generate notes.pdf --types mcq,true_false --difficulty hard --pages 10-40
uv run bookwyrm chunks notes.pdf          # inspect how the PDF was split
"""

import argparse
import asyncio
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import cast, get_args

import httpx

from app.config import Settings, get_settings
from app.generation.pipeline import GenerationError, QuizConfig, QuizResult, generate_quiz
from app.generation.schemas import Difficulty, QuestionType
from app.ingestion.chunk import Chunk, chunk_pages
from app.ingestion.extract import PdfError, extract_pages
from app.providers.base import ProviderError
from app.providers.factory import build_provider

LETTERS = "ABCD"


def _page_range(value: str) -> tuple[int, int]:
    try:
        first, _, last = value.partition("-")
        start, end = int(first), int(last or first)
    except ValueError:
        raise argparse.ArgumentTypeError("use a page or range like 12 or 10-40") from None
    if not 1 <= start <= end:
        raise argparse.ArgumentTypeError("pages start at 1 and the range must go forwards")
    return start, end


def _types(value: str) -> tuple[QuestionType, ...]:
    allowed = get_args(QuestionType)
    chosen = tuple(t.strip() for t in value.split(",") if t.strip())
    bad = [t for t in chosen if t not in allowed]
    if bad or not chosen:
        raise argparse.ArgumentTypeError(f"choose from {', '.join(allowed)}")
    return cast(tuple[QuestionType, ...], chosen)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bookwyrm", description="Quizzes from your PDFs, with the page for every answer."
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="log every model call and rejection")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="write verified questions from a PDF")
    gen.add_argument("pdf", type=Path)
    gen.add_argument("-n", "--count", type=int, default=5, help="number of questions (default 5)")
    gen.add_argument("--difficulty", choices=get_args(Difficulty), default="medium")
    gen.add_argument(
        "--types",
        type=_types,
        default=("mcq",),
        help="comma-separated: mcq,true_false,fill_blank,short_answer",
    )
    gen.add_argument("--pages", type=_page_range, help="only use these pages, e.g. 10-40")
    gen.add_argument("--json", type=Path, dest="json_out", help="also save the questions to this JSON file")

    chunks = sub.add_parser("chunks", help="show how a PDF is split into passages")
    chunks.add_argument("pdf", type=Path)
    return parser


def _load_chunks(pdf: Path, settings: Settings) -> tuple[int, list[Chunk]]:
    pages = extract_pages(pdf, max_pages=settings.max_pages, max_mb=settings.max_upload_mb)
    chunks = chunk_pages(
        pages,
        target_tokens=settings.chunk_target_tokens,
        max_tokens=settings.chunk_max_tokens,
        overlap_tokens=settings.chunk_overlap_tokens,
    )
    scanned = sum(p.likely_scanned for p in pages)
    if scanned:
        print(f"Note: {scanned} page(s) had no readable text and were skipped (scanned images?).")
    return len(pages), chunks


def _print_result(result: QuizResult, provider: str) -> None:
    rejected = sum(result.rejected.values())
    print(
        f"{result.candidates} candidates from {provider}: {len(result.questions)} kept, "
        f"{result.spare} spare, {rejected} rejected"
    )
    for reason, n in result.rejected.most_common():
        print(f"  - {reason}: {n}")
    for i, q in enumerate(result.questions, 1):
        print(f"\n{i}. [{q.type} · {q.difficulty} · {q.topic}]\n   {q.prompt}")
        if q.options:
            for letter, option in zip(LETTERS, q.options, strict=False):
                print(f"     {letter}) {option}")
        print(f"   Answer: {q.answer}")
        print(f"   Why: {q.explanation}")
        print(f'   Source: p. {q.page}: "{q.evidence}"')


async def _generate(args: argparse.Namespace, settings: Settings) -> int:
    page_count, chunks = _load_chunks(args.pdf, settings)
    print(f"{args.pdf.name}: {page_count} pages, {len(chunks)} passages")
    config = QuizConfig(count=args.count, difficulty=args.difficulty, types=args.types, pages=args.pages)
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        provider = build_provider(settings, client)
        result = await generate_quiz(chunks, config, provider)
        _print_result(result, f"{provider.name}/{provider.model}")
    if args.json_out:
        payload = [q.model_dump() for q in result.questions]
        args.json_out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nSaved to {args.json_out}")
    if len(result.questions) < config.count:
        print(f"\nOnly {len(result.questions)} of {config.count} questions passed every check.")
        return 1
    return 0


def _chunks(args: argparse.Namespace, settings: Settings) -> int:
    page_count, chunks = _load_chunks(args.pdf, settings)
    print(f"{args.pdf.name}: {page_count} pages, {len(chunks)} passages\n")
    for c in chunks:
        preview = c.text[:110] + ("…" if len(c.text) > 110 else "")
        print(f"{c.id:>5}  pp. {c.pages_label:<9} ~{c.token_count:>4} tokens  {preview}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    # Windows terminals default to a legacy code page; PDFs are full of curly quotes and dashes.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = _parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s"
    )
    if not args.verbose:
        logging.getLogger("httpx").setLevel(logging.WARNING)  # it logs every request URL at INFO
    settings = get_settings()
    try:
        if args.command == "chunks":
            return _chunks(args, settings)
        return asyncio.run(_generate(args, settings))
    except (PdfError, GenerationError, ProviderError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
