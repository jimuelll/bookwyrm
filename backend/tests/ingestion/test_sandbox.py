"""PDF parsing in a child process: results come back, and slow, crashing or greedy work is contained.

The stand-in workers below are module-level functions because a spawned child imports them by name.
"""

import os
import sys
import time
from pathlib import Path

import pytest

from app.ingestion import sandbox
from app.ingestion.extract import PdfError
from app.ingestion.sandbox import CRASHED, TIMED_OUT, TOO_BIG, Limits, run_sandboxed
from tests.conftest import MakePdf

QUICK = Limits(timeout_seconds=30, memory_mb=0)


def add(a: int, b: int) -> int:
    return a + b


def refuse() -> None:
    raise PdfError("The PDF is password-protected.")


def hang() -> None:
    time.sleep(60)  # a parser stuck in a loop


def crash() -> None:
    os._exit(139)  # what a segfault in C looks like from outside: the process just ends


def bug() -> None:
    raise ValueError("unexpected")


def hog() -> int:
    blocks = [bytearray(64 * 1024 * 1024) for _ in range(64)]  # 4 GB
    return len(blocks)


def test_returns_the_childs_result() -> None:
    assert run_sandboxed(add, 2, b=3, limits=QUICK) == 5


def test_a_reader_facing_error_comes_back_as_is() -> None:
    with pytest.raises(PdfError, match="password-protected"):
        run_sandboxed(refuse, limits=QUICK)


def test_a_parse_that_runs_too_long_is_killed() -> None:
    started = time.monotonic()
    with pytest.raises(PdfError) as caught:
        run_sandboxed(hang, limits=Limits(timeout_seconds=2, memory_mb=0))
    assert str(caught.value) == TIMED_OUT
    assert time.monotonic() - started < 20  # we didn't wait for the 60 s sleep


def test_a_crash_in_the_child_does_not_take_the_api_with_it() -> None:
    with pytest.raises(PdfError) as caught:
        run_sandboxed(crash, limits=QUICK)
    assert str(caught.value) == CRASHED


def test_any_other_error_is_a_bug_not_the_readers_file() -> None:
    with pytest.raises(RuntimeError, match="ValueError: unexpected"):
        run_sandboxed(bug, limits=QUICK)


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="RLIMIT_AS memory caps are Linux-only")
def test_a_parse_that_needs_too_much_memory_fails_cleanly() -> None:
    with pytest.raises(PdfError) as caught:
        run_sandboxed(hog, limits=Limits(timeout_seconds=30, memory_mb=512))
    assert str(caught.value) == TOO_BIG


def test_reads_a_real_pdf(make_pdf: MakePdf) -> None:
    path = make_pdf(["Mitochondria are the powerhouse of the cell. " * 5, "Ribosomes build proteins. " * 5])
    assert sandbox.inspect_pdf(path, max_pages=5, max_mb=1, limits=QUICK) == 2
    pages = sandbox.extract_pages(path, max_pages=5, max_mb=1, limits=QUICK)
    assert [p.number for p in pages] == [1, 2]
    assert "Ribosomes" in pages[1].text


def test_a_damaged_file_is_still_a_reader_facing_error(tmp_path: Path) -> None:
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.7 this is not really a pdf")
    with pytest.raises(PdfError):
        sandbox.inspect_pdf(bad, max_pages=5, max_mb=1, limits=QUICK)
