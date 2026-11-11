from pathlib import Path

import pytest

from app.ingestion.extract import PdfError, extract_pages
from tests.conftest import MakePdf


def test_keeps_text_on_its_page_number(make_pdf: MakePdf) -> None:
    path = make_pdf(["Mitochondria make ATP.", "Chloroplasts capture light."])

    pages = extract_pages(path)

    assert [p.number for p in pages] == [1, 2]
    assert "Chloroplasts capture light." in pages[1].text


def test_flags_a_blank_page_as_likely_scanned(make_pdf: MakePdf) -> None:
    pages = extract_pages(make_pdf(["Mitochondria make ATP in the inner membrane.", ""]))
    assert [p.likely_scanned for p in pages] == [False, True]


def test_rejects_a_pdf_with_no_text_at_all(make_pdf: MakePdf) -> None:
    with pytest.raises(PdfError, match="scanned"):
        extract_pages(make_pdf(["", ""]))


def test_rejects_a_file_that_is_not_a_pdf_even_if_named_pdf(tmp_path: Path) -> None:
    fake = tmp_path / "notes.pdf"
    fake.write_bytes(b"PK\x03\x04 this is really a zip")
    with pytest.raises(PdfError, match="not a PDF"):
        extract_pages(fake)


def test_rejects_more_pages_than_the_limit(make_pdf: MakePdf) -> None:
    with pytest.raises(PdfError, match="limit is 2"):
        extract_pages(make_pdf(["one", "two", "three"]), max_pages=2)
