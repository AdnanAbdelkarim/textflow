"""Fixtures for the browser tests.

File parsing happens in the browser through PapaParse, pdf.js, Mammoth and
SheetJS, so it cannot be reached from the API tests. These drive a real
browser against a running server instead.

The sample files are generated rather than committed, so the parsers are
exercised against files a real writer produced rather than a hand-crafted
stub that might not match what users upload.
"""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# Four sentences per class, distinctive enough that a parse failure or a
# column mix-up changes the word count visibly.
SAMPLE_ROWS = [
    ("Central bank raises rates as inflation cools further", "Business"),
    ("Quarterly earnings beat expectations across the technology sector", "Business"),
    ("Striker signs record transfer ahead of the new season", "Sports"),
    ("Champions advance after a decisive second half performance", "Sports"),
    ("Researchers publish a faster method for protein folding", "SciTech"),
    ("Satellite launch delayed by unfavourable weather conditions", "SciTech"),
    ("Delegates reach agreement after prolonged border negotiations", "World"),
    ("Election observers report a peaceful and orderly vote", "World"),
]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def base_url():
    """Start the application and yield its address."""
    port = _free_port()
    env = {
        **os.environ,
        "TEXTFLOW_HOST": "127.0.0.1",
        "TEXTFLOW_PORT": str(port),
        # The spaCy transformer is not needed for file parsing and costs
        # minutes to load.
        "TEXTFLOW_WARMUP": "0",
    }
    proc = subprocess.Popen(
        [sys.executable, "main.py"], cwd=REPO_ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}"

    deadline = time.time() + 300
    while time.time() < deadline:
        if proc.poll() is not None:
            out = proc.stdout.read().decode(errors="replace")
            raise RuntimeError(f"server exited early:\n{out[-3000:]}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                break
        except OSError:
            time.sleep(1)
    else:
        proc.kill()
        raise RuntimeError("server did not start within 300s")

    yield url

    proc.terminate()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="session")
def sample_files(tmp_path_factory):
    """Write one sample file per supported format and return their paths."""
    d = tmp_path_factory.mktemp("uploads")
    paths = {}

    # --- CSV, parsed by PapaParse ---
    csv = d / "corpus.csv"
    csv.write_text("text,label\n" + "\n".join(
        f'"{t}",{l}' for t, l in SAMPLE_ROWS), encoding="utf8")
    paths["csv"] = csv

    # --- TXT, read directly ---
    txt = d / "corpus.txt"
    txt.write_text("\n".join(t for t, _ in SAMPLE_ROWS), encoding="utf8")
    paths["txt"] = txt

    # --- XLSX, parsed by SheetJS ---
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["text", "label"])
    for t, l in SAMPLE_ROWS:
        ws.append([t, l])
    xlsx = d / "corpus.xlsx"
    wb.save(xlsx)
    paths["xlsx"] = xlsx

    # --- DOCX, parsed by Mammoth ---
    from docx import Document
    doc = Document()
    for t, _ in SAMPLE_ROWS:
        doc.add_paragraph(t)
    docx = d / "corpus.docx"
    doc.save(docx)
    paths["docx"] = docx

    # --- PDF, parsed by pdf.js ---
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    pdf = d / "corpus.pdf"
    c = canvas.Canvas(str(pdf), pagesize=letter)
    y = 720
    for t, _ in SAMPLE_ROWS:
        c.drawString(72, y, t)
        y -= 24
    c.save()
    paths["pdf"] = pdf

    return paths
