"""The Preprocessing tab: feature extraction, normalization, resampling."""
import pytest

TFIDF = {"useTFIDF": True, "removeStopwords": True, "vectorSize": 100}
TF = {"useTF": True, "vectorSize": 100}
W2V = {"useWord2Vec": True, "vectorSize": 100}


def _post(client, rows, settings):
    return client.post("/api/preprocess",
                       json={"rows": rows, "settings": settings, "textCol": "text"})


@pytest.mark.parametrize("settings,name", [(TFIDF, "tfidf"), (TF, "tf"), (W2V, "word2vec")])
def test_each_feature_method_runs(client, rows, settings, name):
    r = _post(client, rows, settings)
    assert r.status_code == 200, f"{name}: {r.get_json()}"
    body = r.get_json()
    assert body["success"] is True
    assert body["n_samples"] == len(rows)
    assert body["vector_dimensions"] > 0, f"{name} produced no features"


def test_no_feature_method_is_rejected(client, rows):
    """Exactly one feature method is required; none selected must not 500."""
    r = _post(client, rows, {"removeStopwords": True})
    assert r.status_code == 400
    assert "error" in r.get_json()


@pytest.mark.parametrize("norm", ["useStemming", "useLemmatization"])
def test_normalization_options_run(client, rows, norm):
    r = _post(client, rows, {**TFIDF, norm: True})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["processed_sample"]


def test_smote_on_balanced_data_reports_no_op(client, rows):
    """The audited behaviour: balanced input means zero synthetic samples."""
    r = _post(client, rows, {**TFIDF, "useSMOTE": True})
    assert r.status_code == 200, r.get_json()
    info = r.get_json()["resampling"]
    assert info["n_synthetic"] == 0
    assert info["no_op"] is True


def test_smote_on_imbalanced_data_generates_samples(client, rows):
    imbalanced = [r for r in rows if r["label"] != "Sports"]
    imbalanced += [r for r in rows if r["label"] == "Sports"][:5]
    r = _post(client, imbalanced, {**TFIDF, "useSMOTE": True})
    assert r.status_code == 200, r.get_json()
    info = r.get_json()["resampling"]
    assert info["n_synthetic"] > 0, "SMOTE did nothing on genuinely imbalanced data"
    assert info["no_op"] is False
    counts = r.get_json()["new_class_distribution"]
    assert len(set(counts.values())) == 1, "classes not balanced after SMOTE"


def test_empty_rows_rejected(client):
    r = client.post("/api/preprocess", json={"rows": [], "settings": TFIDF})
    assert r.status_code == 400


def test_preview_endpoint(client, rows):
    r = client.post("/api/preprocess_preview",
                    json={"rows": rows[:5], "settings": TFIDF, "textCol": "text"})
    assert r.status_code == 200, r.get_json()
