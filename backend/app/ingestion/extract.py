"""Step 1 of ingestion: validate a PDF and pull out its text page by page, keeping page numbers."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf

# A page with less text than this is probably a scanned image with no text layer.
SCANNED_PAGE_CHARS = 20


class PdfError(Exception):
    """A PDF Bookwyrm can't use. The message is written for the person who uploaded it."""


@dataclass(frozen=True)
class Page:
    number: int  # 1-based physical page number, as a PDF viewer shows it
    text: str

    @property
    def likely_scanned(self) -> bool:
        return len(self.text.strip()) < SCANNED_PAGE_CHARS


def extract_pages(path: Path, *, max_pages: int = 500, max_mb: int = 25) -> list[Page]:
    """Read every page's text. Raises PdfError for files that aren't usable PDFs."""
    if not path.is_file():
        raise PdfError(f"File not found: {path}")
    if path.stat().st_size > max_mb * 1024 * 1024:
        raise PdfError(f"The file is larger than {max_mb} MB.")
    # Check the magic bytes, not the extension: a renamed .docx still starts with "PK".
    with path.open("rb") as f:
        if f.read(5) != b"%PDF-":
            raise PdfError("This file is not a PDF.")

    try:
        doc: Any = pymupdf.open(path)  # type: ignore[no-untyped-call]  # PyMuPDF has no type hints
    except Exception as e:  # PyMuPDF raises several types for damaged files
        raise PdfError("The PDF could not be opened; it may be damaged.") from e

    with doc:
        if doc.needs_pass:
            raise PdfError("The PDF is password-protected. Remove the password and upload it again.")
        if doc.page_count > max_pages:
            raise PdfError(f"The PDF has {doc.page_count} pages; the limit is {max_pages}.")
        pages = [Page(number=i + 1, text=page.get_text("text")) for i, page in enumerate(doc)]

    if not pages or all(p.likely_scanned for p in pages):
        raise PdfError(
            "No text could be read from this PDF. It may be scanned images, which aren't supported yet."
        )
    return pages
