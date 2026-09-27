"""Shared fixtures for the smoke tests.

Importing the application pulls in torch and transformers, which is slow, so
the app is built once per test session and shared through Flask's test client.
"""
import random

import pytest

CLASSES = ["World", "Sports", "Business", "SciTech"]

VOCAB = {
    "World":    "government election minister border treaty summit talks",
    "Sports":   "match season coach striker tournament final league",
    "Business": "market shares profit revenue quarter investors merger",
    "SciTech":  "software chip satellite research processor network data",
}


def _make_rows(per_class=25, seed=7):
    """A small labeled corpus with clearly separable per-class vocabulary."""
    rng = random.Random(seed)
    rows = []
    for label in CLASSES:
        words = VOCAB[label].split()
        for _ in range(per_class):
            picked = [rng.choice(words) for _ in range(12)]
            rows.append({"text": " ".join(picked), "label": label})
    rng.shuffle(rows)
    return rows


@pytest.fixture(scope="session")
def app():
    from main import app as flask_app
    flask_app.config.update(TESTING=True)
    return flask_app


@pytest.fixture(scope="session")
def client(app):
    return app.test_client()


@pytest.fixture(scope="session")
def rows():
    return _make_rows()


@pytest.fixture(scope="session")
def multilabel_rows():
    """Rows in the multi-label shape: a list of labels per document."""
    rng = random.Random(11)
    out = []
    for _ in range(80):
        chosen = rng.sample(CLASSES, rng.choice([1, 1, 2]))
        words = []
        for label in chosen:
            words += rng.sample(VOCAB[label].split(), 4)
        rng.shuffle(words)
        out.append({"text": " ".join(words), "labels": chosen})
    return out


@pytest.fixture(scope="session")
def texts(rows):
    return [r["text"] for r in rows]
