from collections.abc import Callable
from pathlib import Path

import pymupdf
import pytest

MakePdf = Callable[[list[str]], Path]


@pytest.fixture
def make_pdf(tmp_path: Path) -> MakePdf:
    """Write a real PDF with one page per string (an empty string makes a blank page)."""

    def make(pages: list[str]) -> Path:
        doc = pymupdf.open()
        for text in pages:
            page = doc.new_page()
            if text:
                page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), text, fontsize=10)
        path = tmp_path / "doc.pdf"
        doc.save(path)
        doc.close()
        return path

    return make
