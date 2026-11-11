import json
from pathlib import Path

import pytest

from app.cli import main
from tests.conftest import MakePdf

TEXT = (
    "Mitochondria produce most of the cell's ATP through respiration. "
    "The inner membrane is folded into cristae to add surface area. "
    "Chloroplasts capture light energy and turn it into sugar. "
)


@pytest.fixture(autouse=True)
def no_real_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    # never reach a real provider from tests, whatever is in the developer's .env
    monkeypatch.setenv("LLM_PROVIDER", "fake")


def test_generate_prints_questions_with_their_pages_and_saves_json(
    make_pdf: MakePdf, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pdf = make_pdf([TEXT, TEXT.replace("Mitochondria", "Ribosomes")])
    out = tmp_path / "quiz.json"

    code = main(["generate", str(pdf), "--count", "2", "--types", "true_false", "--json", str(out)])

    assert code == 0
    assert "Source: p. " in capsys.readouterr().out
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert len(saved) == 2 and all(q["page"] in (1, 2) for q in saved)


def test_reports_an_unreadable_file_without_a_traceback(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bad = tmp_path / "x.pdf"
    bad.write_text("not a pdf")

    assert main(["generate", str(bad)]) == 2
    assert "Error: This file is not a PDF." in capsys.readouterr().err
