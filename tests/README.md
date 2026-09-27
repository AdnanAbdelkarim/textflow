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

File parsing for CSV, TXT, DOCX, PDF and XLSX runs in the browser through
PapaParse, pdf.js and Mammoth, so it is not reachable from these tests and is
not covered here.
