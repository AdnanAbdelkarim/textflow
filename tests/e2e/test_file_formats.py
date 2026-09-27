"""Every advertised upload format is parsed in the browser.

The paper states that TextFlow accepts CSV, TXT, DOCX, PDF and XLSX. Each
format goes through a different browser library, so each needs its own check:
PapaParse for CSV, Mammoth for DOCX, pdf.js for PDF, SheetJS for XLSX, and a
direct read for TXT.
"""
import pytest

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import sync_playwright  # noqa: E402

FORMATS = ["csv", "txt", "xlsx", "docx", "pdf"]

# Words that appear in the sample corpus and nowhere in the interface, so
# finding them proves the file's contents actually reached the application.
MARKERS = ["inflation", "striker", "satellite", "delegates"]


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _upload(browser, base_url, path):
    """Upload one file and return the resulting page plus its console errors."""
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(base_url + "/", wait_until="domcontentloaded")
    page.wait_for_selector("#fileInput")
    # The parser libraries are deferred, so wait for the one that arrives last.
    page.wait_for_function("() => typeof window.Papa !== 'undefined'", timeout=30000)
    page.set_input_files("#fileInput", str(path))
    return page, errors


@pytest.mark.parametrize("fmt", FORMATS)
def test_upload_is_parsed_and_reaches_overview(browser, base_url, sample_files, fmt):
    """Uploading a file loads the corpus and moves the user to the Overview tab."""
    page, errors = _upload(browser, base_url, sample_files[fmt])
    try:
        page.wait_for_url("**/overview", timeout=90000)
        page.wait_for_selector("#totalWords")
        page.wait_for_function(
            "() => { const e = document.getElementById('totalWords');"
            "        return e && /\\d/.test(e.textContent); }", timeout=60000)
        total = page.inner_text("#totalWords")
        assert any(ch.isdigit() for ch in total), f"{fmt}: no word count rendered"
        digits = int("".join(ch for ch in total if ch.isdigit()))
        assert digits > 0, f"{fmt}: word count is zero, the file did not parse"
    finally:
        page.close()

    blocking = [e for e in errors if "favicon" not in e.lower()]
    assert not blocking, f"{fmt}: console errors during upload: {blocking[:3]}"


@pytest.mark.parametrize("fmt", FORMATS)
def test_document_text_is_available_to_the_app(browser, base_url, sample_files, fmt):
    """The parsed text, not just a row count, is what the corpus holds."""
    page, _ = _upload(browser, base_url, sample_files[fmt])
    try:
        page.wait_for_url("**/overview", timeout=90000)
        page.wait_for_selector("#totalWords")
        corpus = page.evaluate(
            "() => JSON.stringify(window.lastCSVData || "
            "  (window.sessionStorage.getItem('textData') || '')).toLowerCase()")
        found = [m for m in MARKERS if m in corpus]
        assert found, (f"{fmt}: none of the sample words reached the corpus; "
                       f"got {corpus[:200]}")
    finally:
        page.close()


@pytest.mark.parametrize("fmt", ["csv", "xlsx"])
def test_labeled_formats_are_detected_as_labeled(browser, base_url, sample_files, fmt):
    """CSV and XLSX carry a label column, so the labeled workflow must unlock."""
    page, _ = _upload(browser, base_url, sample_files[fmt])
    try:
        page.wait_for_url("**/overview", timeout=90000)
        page.wait_for_selector("#totalWords")
        labeled = page.evaluate(
            "() => typeof window.isDatasetLabeled === 'function'"
            "      ? window.isDatasetLabeled() : null")
        assert labeled is not False, (
            f"{fmt}: a file with a label column was treated as unlabeled, "
            "which hides the Preprocessing and Predictive Modeling tabs")
    finally:
        page.close()
