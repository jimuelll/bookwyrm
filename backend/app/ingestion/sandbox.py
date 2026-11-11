"""Run PDF parsing in a separate, short-lived process with a time limit (and a memory limit on Linux).

Why: PyMuPDF is a thin wrapper around MuPDF, a large C library. Parsing an untrusted file in C is the
riskiest thing the API does. A crafted PDF can make the parser loop for minutes, allocate gigabytes,
or crash outright (a C crash is not a Python exception: it takes the whole process with it). Inside the
API process any of those would stall or kill every reader's requests.

So each parse gets its own child process:
  - a wall-clock timeout: if the child hasn't answered in time, we kill it and tell the reader;
  - a memory cap (Linux: RLIMIT_AS, set inside the child before it opens the file): MuPDF's allocations
    fail instead of the machine running out of memory;
  - a crash (segfault, abort) only ends the child; the parent sees the pipe close and reports it;
  - at most `max_parallel` parses at a time, so a burst of uploads can't start a hundred parsers;
  - one file per child: a worker runs exactly one job and exits, so nothing a hostile file did to a
    process's memory can affect the next reader's file.

The child is started with "spawn" (a fresh interpreter) on every OS, not "fork": forking a process that
is running asyncio and a database pool copies all of that state into the child, which is unsafe. Spawn
is slower (a new Python, then importing PyMuPDF: ~0.3 s on Linux, ~2 s on Windows), so the next worker
is always started ahead of time and waits for its job (`_spare`).

Windows (development): there is no RLIMIT_AS. The timeout still applies; the memory cap does not. A Job
Object could cap it, but this keeps dev simple; production runs on Linux.
"""

import multiprocessing
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

from app.ingestion import extract
from app.ingestion.extract import Page, PdfError

TIMED_OUT = "This PDF took too long to read. It may be damaged or unusually complex."
TOO_BIG = "This PDF needs too much memory to read. It may be damaged or unusually complex."
CRASHED = "This PDF could not be read; it may be damaged."

_spawn = multiprocessing.get_context("spawn")


@dataclass(frozen=True)
class Limits:
    timeout_seconds: float
    memory_mb: int  # 0 = no cap. Only enforced where the OS supports it (Linux), see the module docs
    max_parallel: int = 2


# A process-wide cap on children, shared by every request and background job. Created on first use so
# the first Limits seen decides the size (Settings is the same for the life of the process).
_slots: threading.BoundedSemaphore | None = None
_slots_lock = threading.Lock()


def _slot(limits: Limits) -> threading.BoundedSemaphore:
    global _slots
    with _slots_lock:
        if _slots is None:
            _slots = threading.BoundedSemaphore(max(1, limits.max_parallel))
        return _slots


def memory_cap_supported() -> bool:
    return sys.platform == "linux"


def _cap_memory(memory_mb: int) -> None:
    """Inside the child: limit its address space. Allocations past this fail (MemoryError in Python,
    a failed malloc in MuPDF, which it reports as an error) instead of exhausting the machine."""
    # written as a platform check (not a function call) so mypy, run on Windows, skips this branch
    if memory_mb > 0 and sys.platform == "linux":
        import resource  # Unix only, so imported here

        limit = memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def _worker(conn: Connection) -> None:
    """A child's whole life: wait for ONE job, cap memory, run it, send the answer back.

    ("ok", result) or ("pdf", message for the reader) or ("error", details of a bug). By the time this
    runs the child has imported this module, and with it PyMuPDF (the slow part), so it waits warm.
    """
    try:
        fn, args, kwargs, memory_mb = conn.recv()
    except EOFError:  # the API is shutting down and never sent a job
        return
    try:
        _cap_memory(memory_mb)
        conn.send(("ok", fn(*args, **kwargs)))
    except PdfError as e:
        conn.send(("pdf", str(e)))
    except MemoryError:
        conn.send(("pdf", TOO_BIG))
    except Exception as e:  # MuPDF raises its own types; anything else is reported, not lost
        # MuPDF reports a failed allocation as an ordinary error that mentions memory
        if memory_mb and "memory" in str(e).lower():
            conn.send(("pdf", TOO_BIG))
        else:
            conn.send(("error", f"{type(e).__name__}: {e}"))
    finally:
        conn.close()


@dataclass
class _Worker:
    process: Any  # multiprocessing.context.SpawnProcess
    conn: Any  # a Connection on Linux, a PipeConnection on Windows


def _start_worker() -> _Worker:
    parent_end, child_end = _spawn.Pipe()
    process = _spawn.Process(target=_worker, args=(child_end,), daemon=True)
    process.start()  # returns at once; the child imports PyMuPDF in its own time
    child_end.close()  # only the child holds that end now, so if it dies, our recv() sees end-of-file
    return _Worker(process, parent_end)


# One worker started ahead of time and waiting for a job, so a reader doesn't wait for a new Python
# and the PyMuPDF import on every upload. Each worker still handles exactly one file and then exits:
# whatever a hostile PDF did to that process's memory dies with it.
_spare: _Worker | None = None
_spare_lock = threading.Lock()


def _take_worker() -> _Worker:
    global _spare
    with _spare_lock:
        worker, _spare = _spare, None
        if worker is None or not worker.process.is_alive():
            worker = _start_worker()
        _spare = _start_worker()  # the next one starts warming up now
        return worker


def warm_up() -> None:
    """Start the spare worker early (at API startup), so even the first upload doesn't wait for it."""
    global _spare
    with _spare_lock:
        if _spare is None:
            _spare = _start_worker()


def run_sandboxed[T](fn: Callable[..., T], *args: Any, limits: Limits, **kwargs: Any) -> T:
    """Call `fn(*args, **kwargs)` in a child process and return its result.

    Raises PdfError (with a message for the reader) if fn raised one, ran out of time or memory, or
    the child died. Raises RuntimeError for any other error, which the caller treats as a bug.
    `fn` must be importable by name (a module-level function), because a spawned child imports it.
    Blocking: call it from a worker thread (asyncio.to_thread), never on the event loop.
    """
    with _slot(limits):
        worker = _take_worker()
        try:
            worker.conn.send((fn, args, kwargs, limits.memory_mb))
            # Read before join(): a big result (500 pages of text) fills the pipe, and the child
            # can't exit until someone reads it.
            if not worker.conn.poll(limits.timeout_seconds):
                raise PdfError(TIMED_OUT)
            try:
                kind, value = worker.conn.recv()
            except EOFError:  # the child died without answering: a C crash, or killed by the OS
                raise PdfError(CRASHED) from None
        except (BrokenPipeError, ConnectionResetError):  # it died before it even took the job
            raise PdfError(CRASHED) from None
        finally:
            worker.conn.close()
            if worker.process.is_alive():
                worker.process.kill()  # timed out (or finishing up): don't leave it running
            worker.process.join(timeout=5)
    if kind == "ok":
        return value  # type: ignore[no-any-return]
    if kind == "pdf":
        raise PdfError(value)
    raise RuntimeError(f"PDF worker failed: {value}")


# ---------- the two calls the API makes ----------


def inspect_pdf(path: Path, *, max_pages: int, max_mb: int, limits: Limits) -> int:
    """extract.inspect_pdf (type, damage, password, page count) in a sandboxed child."""
    return run_sandboxed(extract.inspect_pdf, path, max_pages=max_pages, max_mb=max_mb, limits=limits)


def extract_pages(path: Path, *, max_pages: int, max_mb: int, limits: Limits) -> list[Page]:
    """extract.extract_pages (every page's text) in a sandboxed child."""
    return run_sandboxed(extract.extract_pages, path, max_pages=max_pages, max_mb=max_mb, limits=limits)
