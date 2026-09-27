# Smoke tests

Exercise every backend route the six tabs depend on: page rendering,
preprocessing, model training, the multi-label path, the visualizations, and
the Advanced Analysis endpoints.

```bash
pip install -r requirements-dev.txt
pytest -q                 # skips the slow NER test
pytest -q -m slow         # the NER test on its own
pytest -q -m ""           # everything
```

The application is imported once per session, which pulls in torch and spaCy
and takes a minute or two on a cold cache. The tests themselves are fast.

## Browser tests

File parsing for CSV, TXT, DOCX, PDF and XLSX runs in the browser through
PapaParse, pdf.js, Mammoth and SheetJS, so it cannot be reached from the API
tests. `tests/e2e` starts the application, drives Chromium against it, and
uploads one generated file per format. They are excluded from the default run
because they need a browser:

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium
pytest -q tests/e2e
```

The sample files are written at test time by openpyxl, python-docx and
reportlab rather than committed, so each parser meets a file a real writer
produced.
