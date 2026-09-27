"""Visualization and Advanced Analysis endpoints."""
import pytest

VIZ = [
    ("/api/wordcloud_frequencies", lambda rows: {"rows": rows}),
    ("/api/cooccurrence",          lambda rows: {"rows": rows, "topN": 20, "minCooccurrence": 1}),
    ("/api/coverage",              lambda rows: {"rows": rows}),
    ("/api/zipf",                  lambda rows: {"rows": rows}),
    ("/api/label_distribution",    lambda rows: {"rows": rows}),
    ("/api/ngrams",                lambda rows: {"rows": rows, "n": 2, "topN": 15}),
    ("/api/word_frequency",        lambda rows: {"rows": rows}),
]


@pytest.mark.parametrize("path,build", VIZ, ids=[p for p, _ in VIZ])
def test_visualization_endpoint(client, rows, path, build):
    r = client.post(path, json=build(rows))
    assert r.status_code == 200, f"{path}: {r.data[:300]}"
    assert r.get_json() is not None


@pytest.mark.parametrize("path,build", VIZ, ids=[p for p, _ in VIZ])
def test_visualization_endpoint_survives_empty_input(client, path, build):
    """An empty corpus should give a handled response, never a 500."""
    r = client.post(path, json=build([]))
    assert r.status_code != 500, f"{path} raised 500 on empty input: {r.data[:300]}"


def test_sentiment(client, texts):
    r = client.post("/sentiment", json={"text": " ".join(texts[:20])})
    assert r.status_code == 200, r.data[:300]
    assert "results" in r.get_json()


def test_topic_modeling(client, rows):
    r = client.post("/api/topic_modeling", json={"rows": rows})
    assert r.status_code == 200, r.data[:300]


@pytest.mark.slow
def test_ner(client, texts):
    """Loads the spaCy transformer, so it is slow on first run."""
    r = client.post("/ner", json={"text": " ".join(texts[:10]), "method": "both"})
    assert r.status_code == 200, r.data[:300]
    assert "entities" in r.get_json()
